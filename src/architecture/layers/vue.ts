/**
 * Layer detector for Vue / Nuxt projects.
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API layer (Nuxt server routes, API handlers)
  ['api', '**/server/api/**', 0.95],
  ['api', '**/server/routes/**', 0.9],
  ['api', '**/server/middleware/**', 0.85],
  ['api', '**/api/**/*.ts', 0.8],
  ['api', '**/api/**/*.js', 0.8],

  // Service layer (composables, stores, utils with business logic)
  ['service', '**/composables/**', 0.9],
  ['service', '**/stores/**', 0.9],
  ['service', '**/store/**', 0.9],
  ['service', '**/services/**', 0.9],
  ['service', '**/use*.ts', 0.8],

  // Data layer (server-side data access, plugins for data)
  ['data', '**/server/models/**', 0.9],
  ['data', '**/server/db/**', 0.9],
  ['data', '**/prisma/**', 0.85],
  ['data', '**/drizzle/**', 0.85],
  ['data', '**/models/**', 0.8],

  // UI layer (pages, components, layouts)
  ['ui', '**/pages/**', 0.95],
  ['ui', '**/components/**', 0.9],
  ['ui', '**/layouts/**', 0.9],
  ['ui', '**/*.vue', 0.75],
  ['ui', '**/views/**', 0.85],

  // Shared / infrastructure
  ['shared', '**/plugins/**', 0.8],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/helpers/**', 0.8],
  ['shared', '**/types/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/middleware/**', 0.8],
  ['shared', '**/assets/**', 0.75],
];

export const vueLayerDetector: LayerDetector = {
  language: 'vue',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.vue') && !file.endsWith('.ts') && !file.endsWith('.js')) continue;

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
