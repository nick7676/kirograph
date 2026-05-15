/**
 * KiroGraph Installer — Kiro CLI agent config
 *
 * Writes .kiro/agents/kirograph.json — a workspace custom agent that wires up:
 *  - MCP server (kirograph tools)
 *  - steering file as resource (single source of truth for instructions + caveman rules)
 *  - hooks: sync on agentSpawn, userPromptSubmit, stop
 *
 * Sync strategy (CLI has no file-watch events unlike the IDE):
 *  - agentSpawn:       sync-if-dirty — catches edits made between sessions
 *  - userPromptSubmit: sync-if-dirty — keeps graph fresh within a session
 *  - stop:             sync-if-dirty --quiet — deferred flush, mirrors IDE agentStop
 */

import * as fs from 'fs';
import * as path from 'path';

const KIROGRAPH_TOOLS = [
  '@kirograph/kirograph_search',
  '@kirograph/kirograph_context',
  '@kirograph/kirograph_callers',
  '@kirograph/kirograph_callees',
  '@kirograph/kirograph_impact',
  '@kirograph/kirograph_node',
  '@kirograph/kirograph_status',
  '@kirograph/kirograph_files',
  '@kirograph/kirograph_dead_code',
  '@kirograph/kirograph_circular_deps',
  '@kirograph/kirograph_path',
  '@kirograph/kirograph_type_hierarchy',
  '@kirograph/kirograph_architecture',
  '@kirograph/kirograph_package',
  '@kirograph/kirograph_coupling',
  '@kirograph/kirograph_hotspots',
  '@kirograph/kirograph_surprising',
  '@kirograph/kirograph_diff',
];

const SYNC_CMD = 'kirograph sync-if-dirty --quiet 2>/dev/null || true';

function buildAgentConfig() {
  return {
    name: 'kirograph',
    description: 'KiroGraph-aware agent — uses the semantic code graph for faster, smarter exploration.',
    resources: ['file://.kiro/steering/kirograph.md'],
    tools: ['@builtin', '@kirograph'],
    allowedTools: KIROGRAPH_TOOLS,
    useLegacyMcpJson: true,
    hooks: {
      agentSpawn: [{ command: SYNC_CMD }],
      userPromptSubmit: [{ command: SYNC_CMD }],
      stop: [{ command: SYNC_CMD }],
    },
  };
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p: string, data: unknown): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

export function writeCliAgent(kiroDir: string): void {
  const agentsDir = path.join(kiroDir, 'agents');
  ensureDir(agentsDir);
  const agentPath = path.join(agentsDir, 'kirograph.json');
  writeJson(agentPath, buildAgentConfig());
  console.log(`  ✓ CLI agent config written to ${agentPath}`);
}
