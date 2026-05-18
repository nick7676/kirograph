/**
 * Vue / Nuxt Framework Resolver
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const nuxtResolver: FrameworkResolver = {
  name: 'nuxt',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('nuxt.config.ts') || context.fileExists('nuxt.config.js')) return true;
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ('nuxt' in deps || 'nuxt3' in deps) return true;
      } catch { /* ignore */ }
    }
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve composable references (useXxx)
    if (ref.referenceName.startsWith('use')) {
      const id = resolveComposable(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    // Resolve component references (PascalCase)
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveComponent(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve store references
    if (ref.referenceName.startsWith('use') && ref.referenceName.endsWith('Store')) {
      const id = resolveStore(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Nuxt server API routes: server/api/[...].ts → route based on file path
    if (filePath.includes('server/api/') || filePath.includes('server/routes/')) {
      const routePath = filePath
        .replace(/.*server\/(api|routes)/, '/$1')
        .replace(/\.(ts|js|mjs)$/, '')
        .replace(/\/index$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1');

      // Detect HTTP method from filename (e.g., users.get.ts, users.post.ts)
      const methodMatch = routePath.match(/\.(get|post|put|patch|delete)$/i);
      const method = methodMatch ? methodMatch[1]!.toUpperCase() : 'ANY';
      const cleanPath = methodMatch ? routePath.replace(/\.(get|post|put|patch|delete)$/i, '') : routePath;

      const name = `${method} ${cleanPath}`;
      nodes.push({
        id: `route:${filePath}:${method}:${cleanPath}:1`,
        kind: 'route', name,
        qualifiedName: `${filePath}::${name}`,
        filePath, startLine: 1, endLine: 1, startColumn: 0, endColumn: 0,
        language: 'typescript', updatedAt: now,
      });
    }

    // Nuxt pages → routes (pages/users/[id].vue → /users/:id)
    if (filePath.includes('pages/') && filePath.endsWith('.vue')) {
      const routePath = filePath
        .replace(/.*pages/, '')
        .replace(/\.vue$/, '')
        .replace(/\/index$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1');

      const name = `PAGE ${routePath || '/'}`;
      nodes.push({
        id: `route:${filePath}:PAGE:${routePath || '/'}:1`,
        kind: 'route', name,
        qualifiedName: `${filePath}::${name}`,
        filePath, startLine: 1, endLine: 1, startColumn: 0, endColumn: 0,
        language: 'vue', updatedAt: now,
      });
    }

    return nodes;
  },
};

export const vueResolver: FrameworkResolver = {
  name: 'vue',
  detect(context: ResolutionContext): boolean {
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ('vue' in deps) return true;
      } catch { /* ignore */ }
    }
    return context.getAllFiles().some(f => f.endsWith('.vue'));
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve component references
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveComponent(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.8, resolvedBy: 'framework' };
    }
    // Resolve composable references
    if (ref.referenceName.startsWith('use')) {
      const id = resolveComposable(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    return null;
  },
};

function resolveComposable(name: string, context: ResolutionContext): string | null {
  // Convert useFetchData → fetchData → fetch-data or fetchData
  const dirs = ['composables', 'src/composables', 'hooks', 'src/hooks'];
  for (const file of context.getAllFiles()) {
    if ((file.endsWith('.ts') || file.endsWith('.js')) && dirs.some(d => file.includes(`/${d}/`))) {
      const node = context.getNodesInFile(file).find(n => n.name === name);
      if (node) return node.id;
    }
  }
  return null;
}

function resolveComponent(name: string, context: ResolutionContext): string | null {
  // PascalCase → kebab-case for file matching
  const kebab = name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  const dirs = ['components', 'src/components'];
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.vue') && !file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
    if (!dirs.some(d => file.includes(`/${d}/`))) continue;
    // Match by filename (PascalCase or kebab-case)
    const basename = file.split('/').pop()?.replace(/\.(vue|tsx|ts)$/, '') ?? '';
    if (basename === name || basename === kebab || basename.toLowerCase() === name.toLowerCase()) {
      const nodes = context.getNodesInFile(file);
      if (nodes.length > 0) return nodes[0].id;
    }
  }
  return null;
}

function resolveStore(name: string, context: ResolutionContext): string | null {
  const dirs = ['stores', 'store', 'src/stores', 'src/store'];
  for (const file of context.getAllFiles()) {
    if ((file.endsWith('.ts') || file.endsWith('.js')) && dirs.some(d => file.includes(`/${d}/`))) {
      const node = context.getNodesInFile(file).find(n => n.name === name);
      if (node) return node.id;
    }
  }
  return null;
}
