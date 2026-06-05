/**
 * KiroGraph PatternIndexer — indexes pattern matches into the patterns_matches table.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { KiroGraphConfig } from '../config';
import { PatternLibraryLoader } from './loader';
import { PatternRunner } from './runner';
import type { PatternRule } from './types';
import { logWarn } from '../errors';

export class PatternIndexer {
  private readonly rawDb: any;
  private readonly config: KiroGraphConfig;
  private readonly projectRoot: string;

  constructor(rawDb: any, config: KiroGraphConfig, projectRoot: string) {
    this.rawDb = rawDb;
    this.config = config;
    this.projectRoot = projectRoot;
  }

  async indexAll(onProgress?: (phase: string, current: number, total: number) => void): Promise<void> {
    const runner = new PatternRunner();
    if (!runner.isAvailable()) {
      logWarn('[patterns] @ast-grep/napi not installed — skipping pattern indexing. Run: npm install @ast-grep/napi');
      return;
    }

    const loader = new PatternLibraryLoader();
    const builtinPath = path.join(__dirname, '../patterns/library');
    const customPath = (this.config as any).patternLibraryPath;
    const rules = loader.load(builtinPath, customPath);
    const threshold = (this.config as any).patternSeverityThreshold ?? 'low';

    const files: Array<{ path: string; language: string }> = this.rawDb.all(
      'SELECT path, language FROM files WHERE language != ? AND language != ?',
      ['unknown', 'jupyter']
    );

    const now = Date.now();
    let processed = 0;

    for (const file of files) {
      onProgress?.('patterns', processed, files.length);
      await this.indexFile(file.path, file.language, rules, runner, threshold, now);
      processed++;
    }
    onProgress?.('patterns', files.length, files.length);
  }

  async indexFile(
    filePath: string,
    language: string,
    rules: PatternRule[],
    runner: PatternRunner,
    threshold: string,
    now: number,
  ): Promise<void> {
    let content: string;
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.projectRoot, filePath);
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      return; // file deleted between index and now
    }

    // Delete existing matches for this file
    this.rawDb.run('DELETE FROM pattern_matches WHERE file_path = ?', [filePath]);

    const matches = await runner.runAllRules(rules, content, language, threshold as any);

    for (const m of matches) {
      const symbolRow = this.rawDb.get(
        `SELECT id FROM nodes WHERE file_path = ? AND start_line <= ? AND end_line >= ? AND kind IN ('function','method','class') ORDER BY (end_line - start_line) ASC LIMIT 1`,
        [m.filePath || filePath, m.line, m.line]
      ) as { id: string } | undefined;
      const symbolNodeId = symbolRow?.id ?? null;

      this.rawDb.run(
        `INSERT INTO pattern_matches (file_path, pattern_id, line, col, match_text, severity, owasp_category, language, indexed_at, symbol_node_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [filePath, m.patternId, m.line, m.col, m.matchText.slice(0, 500), m.severity, m.owaspCategory, language, now, symbolNodeId]
      );
    }
  }
}
