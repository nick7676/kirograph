/**
 * KiroGraph Watchmen — threshold checker and target file resolver
 *
 * No state file. The watermark is the last kind='summary' observation.
 * Counting observations since that timestamp tells us when to synthesize.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MemoryDatabase } from '../memory/database';
import type { WatchmenReadyResult } from '../memory/types';

// ── Target file detection ─────────────────────────────────────────────────────

const TARGET_ENTRIES: Array<{ detect: (root: string) => boolean; target: string }> = [
  { detect: root => fs.existsSync(path.join(root, '.kiro')),                  target: '.kiro/steering/kirograph-watchmen.md' },
  { detect: root => fs.existsSync(path.join(root, 'CLAUDE.md')),              target: 'CLAUDE.md' },
  { detect: root => fs.existsSync(path.join(root, 'GEMINI.md')),              target: 'GEMINI.md' },
  { detect: root => fs.existsSync(path.join(root, 'CONVENTIONS.md')),         target: 'CONVENTIONS.md' },
  { detect: root => fs.existsSync(path.join(root, 'augment-guidelines.md')), target: 'augment-guidelines.md' },
  { detect: root => fs.existsSync(path.join(root, 'AGENTS.md')),              target: 'AGENTS.md' },
];

// ── WatchmenChecker ───────────────────────────────────────────────────────────

export class WatchmenChecker {
  constructor(private readonly threshold: number) {}

  shouldSynthesize(memDb: MemoryDatabase): { ready: boolean; pendingCount: number } {
    const pendingCount = memDb.countSinceLastSummary();
    return { ready: pendingCount >= this.threshold, pendingCount };
  }

  buildReadyResponse(id: string, pendingCount: number, projectRoot: string): WatchmenReadyResult {
    const targetFiles = this.resolveTargetFiles(projectRoot);
    const hasKiro = fs.existsSync(path.join(projectRoot, '.kiro'));
    const skillTargetDir = hasKiro ? '.kiro/steering' : undefined;

    const skillInstructions = skillTargetDir
      ? `For each recurring procedure (appearing in 3+ observations): write a separate ` +
        `\`.kiro/steering/watchmen-<slug>.md\` file with \`inclusion: manual\` frontmatter, ` +
        `a short title, trigger phrases (when to load this skill), and numbered steps. ` +
        `Use \`watchmen-\` prefix so auto-generated skills are distinguishable. ` +
        `Delete any \`.kiro/steering/watchmen-*.md\` files from previous runs that no ` +
        `longer reflect current patterns.`
      : `Embed a ## Recurring Procedures section in each file in targetFiles listing ` +
        `each identified recurring procedure with trigger context and numbered steps.`;

    return {
      id,
      watchmenReady: true,
      pendingCount,
      message:
        `${pendingCount} new observations since last synthesis. ` +
        `Synthesize now: (1) call kirograph_mem_search for each kind ` +
        `(decision, error, pattern, architecture, note) with limit 20, ` +
        `(2) write or update the workspace brief (## KiroGraph Watchmen section) ` +
        `in each file in targetFiles covering decisions, errors, patterns, and ` +
        `architecture notes, (3) identify recurring procedures: ${skillInstructions} ` +
        `(4) store a kind='summary' observation to mark completion.`,
      targetFiles,
      ...(skillTargetDir !== undefined ? { skillTargetDir } : {}),
    };
  }

  private resolveTargetFiles(projectRoot: string): string[] {
    const files: string[] = [];
    for (const entry of TARGET_ENTRIES) {
      if (entry.detect(projectRoot)) {
        files.push(entry.target);
      }
    }
    // Last-resort fallback for tools with no recognized project memory file
    if (files.length === 0) {
      files.push('AGENTS.md');
    }
    return files;
  }
}
