/**
 * Kubernetes / Helm Framework Resolver
 *
 * Extracts Deployments, Services, ConfigMaps, Ingress routes from K8s manifests.
 * Detects both raw manifests and Helm charts.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const kubernetesResolver: FrameworkResolver = {
  name: 'kubernetes',
  detect(context: ResolutionContext): boolean {
    // Helm chart
    if (context.fileExists('Chart.yaml') || context.fileExists('Chart.yml')) return true;
    // K8s manifests directory
    if (context.getAllFiles().some(f =>
      (f.includes('k8s/') || f.includes('kubernetes/') || f.includes('manifests/') || f.includes('deploy/')) &&
      (f.endsWith('.yaml') || f.endsWith('.yml'))
    )) {
      // Verify at least one file has apiVersion
      for (const file of context.getAllFiles()) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        if (!file.includes('k8s/') && !file.includes('kubernetes/') && !file.includes('manifests/') && !file.includes('deploy/')) continue;
        const content = context.readFile(file);
        if (content && content.includes('apiVersion:') && content.includes('kind:')) return true;
      }
    }
    return false;
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve K8s resource name references (e.g., service names, configmap names)
    if (/^[a-z][a-z0-9-]*$/.test(ref.referenceName)) {
      const id = resolveK8sResource(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.75, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    if (!content.includes('apiVersion:') || !content.includes('kind:')) return nodes;

    // Split multi-document YAML
    const documents = content.split(/^---\s*$/m);

    for (const doc of documents) {
      if (!doc.trim()) continue;

      const kindMatch = doc.match(/^kind:\s*(\w+)/m);
      const nameMatch = doc.match(/^\s+name:\s*["']?([^\s"']+)/m);
      const apiVersionMatch = doc.match(/^apiVersion:\s*(\S+)/m);

      if (!kindMatch || !nameMatch) continue;

      const kind = kindMatch[1]!;
      const name = nameMatch[1]!;
      const apiVersion = apiVersionMatch ? apiVersionMatch[1]! : '';
      const docStart = content.indexOf(doc);
      const line = content.slice(0, docStart).split('\n').length;

      // Map K8s kinds to graph node kinds
      const nodeKind = mapK8sKind(kind);
      if (!nodeKind) continue;

      nodes.push({
        id: `k8s:${filePath}:${kind}:${name}:${line}`,
        kind: nodeKind,
        name: `${kind}/${name}`,
        qualifiedName: `${filePath}::${kind}.${name}`,
        filePath, startLine: line, endLine: line + doc.split('\n').length - 1,
        startColumn: 0, endColumn: 0,
        language: 'yaml', updatedAt: now,
        signature: `${kind} (${apiVersion})`,
      });

      // Extract Ingress routes
      if (kind === 'Ingress') {
        const pathPattern = /path:\s*["']?([^\s"']+)["']?/g;
        let pathMatch: RegExpExecArray | null;
        while ((pathMatch = pathPattern.exec(doc)) !== null) {
          const pathLine = content.slice(0, docStart).split('\n').length +
            doc.slice(0, pathMatch.index).split('\n').length - 1;
          const routePath = pathMatch[1]!;
          nodes.push({
            id: `route:${filePath}:INGRESS:${routePath}:${pathLine}`,
            kind: 'route',
            name: `INGRESS ${routePath}`,
            qualifiedName: `${filePath}::ingress.${routePath}`,
            filePath, startLine: pathLine, endLine: pathLine, startColumn: 0, endColumn: pathMatch[0].length,
            language: 'yaml', updatedAt: now,
          });
        }
      }

      // Extract Service ports
      if (kind === 'Service') {
        const portPattern = /port:\s*(\d+)/g;
        let portMatch: RegExpExecArray | null;
        while ((portMatch = portPattern.exec(doc)) !== null) {
          const portLine = content.slice(0, docStart).split('\n').length +
            doc.slice(0, portMatch.index).split('\n').length - 1;
          const port = portMatch[1]!;
          nodes.push({
            id: `route:${filePath}:SVC:${name}:${port}:${portLine}`,
            kind: 'route',
            name: `${name}:${port}`,
            qualifiedName: `${filePath}::svc.${name}.${port}`,
            filePath, startLine: portLine, endLine: portLine, startColumn: 0, endColumn: portMatch[0].length,
            language: 'yaml', updatedAt: now,
          });
        }
      }
    }

    return nodes;
  },
};

function mapK8sKind(kind: string): Node['kind'] | null {
  switch (kind) {
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'Job':
    case 'CronJob':
      return 'component';
    case 'Service':
    case 'Ingress':
    case 'Gateway':
    case 'VirtualService':
      return 'route';
    case 'ConfigMap':
    case 'Secret':
      return 'variable';
    case 'Namespace':
      return 'namespace';
    case 'ServiceAccount':
    case 'Role':
    case 'ClusterRole':
    case 'RoleBinding':
    case 'ClusterRoleBinding':
      return 'interface';
    case 'PersistentVolumeClaim':
    case 'PersistentVolume':
    case 'StorageClass':
      return 'variable';
    case 'HorizontalPodAutoscaler':
    case 'NetworkPolicy':
      return 'variable';
    case 'CustomResourceDefinition':
      return 'type_alias';
    default:
      return 'class';
  }
}

function resolveK8sResource(name: string, context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const node = context.getNodesInFile(file).find(n =>
      n.name.endsWith(`/${name}`) || n.name === name
    );
    if (node) return node.id;
  }
  return null;
}
