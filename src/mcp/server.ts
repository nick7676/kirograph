/**
 * KiroGraph MCP Server
 * Implements the Model Context Protocol over stdio.
 */

import * as path from 'path';
import KiroGraph, { findNearestKiroGraphRoot } from '../index';
import { StdioTransport, ErrorCodes } from './transport';
import { tools, ToolHandler, LIVE_SEARCH_TOOL_DEFINITION } from './tools';
import { PatternRunner } from '../patterns/runner';
import type { JsonRpcMessage } from './transport';

const SERVER_INFO = { name: 'kirograph', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

export class MCPServer {
  private transport = new StdioTransport();
  private cg: KiroGraph | null = null;
  private toolHandler: ToolHandler;
  private projectPath: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private config: any | null = null;

  constructor(projectPath?: string) {
    // Normalize to absolute path immediately to prevent any path traversal
    this.projectPath = projectPath ? path.resolve(projectPath) : null;
    this.toolHandler = new ToolHandler(null);
  }

  async start(): Promise<void> {
    this.transport.start(this.handleMessage.bind(this));
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    process.stdin.on('end', () => this.stop());
    process.stdin.on('close', () => this.stop());
  }

  private async tryInit(projectPath: string): Promise<void> {
    const root = findNearestKiroGraphRoot(projectPath);
    if (!root) { this.projectPath = projectPath; return; }
    this.projectPath = root;
    try {
      this.cg = await KiroGraph.open(root);
      this.toolHandler.setDefaultKiroGraph(this.cg);
    } catch (err) {
      process.stderr.write(`[KiroGraph MCP] Failed to open ${root}: ${err}\n`);
    }
    try {
      const { loadConfig } = await import('../config');
      this.config = await loadConfig(root);
    } catch {
      // config is optional — proceed without it
    }
  }

  private async handleMessage(msg: JsonRpcMessage): Promise<unknown> {
    const req = msg as any;

    switch (req.method) {
      case 'initialize': {
        const rootUri = req.params?.rootUri ?? req.params?.workspaceFolders?.[0]?.uri;
        if (rootUri) {
          const p = rootUri.startsWith('file://') ? decodeURIComponent(rootUri.replace(/^file:\/\/\/?/, '')) : rootUri;
          await this.tryInit(p);
        } else if (this.projectPath) {
          await this.tryInit(this.projectPath);
        }
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        };
      }

      case 'tools/list': {
        const dynamicTools = [...tools];
        if (this.config?.enablePatterns && new PatternRunner().isAvailable()) {
          dynamicTools.push(LIVE_SEARCH_TOOL_DEFINITION);
        }
        return { tools: dynamicTools };
      }

      case 'tools/call': {
        const { name, arguments: args = {} } = req.params ?? {};
        try {
          return await this.toolHandler.handle(name, args);
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      }

      case 'notifications/initialized':
      case 'ping':
        return {};

      default:
        this.transport.sendError(req.id, ErrorCodes.MethodNotFound, `Unknown method: ${req.method}`);
        return undefined;
    }
  }

  private stop(): void {
    this.cg?.close();
    this.toolHandler.closeAll();
    process.exit(0);
  }
}
