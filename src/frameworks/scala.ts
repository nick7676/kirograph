/**
 * Scala Framework Resolver (Play, Akka HTTP, http4s)
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const playResolver: FrameworkResolver = {
  name: 'play',
  detect(context: ResolutionContext): boolean {
    // Check build.sbt or plugins.sbt for Play plugin
    const buildSbt = context.readFile('build.sbt');
    if (buildSbt && (buildSbt.includes('PlayScala') || buildSbt.includes('play-'))) return true;
    const plugins = context.readFile('project/plugins.sbt');
    if (plugins && plugins.includes('sbt-plugin')) return true;
    return context.getAllFiles().some(f => f.includes('/controllers/') && f.endsWith('.scala'));
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve controller references
    if (ref.referenceName.endsWith('Controller')) {
      const id = resolveInDirs(ref.referenceName, ['controllers', 'app/controllers'], '.scala', 'class', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve service references
    if (ref.referenceName.endsWith('Service') || ref.referenceName.endsWith('Repository')) {
      const id = resolveInDirs(ref.referenceName, ['services', 'repositories', 'app/services', 'app/repositories'], '.scala', null, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.8, resolvedBy: 'framework' };
    }
    // Resolve model references
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveInDirs(ref.referenceName, ['models', 'app/models', 'domain'], '.scala', 'class', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.7, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Play routes file (conf/routes)
    if (filePath.endsWith('/routes') || filePath.endsWith('/routes.conf')) {
      const routePattern = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/gm;
      let match: RegExpExecArray | null;
      while ((match = routePattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const [, method, routePath] = match;
        const name = `${method} ${routePath}`;
        nodes.push({
          id: `route:${filePath}:${method}:${routePath}:${line}`,
          kind: 'route', name,
          qualifiedName: `${filePath}::${name}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'scala', updatedAt: now,
        });
      }
      return nodes;
    }

    // Akka HTTP / http4s route DSL
    const dslPatterns = [
      // Akka HTTP: path("users") { get { ... } }
      /(?:path|pathPrefix)\s*\(\s*"([^"]+)"\s*\)/g,
      // http4s: case GET -> Root / "users"
      /case\s+(GET|POST|PUT|PATCH|DELETE)\s+->\s+Root\s*\/\s*"([^"]+)"/g,
    ];
    for (const pattern of dslPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const isHttp4s = pattern.source.includes('case');
        const method = isHttp4s ? match[1]! : 'ANY';
        const routePath = isHttp4s ? `/${match[2]}` : `/${match[1]}`;
        const name = `${method} ${routePath}`;
        const id = `route:${filePath}:${method}:${routePath}:${line}`;
        if (!nodes.some(n => n.id === id)) {
          nodes.push({
            id, kind: 'route', name,
            qualifiedName: `${filePath}::${name}`,
            filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
            language: 'scala', updatedAt: now,
          });
        }
      }
    }

    return nodes;
  },
};

function resolveInDirs(name: string, dirs: string[], ext: string, kind: string | null, context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (file.endsWith(ext) && dirs.some(d => file.includes(`/${d}/`) || file.includes(`/${d}`))) {
      const node = context.getNodesInFile(file).find(
        n => n.name === name && (kind === null || n.kind === kind)
      );
      if (node) return node.id;
    }
  }
  return null;
}
