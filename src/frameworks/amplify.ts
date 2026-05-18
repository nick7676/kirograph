/**
 * AWS Amplify Gen 2 Framework Resolver
 *
 * Detects Amplify Gen 2 projects and resolves resource references,
 * function handlers, and data model definitions.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const amplifyResolver: FrameworkResolver = {
  name: 'amplify',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('amplify/backend.ts') || context.fileExists('amplify/backend.js')) return true;
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ('@aws-amplify/backend' in deps || '@aws-amplify/backend-cli' in deps) return true;
      } catch { /* ignore */ }
    }
    // Amplify Gen 1 (legacy)
    if (context.fileExists('amplify/backend/backend-config.json')) return true;
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve function handler references (defineFunction({ entry: './handler.ts' }))
    if (ref.referenceName.includes('.') && !ref.referenceName.startsWith('.')) {
      const id = resolveHandlerEntry(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    // Resolve resource references (auth, data, storage, etc.)
    if (/^[a-z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveAmplifyResource(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.8, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Only process amplify/ directory files
    if (!filePath.includes('amplify/')) return nodes;

    // Extract defineData schema models: a.model({ ... })
    const modelPattern = /(\w+)\s*:\s*a\.model\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = modelPattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const modelName = match[1]!;
      nodes.push({
        id: `amplify:${filePath}:model:${modelName}:${line}`,
        kind: 'class',
        name: modelName,
        qualifiedName: `${filePath}::model.${modelName}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'typescript', updatedAt: now,
        signature: `a.model("${modelName}")`,
      });
    }

    // Extract defineFunction declarations
    const funcPattern = /defineFunction\s*\(\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/g;
    while ((match = funcPattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const funcName = match[1]!;
      nodes.push({
        id: `amplify:${filePath}:function:${funcName}:${line}`,
        kind: 'function',
        name: funcName,
        qualifiedName: `${filePath}::function.${funcName}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'typescript', updatedAt: now,
        signature: `defineFunction("${funcName}")`,
      });
    }

    // Extract API routes from custom queries/mutations
    const queryPattern = /a\.(query|mutation)\s*\(\s*['"]([^'"]+)['"]/g;
    while ((match = queryPattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const opType = match[1]!.toUpperCase();
      const opName = match[2]!;
      nodes.push({
        id: `route:${filePath}:${opType}:${opName}:${line}`,
        kind: 'route',
        name: `${opType} ${opName}`,
        qualifiedName: `${filePath}::${opType}.${opName}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'typescript', updatedAt: now,
      });
    }

    // Extract defineAuth, defineStorage, defineBackend as resource nodes
    const resourcePattern = /(defineAuth|defineStorage|defineBackend|defineData)\s*\(/g;
    while ((match = resourcePattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const resourceType = match[1]!.replace('define', '').toLowerCase();
      nodes.push({
        id: `amplify:${filePath}:resource:${resourceType}:${line}`,
        kind: 'component',
        name: resourceType,
        qualifiedName: `${filePath}::resource.${resourceType}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'typescript', updatedAt: now,
        signature: `${match[1]}()`,
      });
    }

    return nodes;
  },
};

function resolveHandlerEntry(entry: string, context: ResolutionContext): string | null {
  // Resolve relative paths like './handler' to the actual function
  const cleanPath = entry.replace(/^\.\//, '');
  const extensions = ['.ts', '.js', '.mjs'];
  for (const ext of extensions) {
    const candidates = [
      `amplify/${cleanPath}${ext}`,
      `amplify/functions/${cleanPath}${ext}`,
      `${cleanPath}${ext}`,
    ];
    for (const candidate of candidates) {
      if (context.fileExists(candidate)) {
        const nodes = context.getNodesInFile(candidate);
        // Look for the handler export
        const handler = nodes.find(n =>
          n.name === 'handler' || n.name === 'default' || n.kind === 'function'
        );
        if (handler) return handler.id;
        if (nodes.length > 0) return nodes[0].id;
      }
    }
  }
  return null;
}

function resolveAmplifyResource(name: string, context: ResolutionContext): string | null {
  // Look in amplify/ directory for resource definitions
  const candidates = [
    `amplify/${name}/resource.ts`,
    `amplify/${name}/resource.js`,
    `amplify/${name}.ts`,
  ];
  for (const candidate of candidates) {
    if (context.fileExists(candidate)) {
      const nodes = context.getNodesInFile(candidate);
      if (nodes.length > 0) return nodes[0].id;
    }
  }
  return null;
}
