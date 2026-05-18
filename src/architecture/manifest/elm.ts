/**
 * Elm elm.json manifest parser.
 * Handles both application and package elm.json files.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const elmParser: ManifestParser = {
  name: 'elm',
  manifestFiles: ['elm.json'],
  language: 'elm',

  canParse(manifestPath: string): boolean {
    return path.basename(manifestPath) === 'elm.json';
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');

    const type = parsed['type'] as string | undefined;
    const externalDeps: string[] = [];

    if (type === 'application') {
      // Application: dependencies are in dependencies.direct and dependencies.indirect
      const deps = parsed['dependencies'] as Record<string, Record<string, string>> | undefined;
      if (deps?.direct) {
        externalDeps.push(...Object.keys(deps.direct));
      }
    } else if (type === 'package') {
      // Package: dependencies are a flat object
      const deps = parsed['dependencies'] as Record<string, string> | undefined;
      if (deps) {
        externalDeps.push(...Object.keys(deps));
      }
    }

    // Package name: for packages it's in "name", for applications use directory name
    const name = (parsed['name'] as string) ?? path.basename(path.dirname(manifestPath));
    const version = parsed['version'] as string | undefined;

    return [{
      id: `pkg:elm:${relDir}`,
      name,
      path: relDir,
      source: 'manifest',
      language: 'elm',
      manifestPath: relManifest,
      version,
      externalDeps,
      metadata: { type: type ?? 'unknown' },
      updatedAt: Date.now(),
    }];
  },
};
