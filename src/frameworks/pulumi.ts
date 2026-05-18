/**
 * Pulumi Framework Resolver
 *
 * Pulumi is already TypeScript/Python/Go code — tree-sitter handles parsing.
 * This resolver adds detection, resource reference resolution, and route extraction.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const pulumiResolver: FrameworkResolver = {
  name: 'pulumi',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('Pulumi.yaml') || context.fileExists('Pulumi.yml')) return true;
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if (Object.keys(deps).some(d => d.startsWith('@pulumi/'))) return true;
      } catch { /* ignore */ }
    }
    // Python
    const requirements = context.readFile('requirements.txt');
    if (requirements && requirements.includes('pulumi')) return true;
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve resource property references (e.g., bucket.bucketName)
    if (/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(ref.referenceName)) {
      const varName = ref.referenceName.split('.')[0]!;
      const id = resolveInDirs(varName, ['index', 'src', 'infra', 'infrastructure', 'lib'], context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.75, resolvedBy: 'framework' };
    }
    // Resolve component/stack class references
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveInDirs(ref.referenceName, ['components', 'src', 'infra', 'lib'], context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.7, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Extract Pulumi API Gateway routes (awsx, apigateway)
    // Pattern: { path: "/users", method: "GET", ... }
    const routePattern = /path\s*:\s*["']([^"']+)["'][^}]*method\s*:\s*["'](\w+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = routePattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const routePath = match[1]!;
      const method = match[2]!.toUpperCase();
      const name = `${method} ${routePath}`;
      nodes.push({
        id: `route:${filePath}:${method}:${routePath}:${line}`,
        kind: 'route', name,
        qualifiedName: `${filePath}::${name}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: filePath.endsWith('.py') ? 'python' : 'typescript', updatedAt: now,
      });
    }

    return nodes;
  },
};

function resolveInDirs(name: string, dirs: string[], context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (!(file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.go'))) continue;
    if (!dirs.some(d => file.includes(`/${d}/`) || file.includes(`/${d}.`))) continue;
    const node = context.getNodesInFile(file).find(n => n.name === name);
    if (node) return node.id;
  }
  return null;
}
