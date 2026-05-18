/**
 * Layer detector for OCaml projects (Dune-based).
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API layer (HTTP handlers, CLI entry points)
  ['api', '**/bin/**', 0.85],
  ['api', '**/handler/**', 0.9],
  ['api', '**/handlers/**', 0.9],
  ['api', '**/routes/**', 0.9],
  ['api', '**/server/**', 0.85],
  ['api', '**/*_handler.ml', 0.9],

  // Service layer (domain logic)
  ['service', '**/domain/**', 0.9],
  ['service', '**/service/**', 0.9],
  ['service', '**/services/**', 0.9],
  ['service', '**/core/**', 0.85],
  ['service', '**/logic/**', 0.85],

  // Data layer (persistence, models)
  ['data', '**/db/**', 0.9],
  ['data', '**/database/**', 0.9],
  ['data', '**/models/**', 0.85],
  ['data', '**/repo/**', 0.9],
  ['data', '**/storage/**', 0.85],
  ['data', '**/migrations/**', 0.85],

  // Shared / library layer
  ['shared', '**/lib/**', 0.8],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/middleware/**', 0.8],
];

export const ocamlLayerDetector: LayerDetector = {
  language: 'ocaml',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.ml') && !file.endsWith('.mli')) continue;

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
