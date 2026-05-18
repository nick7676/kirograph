/**
 * Docker Compose Framework Resolver
 *
 * Extracts services, networks, volumes from docker-compose files.
 * Maps depends_on relationships as edges.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const dockerComposeResolver: FrameworkResolver = {
  name: 'docker-compose',
  detect(context: ResolutionContext): boolean {
    return (
      context.fileExists('docker-compose.yml') ||
      context.fileExists('docker-compose.yaml') ||
      context.fileExists('compose.yml') ||
      context.fileExists('compose.yaml')
    );
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve service name references
    if (/^[a-z][a-z0-9_-]*$/.test(ref.referenceName)) {
      const id = resolveService(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.8, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    const basename = filePath.split('/').pop() ?? '';
    if (!basename.match(/^(docker-)?compose\.(ya?ml)$/)) return nodes;

    // Extract services
    const servicesMatch = content.match(/^services:\s*\n([\s\S]*?)(?=^(?:networks|volumes|configs|secrets):|$(?![\s\S]))/m);
    if (servicesMatch) {
      const servicePattern = /^\s{2}([a-zA-Z0-9_-]+):\s*$/gm;
      let match: RegExpExecArray | null;
      const sectionStart = content.indexOf(servicesMatch[0]);
      while ((match = servicePattern.exec(servicesMatch[1])) !== null) {
        const line = content.slice(0, sectionStart + match.index).split('\n').length;
        const serviceName = match[1]!;
        nodes.push({
          id: `docker:${filePath}:service:${serviceName}:${line}`,
          kind: 'component',
          name: serviceName,
          qualifiedName: `${filePath}::service.${serviceName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
          signature: `service "${serviceName}"`,
        });
      }
    }

    // Extract networks
    const networksMatch = content.match(/^networks:\s*\n([\s\S]*?)(?=^(?:services|volumes|configs|secrets):|$(?![\s\S]))/m);
    if (networksMatch) {
      const networkPattern = /^\s{2}([a-zA-Z0-9_-]+):\s*$/gm;
      let match: RegExpExecArray | null;
      const sectionStart = content.indexOf(networksMatch[0]);
      while ((match = networkPattern.exec(networksMatch[1])) !== null) {
        const line = content.slice(0, sectionStart + match.index).split('\n').length;
        const networkName = match[1]!;
        nodes.push({
          id: `docker:${filePath}:network:${networkName}:${line}`,
          kind: 'variable',
          name: `network.${networkName}`,
          qualifiedName: `${filePath}::network.${networkName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
        });
      }
    }

    // Extract volumes
    const volumesMatch = content.match(/^volumes:\s*\n([\s\S]*?)(?=^(?:services|networks|configs|secrets):|$(?![\s\S]))/m);
    if (volumesMatch) {
      const volumePattern = /^\s{2}([a-zA-Z0-9_-]+):\s*$/gm;
      let match: RegExpExecArray | null;
      const sectionStart = content.indexOf(volumesMatch[0]);
      while ((match = volumePattern.exec(volumesMatch[1])) !== null) {
        const line = content.slice(0, sectionStart + match.index).split('\n').length;
        const volumeName = match[1]!;
        nodes.push({
          id: `docker:${filePath}:volume:${volumeName}:${line}`,
          kind: 'variable',
          name: `volume.${volumeName}`,
          qualifiedName: `${filePath}::volume.${volumeName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
          language: 'yaml', updatedAt: now,
        });
      }
    }

    // Extract exposed ports as route-like nodes
    const portsPattern = /^\s{4}-\s*["']?(\d+):(\d+)["']?\s*$/gm;
    let portMatch: RegExpExecArray | null;
    while ((portMatch = portsPattern.exec(content)) !== null) {
      const line = content.slice(0, portMatch.index).split('\n').length;
      const hostPort = portMatch[1]!;
      const containerPort = portMatch[2]!;
      // Find which service this port belongs to
      const preceding = content.slice(0, portMatch.index);
      const serviceMatch = preceding.match(/^\s{2}([a-zA-Z0-9_-]+):\s*$/gm);
      const serviceName = serviceMatch ? serviceMatch[serviceMatch.length - 1]!.trim().replace(':', '') : 'unknown';
      nodes.push({
        id: `docker:${filePath}:port:${hostPort}:${line}`,
        kind: 'route',
        name: `${serviceName.trim()} :${hostPort}→:${containerPort}`,
        qualifiedName: `${filePath}::port.${hostPort}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: portMatch[0].length,
        language: 'yaml', updatedAt: now,
      });
    }

    return nodes;
  },
};

function resolveService(name: string, context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (!file.match(/compose\.(ya?ml)$/)) continue;
    const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'component');
    if (node) return node.id;
  }
  return null;
}
