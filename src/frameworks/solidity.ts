/**
 * Solidity Framework Resolver (OpenZeppelin, Hardhat, Foundry)
 */

import type { Node } from '../types';
import type { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from './types';

export const solidityResolver: FrameworkResolver = {
  name: 'solidity',
  detect(context: ResolutionContext): boolean {
    if (context.fileExists('hardhat.config.ts') || context.fileExists('hardhat.config.js')) return true;
    if (context.fileExists('foundry.toml')) return true;
    if (context.fileExists('truffle-config.js')) return true;
    return context.getAllFiles().some(f => f.endsWith('.sol'));
  },
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Resolve interface references (IERC20, IUniswapV2Router, etc.)
    if (ref.referenceName.startsWith('I') && /^I[A-Z]/.test(ref.referenceName)) {
      const id = resolveInterface(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.85, resolvedBy: 'framework' };
    }
    // Resolve contract references (inheritance, instantiation)
    if (/^[A-Z][a-zA-Z0-9]+$/.test(ref.referenceName)) {
      const id = resolveContract(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.8, resolvedBy: 'framework' };
    }
    // Resolve library references
    if (ref.referenceKind === 'function') {
      const id = resolveLibraryFunction(ref.referenceName, context);
      if (id) return { original: ref, targetNodeId: id, confidence: 0.75, resolvedBy: 'framework' };
    }
    return null;
  },
  extractNodes(filePath: string, content: string): Node[] {
    // Solidity doesn't have routes, but we can extract events and modifiers
    // as they form part of the contract's public API
    return [];
  },
};

function resolveInterface(name: string, context: ResolutionContext): string | null {
  const dirs = ['interfaces', 'contracts/interfaces', 'src/interfaces'];
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.sol')) continue;
    if (dirs.some(d => file.includes(`/${d}/`))) {
      const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'interface');
      if (node) return node.id;
    }
  }
  // Fallback: search all .sol files
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.sol')) continue;
    const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'interface');
    if (node) return node.id;
  }
  return null;
}

function resolveContract(name: string, context: ResolutionContext): string | null {
  const dirs = ['contracts', 'src', 'lib'];
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.sol')) continue;
    if (dirs.some(d => file.includes(`/${d}/`))) {
      const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'class');
      if (node) return node.id;
    }
  }
  return null;
}

function resolveLibraryFunction(name: string, context: ResolutionContext): string | null {
  const dirs = ['libraries', 'contracts/libraries', 'lib'];
  for (const file of context.getAllFiles()) {
    if (!file.endsWith('.sol')) continue;
    if (dirs.some(d => file.includes(`/${d}/`))) {
      const node = context.getNodesInFile(file).find(n => n.name === name && n.kind === 'function');
      if (node) return node.id;
    }
  }
  return null;
}
