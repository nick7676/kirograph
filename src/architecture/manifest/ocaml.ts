/**
 * OCaml manifest parser.
 * Handles dune-project and .opam files.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const ocamlParser: ManifestParser = {
  name: 'ocaml',
  manifestFiles: ['dune-project'],
  language: 'ocaml',

  canParse(manifestPath: string): boolean {
    const base = path.basename(manifestPath);
    return base === 'dune-project' || base.endsWith('.opam');
  },

  async parse(manifestPath: string, projectRoot: string): Promise<ArchPackage[]> {
    let content: string;
    try {
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch {
      return [];
    }

    const relDir = path.relative(projectRoot, path.dirname(manifestPath)).replace(/\\/g, '/') || '.';
    const relManifest = path.relative(projectRoot, manifestPath).replace(/\\/g, '/');
    const base = path.basename(manifestPath);

    if (base === 'dune-project') {
      return parseDuneProject(content, relDir, relManifest, projectRoot, manifestPath);
    }

    // .opam file
    return parseOpam(content, base, relDir, relManifest);
  },
};

function parseDuneProject(
  content: string,
  relDir: string,
  relManifest: string,
  projectRoot: string,
  manifestPath: string
): ArchPackage[] {
  const packages: ArchPackage[] = [];

  // Extract project name: (name my-project)
  const nameMatch = content.match(/\(name\s+([^\s)]+)\)/);
  const name = nameMatch ? nameMatch[1]! : path.basename(path.dirname(manifestPath));

  // Extract version: (version 1.0.0)
  const versionMatch = content.match(/\(version\s+([^\s)]+)\)/);
  const version = versionMatch ? versionMatch[1] : undefined;

  // Extract dependencies from (depends ...) block
  const externalDeps: string[] = [];
  const dependsMatch = content.match(/\(depends([\s\S]*?)\)(?:\s*\(|$)/);
  if (dependsMatch) {
    // Each dep is either a bare name or (name (>= version))
    const depPattern = /\(([a-zA-Z0-9_-]+)[\s)]/g;
    const bareDep = /^\s+([a-zA-Z0-9_-]+)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = depPattern.exec(dependsMatch[1])) !== null) {
      if (m[1] !== 'and' && m[1] !== 'or') externalDeps.push(m[1]);
    }
    while ((m = bareDep.exec(dependsMatch[1])) !== null) {
      externalDeps.push(m[1]);
    }
  }

  packages.push({
    id: `pkg:ocaml:${relDir}`,
    name,
    path: relDir,
    source: 'manifest',
    language: 'ocaml',
    manifestPath: relManifest,
    version,
    externalDeps,
    updatedAt: Date.now(),
  });

  // Look for sub-libraries defined in dune files
  const duneDir = path.dirname(path.join(projectRoot, relManifest));
  const subDirs = findDuneLibraries(duneDir, projectRoot);
  for (const sub of subDirs) {
    if (sub.path !== relDir) {
      packages.push({
        id: `pkg:ocaml:${sub.path}`,
        name: sub.name,
        path: sub.path,
        source: 'manifest',
        language: 'ocaml',
        manifestPath: relManifest,
        updatedAt: Date.now(),
      });
    }
  }

  return packages;
}

function parseOpam(content: string, filename: string, relDir: string, relManifest: string): ArchPackage[] {
  const name = filename.replace('.opam', '');
  const versionMatch = content.match(/^version:\s*"([^"]+)"/m);
  const version = versionMatch ? versionMatch[1] : undefined;

  const externalDeps: string[] = [];
  const dependsMatch = content.match(/^depends:\s*\[([\s\S]*?)\]/m);
  if (dependsMatch) {
    const depPattern = /"([a-zA-Z0-9_-]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = depPattern.exec(dependsMatch[1])) !== null) {
      externalDeps.push(m[1]);
    }
  }

  return [{
    id: `pkg:ocaml:${relDir}:${name}`,
    name,
    path: relDir,
    source: 'manifest',
    language: 'ocaml',
    manifestPath: relManifest,
    version,
    externalDeps,
    updatedAt: Date.now(),
  }];
}

function findDuneLibraries(dir: string, projectRoot: string): Array<{ name: string; path: string }> {
  const results: Array<{ name: string; path: string }> = [];
  const skipDirs = new Set(['_build', '.git', 'node_modules', '_opam']);

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !skipDirs.has(entry.name)) {
        walk(path.join(currentDir, entry.name));
      } else if (entry.isFile() && entry.name === 'dune') {
        const dunePath = path.join(currentDir, 'dune');
        try {
          const duneContent = fs.readFileSync(dunePath, 'utf8');
          const libMatch = duneContent.match(/\(library[\s\S]*?\(name\s+([^\s)]+)\)/);
          if (libMatch) {
            const relPath = path.relative(projectRoot, currentDir).replace(/\\/g, '/');
            results.push({ name: libMatch[1]!, path: relPath });
          }
        } catch { /* ignore */ }
      }
    }
  }

  walk(dir);
  return results;
}
