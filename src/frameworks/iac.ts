/**
 * Infrastructure-as-Code Framework Resolvers
 * Supports: AWS CDK, SST, Serverless Framework, AWS SAM
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

// ── SST ───────────────────────────────────────────────────────────────────────

export const sstResolver: FrameworkResolver = {
  name: 'sst',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('sst.config.ts') || context.fileExists('sst.config.js')) return true;
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ('sst' in deps) return true;
      } catch { /* ignore */ }
    }
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve handler string references (e.g., "src/auth.handler" → handler function in src/auth.ts)
    if (ref.referenceName.includes('.') && !ref.referenceName.startsWith('.')) {
      const id = resolveHandlerString(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    // Resolve construct references
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveConstruct(ref.referenceName, ['stacks', 'infra', 'src', 'lib'], context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.75, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // SST v3 Api routes: api.route("GET /users", "src/users.list")
    const routePattern = /\.route\s*\(\s*["'](\w+)\s+([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = routePattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const method = match[1]!.toUpperCase();
      const routePath = match[2]!;
      const name = `${method} ${routePath}`;
      nodes.push({
        id: `route:${filePath}:${method}:${routePath}:${line}`,
        kind: 'route', name,
        qualifiedName: `${filePath}::${name}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'typescript', updatedAt: now,
      });
    }

    // SST v2 Api routes: routes: { "GET /users": "src/users.list" }
    const routeObjPattern = /["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\s+([^"']+)["']\s*:/g;
    while ((match = routeObjPattern.exec(content)) !== null) {
      // Only match if this looks like an SST/CDK file
      if (!content.includes('sst') && !content.includes('Api') && !content.includes('Function')) continue;
      const line = content.slice(0, match.index).split('\n').length;
      const method = match[1]!;
      const routePath = match[2]!;
      const name = `${method} ${routePath}`;
      const id = `route:${filePath}:${method}:${routePath}:${line}`;
      if (!nodes.some(n => n.id === id)) {
        nodes.push({
          id, kind: 'route', name,
          qualifiedName: `${filePath}::${name}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'typescript', updatedAt: now,
        });
      }
    }

    return nodes;
  },
};

// ── AWS CDK ───────────────────────────────────────────────────────────────────

export const cdkResolver: FrameworkResolver = {
  name: 'cdk',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('cdk.json')) return true;
    const pkg = context.readFile('package.json');
    if (pkg) {
      try {
        const parsed = JSON.parse(pkg);
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ('aws-cdk-lib' in deps || 'aws-cdk' in deps || '@aws-cdk/core' in deps) return true;
      } catch { /* ignore */ }
    }
    // Python CDK
    const requirements = context.readFile('requirements.txt');
    if (requirements && requirements.includes('aws-cdk')) return true;
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve Lambda handler strings
    if (ref.referenceName.includes('.') && !ref.referenceName.startsWith('.')) {
      const id = resolveHandlerString(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    // Resolve Stack/Construct references
    if (/^[A-Z][a-zA-Z]+Stack$/.test(ref.referenceName)) {
      const id = resolveConstruct(ref.referenceName, ['lib', 'stacks', 'infra', 'src'], context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    if (/^[A-Z][a-zA-Z]+Construct$/.test(ref.referenceName) || /^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const id = resolveConstruct(ref.referenceName, ['lib', 'constructs', 'src', 'infra'], context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.7, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // CDK API Gateway: addMethod('GET', ...) or addResource('/users')
    const addMethodPattern = /\.addMethod\s*\(\s*['"](\w+)['"]/g;
    const addResourcePattern = /\.addResource\s*\(\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    // Track resources for building full paths
    const resources: Array<{ path: string; line: number }> = [];
    while ((match = addResourcePattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      resources.push({ path: match[1]!, line });
    }

    while ((match = addMethodPattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const method = match[1]!.toUpperCase();
      // Try to find the nearest resource path above this line
      const nearestResource = resources.filter(r => r.line <= line).pop();
      const routePath = nearestResource ? `/${nearestResource.path}` : '/';
      const name = `${method} ${routePath}`;
      nodes.push({
        id: `route:${filePath}:${method}:${routePath}:${line}`,
        kind: 'route', name,
        qualifiedName: `${filePath}::${name}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: filePath.endsWith('.py') ? 'python' : 'typescript', updatedAt: now,
      });
    }

    // CDK HttpApi / RestApi route patterns
    const httpApiPattern = /addRoutes\s*\(\s*\{[^}]*path\s*:\s*['"]([^'"]+)['"][^}]*methods\s*:\s*\[([^\]]+)\]/gs;
    while ((match = httpApiPattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const routePath = match[1]!;
      const methods = match[2]!.match(/HttpMethod\.(\w+)/g) ?? [];
      for (const m of methods) {
        const method = m.replace('HttpMethod.', '');
        const name = `${method} ${routePath}`;
        nodes.push({
          id: `route:${filePath}:${method}:${routePath}:${line}`,
          kind: 'route', name,
          qualifiedName: `${filePath}::${name}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: filePath.endsWith('.py') ? 'python' : 'typescript', updatedAt: now,
        });
      }
    }

    return nodes;
  },
};

// ── Serverless Framework ──────────────────────────────────────────────────────

export const serverlessResolver: FrameworkResolver = {
  name: 'serverless',
  detect(context: ResolutionContext): boolean {
    return (
      context.fileExists('serverless.yml') ||
      context.fileExists('serverless.yaml') ||
      context.fileExists('serverless.ts') ||
      context.fileExists('serverless.js')
    );
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve handler references (e.g., "src/handlers/auth.login")
    if (ref.referenceName.includes('.') && !ref.referenceName.startsWith('.')) {
      const id = resolveHandlerString(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Only process serverless config files
    const basename = filePath.split('/').pop() ?? '';
    if (!basename.startsWith('serverless.')) return nodes;

    if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
      // YAML: extract HTTP events
      // Pattern: path: /users\n ... method: get
      const functionBlocks = content.split(/^\s{2}\w+:/gm);
      const httpPattern = /- http(?:Api)?:\s*\n\s+(?:method:\s*(\w+)\s*\n\s+path:\s*(\S+)|path:\s*(\S+)\s*\n\s+method:\s*(\w+))/g;
      const simpleHttpPattern = /- http(?:Api)?:\s*(\w+)\s+(\S+)/g;

      let match: RegExpExecArray | null;
      while ((match = httpPattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const method = (match[1] || match[4])!.toUpperCase();
        const routePath = (match[2] || match[3])!;
        const name = `${method} ${routePath}`;
        nodes.push({
          id: `route:${filePath}:${method}:${routePath}:${line}`,
          kind: 'route', name,
          qualifiedName: `${filePath}::${name}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
        });
      }

      while ((match = simpleHttpPattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const method = match[1]!.toUpperCase();
        const routePath = match[2]!;
        const name = `${method} ${routePath}`;
        const id = `route:${filePath}:${method}:${routePath}:${line}`;
        if (!nodes.some(n => n.id === id)) {
          nodes.push({
            id, kind: 'route', name,
            qualifiedName: `${filePath}::${name}`,
            filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
            language: 'yaml', updatedAt: now,
          });
        }
      }
    } else {
      // TypeScript/JavaScript serverless config: extract from object literals
      const routePattern = /["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ANY)\s+([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = routePattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const method = match[1]!;
        const routePath = match[2]!;
        const name = `${method} ${routePath}`;
        nodes.push({
          id: `route:${filePath}:${method}:${routePath}:${line}`,
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

// ── AWS SAM ───────────────────────────────────────────────────────────────────

export const samResolver: FrameworkResolver = {
  name: 'sam',
  detect(context: ResolutionContext): boolean {
    for (const name of ['template.yaml', 'template.yml', 'sam.yaml', 'sam.yml']) {
      const content = context.readFile(name);
      if (content && content.includes('AWS::Serverless')) return true;
    }
    if (context.fileExists('samconfig.toml') || context.fileExists('samconfig.yaml')) return true;
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve handler references
    if (ref.referenceName.includes('.') && !ref.referenceName.startsWith('.')) {
      const id = resolveHandlerString(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.9, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Only process SAM template files
    const basename = filePath.split('/').pop() ?? '';
    if (!basename.match(/^(template|sam)\.(ya?ml)$/)) return nodes;
    if (!content.includes('AWS::Serverless')) return nodes;

    // Extract API events from SAM template
    // Pattern: Type: Api\n Properties:\n   Path: /users\n   Method: get
    const apiEventPattern = /Type:\s*(?:Api|HttpApi)\s*\n\s+Properties:\s*\n(?:\s+.*\n)*?\s+Path:\s*(\S+)\s*\n(?:\s+.*\n)*?\s+Method:\s*(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = apiEventPattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const routePath = match[1]!;
      const method = match[2]!.toUpperCase();
      const name = `${method} ${routePath}`;
      nodes.push({
        id: `route:${filePath}:${method}:${routePath}:${line}`,
        kind: 'route', name,
        qualifiedName: `${filePath}::${name}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'yaml', updatedAt: now,
      });
    }

    // Simpler pattern: Method + Path on same indentation level (either order)
    const simplePattern = /Method:\s*(\w+)\s*\n\s+Path:\s*(\S+)|Path:\s*(\S+)\s*\n\s+Method:\s*(\w+)/g;
    while ((match = simplePattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const method = (match[1] || match[4])!.toUpperCase();
      const routePath = (match[2] || match[3])!;
      const name = `${method} ${routePath}`;
      const id = `route:${filePath}:${method}:${routePath}:${line}`;
      if (!nodes.some(n => n.id === id)) {
        nodes.push({
          id, kind: 'route', name,
          qualifiedName: `${filePath}::${name}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
        });
      }
    }

    return nodes;
  },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Resolve a handler string like "src/auth.handler" or "handlers/users.list"
 * to the actual function symbol in the codebase.
 */
function resolveHandlerString(handlerStr: string, context: ResolutionContext): string | null {
  // Split "path/to/file.functionName" into file path and function name
  const lastDot = handlerStr.lastIndexOf('.');
  if (lastDot <= 0) return null;

  const filePart = handlerStr.slice(0, lastDot);
  const funcName = handlerStr.slice(lastDot + 1);

  // Try common extensions
  const extensions = ['.ts', '.js', '.mjs', '.py', '.go'];
  for (const ext of extensions) {
    const candidates = [
      `${filePart}${ext}`,
      `${filePart}/index${ext}`,
    ];
    for (const candidate of candidates) {
      if (context.fileExists(candidate)) {
        const node = context.getNodesInFile(candidate).find(
          n => n.name === funcName && (n.kind === 'function' || n.kind === 'method' || n.kind === 'variable')
        );
        if (node) return node.id;
      }
    }
  }

  // Fallback: search all files for the function name in likely directories
  const dirs = ['src', 'lib', 'handlers', 'functions', 'lambdas', 'api'];
  for (const file of context.getAllFiles()) {
    if (!dirs.some(d => file.includes(`/${d}/`) || file.startsWith(`${d}/`))) continue;
    if (!file.includes(filePart.split('/').pop()!)) continue;
    const node = context.getNodesInFile(file).find(
      n => n.name === funcName && (n.kind === 'function' || n.kind === 'method' || n.kind === 'variable')
    );
    if (node) return node.id;
  }

  return null;
}

/**
 * Resolve a construct/stack class reference by searching in typical IaC directories.
 */
function resolveConstruct(name: string, dirs: string[], context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (!(file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.py'))) continue;
    if (!dirs.some(d => file.includes(`/${d}/`) || file.startsWith(`${d}/`))) continue;
    const node = context.getNodesInFile(file).find(
      n => n.name === name && (n.kind === 'class' || n.kind === 'function' || n.kind === 'variable')
    );
    if (node) return node.id;
  }
  return null;
}
