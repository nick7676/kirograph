/**
 * Layer detector for Solidity projects (Hardhat, Foundry, Truffle).
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // Core contracts (business logic)
  ['service', '**/contracts/**', 0.85],
  ['service', '**/src/**/*.sol', 0.8],

  // Interfaces (API surface)
  ['api', '**/interfaces/**', 0.95],
  ['api', '**/contracts/interfaces/**', 0.95],
  ['api', '**/src/interfaces/**', 0.95],
  ['api', '**/IInterface*.sol', 0.85],
  ['api', '**/I[A-Z]*.sol', 0.8],

  // Libraries (shared utilities)
  ['shared', '**/libraries/**', 0.9],
  ['shared', '**/contracts/libraries/**', 0.9],
  ['shared', '**/contracts/utils/**', 0.85],
  ['shared', '**/contracts/lib/**', 0.85],
  ['shared', '**/lib/**', 0.8],

  // Data layer (storage, models)
  ['data', '**/contracts/storage/**', 0.9],
  ['data', '**/contracts/models/**', 0.85],
  ['data', '**/migrations/**', 0.9],
  ['data', '**/deploy/**', 0.8],
  ['data', '**/script/**', 0.8],

  // Test layer (not a standard arch layer but useful for classification)
  ['shared', '**/test/**', 0.75],
  ['shared', '**/tests/**', 0.75],
  ['shared', '**/mocks/**', 0.8],
  ['shared', '**/contracts/mocks/**', 0.85],
];

export const solidityLayerDetector: LayerDetector = {
  language: 'solidity',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.sol')) continue;

      const configMatch = _matchConfig(file, configMatchers);
      if (configMatch) { results.push({ ...configMatch, filePath: file }); continue; }

      let best: ArchLayerMatch | null = null;
      for (const [layerName, pattern, confidence] of LAYER_PATTERNS) {
        if (picomatch(pattern)(file)) {
          if (!best || confidence > best.confidence) {
            best = { layerName, filePath: file, confidence, matchedPattern: pattern };
          }
        }
      }
      if (best) results.push(best);
    }
    return results;
  },
};

function _buildConfigMatchers(configLayers: Record<string, string[]>): Array<[string, ReturnType<typeof picomatch>, string]> {
  return Object.entries(configLayers).flatMap(([layerName, patterns]) =>
    patterns.map((pattern): [string, ReturnType<typeof picomatch>, string] =>
      [layerName, picomatch(pattern), pattern]
    )
  );
}

function _matchConfig(file: string, matchers: Array<[string, ReturnType<typeof picomatch>, string]>): Omit<ArchLayerMatch, 'filePath'> | null {
  for (const [layerName, matcher, pattern] of matchers) {
    if (matcher(file)) return { layerName, confidence: 1.0, matchedPattern: `config:${pattern}` };
  }
  return null;
}
