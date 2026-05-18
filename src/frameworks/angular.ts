/**
 * Angular Framework Resolver
 *
 * Detects Angular projects and resolves component, service, pipe, guard,
 * and module references using Angular's convention-based structure.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const angularResolver: FrameworkResolver = {
  name: 'angular',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('angular.json') || context.fileExists('.angular.json')) return true;
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ('@angular/core' in deps) return true;
      } catch { /* ignore */ }
    }
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve service references (e.g., AuthService, UserService)
    if (ref.referenceName.endsWith('Service')) {
      const id = resolveByConvention(ref.referenceName, 'service', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    // Resolve component references (e.g., AppComponent, HeaderComponent)
    if (ref.referenceName.endsWith('Component')) {
      const id = resolveByConvention(ref.referenceName, 'component', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    // Resolve module references
    if (ref.referenceName.endsWith('Module')) {
      const id = resolveByConvention(ref.referenceName, 'module', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve guard references
    if (ref.referenceName.endsWith('Guard')) {
      const id = resolveByConvention(ref.referenceName, 'guard', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve pipe references
    if (ref.referenceName.endsWith('Pipe')) {
      const id = resolveByConvention(ref.referenceName, 'pipe', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve directive references
    if (ref.referenceName.endsWith('Directive')) {
      const id = resolveByConvention(ref.referenceName, 'directive', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve interceptor references
    if (ref.referenceName.endsWith('Interceptor')) {
      const id = resolveByConvention(ref.referenceName, 'interceptor', context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Generic class reference
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveAngularClass(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.7, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Extract routes from routing modules
    if (filePath.includes('routing') || filePath.includes('routes') || filePath.includes('.routes.')) {
      // Pattern: { path: 'users', component: UsersComponent }
      const routePattern = /path:\s*['"]([^'"]*)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = routePattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const routePath = `/${match[1]}`;
        const name = `ROUTE ${routePath}`;
        nodes.push({
          id: `route:${filePath}:ROUTE:${routePath}:${line}`,
          kind: 'route', name,
          qualifiedName: `${filePath}::${name}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'typescript', updatedAt: now,
        });
      }
    }

    return nodes;
  },
};

/**
 * Resolve an Angular class by its naming convention.
 * E.g., AuthService → auth.service.ts, HeaderComponent → header.component.ts
 */
function resolveByConvention(name: string, suffix: string, context: ResolutionContext): string | null {
  // Convert PascalCase to kebab-case: AuthService → auth, HeaderComponent → header
  const baseName = name.replace(new RegExp(`${suffix}$`, 'i'), '');
  const kebab = baseName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  const expectedFile = `${kebab}.${suffix}.ts`;

  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.ts')) continue;
    if (file.endsWith(expectedFile) || file.includes(`/${expectedFile}`)) {
      const node = context.getNodesInFile(file).find(n => n.name === name);
      if (node) return node.id;
    }
  }

  // Fallback: search by name in any .ts file
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.ts')) continue;
    const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'class');
    if (node) return node.id;
  }
  return null;
}

function resolveAngularClass(name: string, context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.ts')) continue;
    const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'class');
    if (node) return node.id;
  }
  return null;
}
