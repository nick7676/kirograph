/**
 * Layer detector for Scala projects (Play, Akka, general SBT).
 */
import type { LayerDetector, ArchLayerMatch } from '../types';
import picomatch from 'picomatch';

const LAYER_PATTERNS: Array<[string, string, number]> = [
  // API layer (Play controllers, Akka HTTP routes)
  ['api', '**/controllers/**', 0.95],
  ['api', '**/*Controller.scala', 0.9],
  ['api', '**/routes/**', 0.9],
  ['api', '**/*Routes.scala', 0.9],
  ['api', '**/*Router.scala', 0.85],
  ['api', '**/api/**', 0.8],
  ['api', '**/http/**', 0.85],
  ['api', '**/endpoints/**', 0.9],

  // Service layer
  ['service', '**/services/**', 0.9],
  ['service', '**/service/**', 0.9],
  ['service', '**/*Service.scala', 0.9],
  ['service', '**/domain/**', 0.8],
  ['service', '**/usecases/**', 0.85],
  ['service', '**/actors/**', 0.85],
  ['service', '**/*Actor.scala', 0.85],

  // Data layer
  ['data', '**/models/**', 0.85],
  ['data', '**/*Model.scala', 0.85],
  ['data', '**/repositories/**', 0.9],
  ['data', '**/*Repository.scala', 0.9],
  ['data', '**/*Repo.scala', 0.9],
  ['data', '**/dao/**', 0.9],
  ['data', '**/*DAO.scala', 0.9],
  ['data', '**/persistence/**', 0.85],
  ['data', '**/db/**', 0.85],
  ['data', '**/slick/**', 0.85],
  ['data', '**/evolutions/**', 0.85],

  // UI layer (Play views/templates)
  ['ui', '**/views/**', 0.85],
  ['ui', '**/*.scala.html', 0.9],
  ['ui', '**/templates/**', 0.8],

  // Shared / infrastructure
  ['shared', '**/util/**', 0.85],
  ['shared', '**/utils/**', 0.85],
  ['shared', '**/common/**', 0.8],
  ['shared', '**/config/**', 0.8],
  ['shared', '**/modules/**', 0.75],
  ['shared', '**/filters/**', 0.8],
  ['shared', '**/middleware/**', 0.85],
];

export const scalaLayerDetector: LayerDetector = {
  language: 'scala',

  async detect(files: string[], _projectRoot: string, configLayers?: Record<string, string[]>): Promise<ArchLayerMatch[]> {
    const results: ArchLayerMatch[] = [];
    const configMatchers = _buildConfigMatchers(configLayers ?? {});

    for (const file of files) {
      if (!file.endsWith('.scala') && !file.endsWith('.sc')) continue;

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
