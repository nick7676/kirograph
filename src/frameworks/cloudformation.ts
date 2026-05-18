/**
 * AWS CloudFormation Framework Resolver
 *
 * Handles raw CloudFormation templates (non-SAM).
 * Extracts resources, parameters, outputs, and cross-references.
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const cloudformationResolver: FrameworkResolver = {
  name: 'cloudformation',
  detect(context: ResolutionContext): boolean {
    // Look for CloudFormation templates that are NOT SAM
    for (const name of ['template.yaml', 'template.yml', 'template.json', 'cloudformation.yaml', 'cloudformation.yml']) {
      const content = context.readFile(name);
      if (content && content.includes('AWSTemplateFormatVersion') && !content.includes('AWS::Serverless')) return true;
    }
    // Check for nested stacks or cfn templates in common directories
    return context.getAllFiles().some(f =>
      (f.includes('cloudformation/') || f.includes('cfn/') || f.includes('stacks/')) &&
      (f.endsWith('.yaml') || f.endsWith('.yml')) &&
      !f.includes('node_modules')
    );
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve !Ref and !GetAtt references to resources
    if (/^[A-Z][a-zA-Z0-9]+$/.test(ref.referenceName)) {
      const id = resolveResource(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    const nodes: Node[] = [];
    const now = Date.now();

    if (!content.includes('AWSTemplateFormatVersion') && !content.includes('Resources:')) return nodes;

    // Extract Resources
    const resourcePattern = /^\s{2}(\w+):\s*\n\s+Type:\s*['"]?([^\s'"]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = resourcePattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const logicalId = match[1]!;
      const resourceType = match[2]!;
      nodes.push({
        id: `cfn:${filePath}:resource:${logicalId}:${line}`,
        kind: 'class',
        name: logicalId,
        qualifiedName: `${filePath}::${logicalId}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'yaml', updatedAt: now,
        signature: resourceType,
      });
    }

    // Extract Parameters
    const paramSection = content.match(/^Parameters:\s*\n((?:\s{2}\w+:[\s\S]*?)(?=^\w|\Z))/m);
    if (paramSection) {
      const paramPattern = /^\s{2}(\w+):/gm;
      let paramMatch: RegExpExecArray | null;
      const sectionStart = content.indexOf(paramSection[0]);
      while ((paramMatch = paramPattern.exec(paramSection[1])) !== null) {
        const line = content.slice(0, sectionStart + paramMatch.index).split('\n').length;
        const paramName = paramMatch[1]!;
        nodes.push({
          id: `cfn:${filePath}:param:${paramName}:${line}`,
          kind: 'variable',
          name: paramName,
          qualifiedName: `${filePath}::param.${paramName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: paramMatch[0].length,
          language: 'yaml', updatedAt: now,
        });
      }
    }

    // Extract Outputs
    const outputSection = content.match(/^Outputs:\s*\n((?:\s{2}\w+:[\s\S]*?)(?=^\w|\Z))/m);
    if (outputSection) {
      const outputPattern = /^\s{2}(\w+):/gm;
      let outputMatch: RegExpExecArray | null;
      const sectionStart = content.indexOf(outputSection[0]);
      while ((outputMatch = outputPattern.exec(outputSection[1])) !== null) {
        const line = content.slice(0, sectionStart + outputMatch.index).split('\n').length;
        const outputName = outputMatch[1]!;
        nodes.push({
          id: `cfn:${filePath}:output:${outputName}:${line}`,
          kind: 'variable',
          name: `output.${outputName}`,
          qualifiedName: `${filePath}::output.${outputName}`,
          filePath, startLine: line, endLine: line, startColumn: 0, endColumn: outputMatch[0].length,
          language: 'yaml', updatedAt: now,
          isExported: true,
        });
      }
    }

    // Extract API Gateway routes from AWS::ApiGateway::Method or AWS::ApiGatewayV2::Route
    const apiMethodPattern = /HttpMethod:\s*['"]?(\w+)['"]?/g;
    while ((match = apiMethodPattern.exec(content)) !== null) {
      if (!content.slice(Math.max(0, match.index - 200), match.index).includes('ApiGateway')) continue;
      const line = content.slice(0, match.index).split('\n').length;
      const method = match[1]!.toUpperCase();
      nodes.push({
        id: `route:${filePath}:${method}:cfn:${line}`,
        kind: 'route',
        name: `${method} (CloudFormation)`,
        qualifiedName: `${filePath}::${method}`,
        filePath, startLine: line, endLine: line, startColumn: 0, endColumn: match[0].length,
        language: 'yaml', updatedAt: now,
      });
    }

    return nodes;
  },
};

function resolveResource(logicalId: string, context: ResolutionContext): string | null {
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const node = context.getNodesInFile(file).find(n => n.name === logicalId && n.kind === 'class');
    if (node) return node.id;
  }
  return null;
}
