/**
 * Ansible Framework Resolver
 *
 * Extracts playbooks, roles, tasks, handlers from Ansible projects.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const ansibleResolver: FrameworkResolver = {
  name: 'ansible',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('ansible.cfg')) return true;
    if (context.fileExists('playbook.yml') || context.fileExists('playbook.yaml')) return true;
    if (context.fileExists('site.yml') || context.fileExists('site.yaml')) return true;
    // Standard Ansible directory structure
    return (
      context.getAllFiles().some(f => f.includes('roles/') && f.includes('/tasks/')) ||
      context.getAllFiles().some(f => f.includes('playbooks/') && (f.endsWith('.yml') || f.endsWith('.yaml')))
    );
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve role references
    if (/^[a-z][a-z0-9_.-]*$/.test(ref.referenceName)) {
      const id = resolveRole(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.8, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    // Extract playbook plays (top-level list items with hosts:)
    if (filePath.includes('playbook') || filePath.includes('site.') || filePath.includes('playbooks/')) {
      const playPattern = /^-\s+name:\s*["']?(.+?)["']?\s*$/gm;
      let match: RegExpExecArray | null;
      while ((match = playPattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const playName = match[1]!.trim();
        nodes.push({
          id: `ansible:${filePath}:play:${playName}:${line}`,
          kind: 'function',
          name: playName,
          qualifiedName: `${filePath}::play.${playName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
          signature: `play "${playName}"`,
        });
      }
    }

    // Extract tasks
    if (filePath.includes('/tasks/') || filePath.includes('/handlers/')) {
      const taskPattern = /^-\s+name:\s*["']?(.+?)["']?\s*$/gm;
      let match: RegExpExecArray | null;
      while ((match = taskPattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const taskName = match[1]!.trim();
        const isHandler = filePath.includes('/handlers/');
        nodes.push({
          id: `ansible:${filePath}:${isHandler ? 'handler' : 'task'}:${taskName}:${line}`,
          kind: 'method',
          name: taskName,
          qualifiedName: `${filePath}::${isHandler ? 'handler' : 'task'}.${taskName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
          signature: `${isHandler ? 'handler' : 'task'} "${taskName}"`,
        });
      }
    }

    // Extract role from directory structure (roles/rolename/tasks/main.yml)
    if (filePath.includes('/roles/') && filePath.includes('/tasks/main.')) {
      const roleMatch = filePath.match(/roles\/([^/]+)\//);
      if (roleMatch) {
        const roleName = roleMatch[1]!;
        nodes.push({
          id: `ansible:${filePath}:role:${roleName}:1`,
          kind: 'namespace',
          name: `role.${roleName}`,
          qualifiedName: `${filePath}::role.${roleName}`,
          filePath, startLine: 1, endLine: 1, startColumn: 0, endColumn: 0,
          language: 'yaml', updatedAt: now,
          signature: `role "${roleName}"`,
        });
      }
    }

    // Extract variables from vars/ or defaults/
    if (filePath.includes('/vars/') || filePath.includes('/defaults/') || filePath.includes('/group_vars/') || filePath.includes('/host_vars/')) {
      const varPattern = /^(\w+):\s*/gm;
      let match: RegExpExecArray | null;
      while ((match = varPattern.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        const varName = match[1]!;
        if (varName === '---' || varName === 'all') continue;
        nodes.push({
          id: `ansible:${filePath}:var:${varName}:${line}`,
          kind: 'variable',
          name: varName,
          qualifiedName: `${filePath}::var.${varName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
        });
      }
    }

    return nodes;
  },
};

function resolveRole(name: string, context: ResolutionContext): string | null {
  // Look for roles/name/tasks/main.yml
  const candidates = [
    `roles/${name}/tasks/main.yml`,
    `roles/${name}/tasks/main.yaml`,
  ];
  for (const candidate of candidates) {
    if (context.fileExists(candidate)) {
      const nodes = context.getNodesInFile(candidate);
      const roleNode = nodes.find(n => n.name === `role.${name}`);
      if (roleNode) return roleNode.id;
      if (nodes.length > 0) return nodes[0].id;
    }
  }
  return null;
}
