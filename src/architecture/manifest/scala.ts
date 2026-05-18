/**
 * Scala build.sbt manifest parser.
 * Handles single-project and multi-module SBT builds.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ManifestParser, ArchPackage } from '../types';

export const sbtParser: ManifestParser = {
  name: 'sbt',
  manifestFiles: ['build.sbt'],
  language: 'scala',

  canParse(manifestPath: string): boolean {
    return path.basename(manifestPath) === 'build.sbt';
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
    const packages: ArchPackage[] = [];

    // Extract project name
    const nameMatch = content.match(/name\s*:=\s*"([^"]+)"/);
    const versionMatch = content.match(/version\s*:=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : path.basename(path.dirname(manifestPath));
    const version = versionMatch ? versionMatch[1] : undefined;

    // Extract library dependencies
    const externalDeps: string[] = [];
    const depPattern = /"([^"]+)"\s*%%?\s*"([^"]+)"\s*%\s*"([^"]+)"/g;
    let depMatch: RegExpExecArray | null;
    while ((depMatch = depPattern.exec(content)) !== null) {
      externalDeps.push(`${depMatch[1]}:${depMatch[2]}`);
    }

    // Detect sub-projects (lazy val xxx = project.in(file("yyy")))
    const subProjectPattern = /lazy\s+val\s+(\w+)\s*=\s*(?:\(?\s*project\s*(?:\.in\s*\(\s*file\s*\(\s*"([^"]+)"\s*\))?|project\s+in\s+file\s*\(\s*"([^"]+)"\s*\))/g;
    let subMatch: RegExpExecArray | null;
    const subProjects: Array<{ name: string; dir: string }> = [];

    while ((subMatch = subProjectPattern.exec(content)) !== null) {
      const subName = subMatch[1];
      const subDir = subMatch[2] || subMatch[3] || subName;
      subProjects.push({ name: subName!, dir: subDir! });
    }

    if (subProjects.length > 0) {
      // Multi-module project: create a package per sub-project
      for (const sub of subProjects) {
        const subPath = relDir === '.' ? sub.dir : `${relDir}/${sub.dir}`;
        packages.push({
          id: `pkg:sbt:${subPath}`,
          name: sub.name,
          path: subPath,
          source: 'manifest',
          language: 'scala',
          manifestPath: relManifest,
          version,
          updatedAt: Date.now(),
        });
      }
      // Also add the root project
      packages.push({
        id: `pkg:sbt:${relDir}`,
        name: name!,
        path: relDir,
        source: 'manifest',
        language: 'scala',
        manifestPath: relManifest,
        version,
        externalDeps,
        metadata: { subProjects: subProjects.map(s => s.name) },
        updatedAt: Date.now(),
      });
    } else {
      // Single project
      packages.push({
        id: `pkg:sbt:${relDir}`,
        name: name!,
        path: relDir,
        source: 'manifest',
        language: 'scala',
        manifestPath: relManifest,
        version,
        externalDeps,
        updatedAt: Date.now(),
      });
    }

    return packages;
  },
};
