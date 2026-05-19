/**
 * Generic output filter — fallback for unrecognized commands.
 * Applies deduplication, truncation, and noise removal.
 */

import type { CommandFilter, FilterResult, CompressorOptions } from '../types';

export const genericFilter: CommandFilter = {
  name: 'generic',

  matches(_command: string): boolean {
    // Always matches as fallback
    return true;
  },

  filter(_command: string, rawOutput: string, level: CompressorOptions['level']): FilterResult {
    const lines = rawOutput.split('\n');

    // Short output — don't compress
    if (lines.length <= 15) {
      return { output: rawOutput, strategy: 'generic:short' };
    }

    // Step 1: Remove blank lines and common noise
    let filtered = lines.filter(l => {
      const trimmed = l.trim();
      if (!trimmed) return false;
      // Remove common progress indicators
      if (/^[▓░█▒■□●○◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(trimmed)) return false;
      if (/^\d+%\s*[|█▓░]/.test(trimmed)) return false;
      // Remove spinner lines
      if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]/.test(trimmed)) return false;
      return true;
    });

    // Step 2: Deduplicate consecutive similar lines
    const deduped: string[] = [];
    let lastPattern = '';
    let repeatCount = 0;

    for (const line of filtered) {
      const pattern = normalizeForComparison(line);
      if (pattern === lastPattern) {
        repeatCount++;
      } else {
        if (repeatCount > 2) {
          deduped.push(`  …repeated ${repeatCount} times`);
        } else if (repeatCount === 2) {
          deduped.push(filtered[deduped.length] || '');
        }
        deduped.push(line);
        lastPattern = pattern;
        repeatCount = 1;
      }
    }
    if (repeatCount > 2) {
      deduped.push(`  …repeated ${repeatCount} times`);
    }

    filtered = deduped;

    // Step 3: Truncate based on level
    const maxLines = level === 'ultra' ? 30 : level === 'aggressive' ? 60 : 100;

    if (filtered.length <= maxLines) {
      return { output: filtered.join('\n'), strategy: 'generic:deduped' };
    }

    // Keep head and tail
    const headSize = Math.floor(maxLines * 0.6);
    const tailSize = maxLines - headSize;
    const head = filtered.slice(0, headSize);
    const tail = filtered.slice(-tailSize);
    const omitted = filtered.length - headSize - tailSize;

    const output = [...head, `\n…(${omitted} lines omitted)\n`, ...tail].join('\n');
    return { output, strategy: 'generic:truncated' };
  },
};

/**
 * Normalize a line for deduplication comparison.
 * Strips timestamps, numbers, and UUIDs to detect repeated patterns.
 */
function normalizeForComparison(line: string): string {
  return line
    // Strip ISO timestamps
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?/g, '<ts>')
    // Strip Unix timestamps
    .replace(/\b\d{10,13}\b/g, '<ts>')
    // Strip UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    // Strip hex hashes
    .replace(/\b[0-9a-f]{7,40}\b/g, '<hash>')
    // Strip standalone numbers (but keep those in identifiers)
    .replace(/(?<![a-zA-Z_])\d+(?![a-zA-Z_])/g, '<n>');
}
