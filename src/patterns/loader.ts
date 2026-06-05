/**
 * KiroGraph PatternLibraryLoader — loads and merges YAML pattern rule files.
 *
 * js-yaml is not a declared dependency, so this uses a lightweight inline parser
 * that handles the flat key:value + nested rule: block format used by KiroGraph
 * pattern rule files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PatternRule } from './types';
import { logWarn } from '../errors';

// ── Minimal YAML parser ───────────────────────────────────────────────────────
//
// Supports the subset of YAML used by KiroGraph pattern files:
//   - Flat key: value (string, boolean, number)
//   - key: [item1, item2] (inline array)
//   - key:\n  - item (block sequence for simple values)
//   - rule:\n  (nested block as raw sub-object — parsed recursively)
//   - Quoted strings: "..." and '...'
//   - Comments: # ...

function _parseYaml(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  return _parseBlock(lines, 0, 0).result;
}

interface BlockResult {
  result: Record<string, unknown>;
  nextIndex: number;
}

function _parseBlock(lines: string[], startIndex: number, baseIndent: number): BlockResult {
  const result: Record<string, unknown> = {};
  let i = startIndex;

  while (i < lines.length) {
    const rawLine = lines[i];
    // Strip trailing comments (but not inside strings — simplified approach)
    const commentIdx = rawLine.indexOf(' #');
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;

    // Skip blank lines
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const indent = _countIndent(rawLine);

    // If we've de-indented past our base, stop
    if (indent < baseIndent) break;

    // Skip lines that are at an indent level below our block's base
    if (indent > baseIndent && Object.keys(result).length === 0) {
      // Haven't started the block yet — shouldn't happen but skip
      i++;
      continue;
    }

    if (indent > baseIndent) {
      // This belongs to a child block already being processed — stop
      break;
    }

    const trimmed = line.trim();

    // Detect key: ... pattern
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trimStart();

    if (rest === '' || rest === '|' || rest === '>') {
      // Value is on the following lines — could be a nested block or block scalar
      // Peek ahead: if next non-empty line is indented more, recurse
      const nextContentLine = _findNextContent(lines, i + 1);
      if (nextContentLine === -1) {
        result[key] = null;
        i++;
        continue;
      }
      const nextIndent = _countIndent(lines[nextContentLine]);
      if (nextIndent > indent) {
        // Check if next line is a sequence item (- ...)
        if (lines[nextContentLine].trim().startsWith('- ')) {
          const { items, nextIndex } = _parseSequence(lines, nextContentLine, nextIndent);
          result[key] = items;
          i = nextIndex;
        } else {
          const { result: subResult, nextIndex } = _parseBlock(lines, nextContentLine, nextIndent);
          result[key] = subResult;
          i = nextIndex;
        }
      } else {
        result[key] = null;
        i++;
      }
    } else if (rest.startsWith('[')) {
      // Inline array: [a, b, c]
      result[key] = _parseInlineArray(rest);
      i++;
    } else {
      // Scalar value
      result[key] = _parseScalar(rest);
      i++;
    }
  }

  return { result, nextIndex: i };
}

function _parseSequence(lines: string[], startIndex: number, baseIndent: number): { items: unknown[]; nextIndex: number } {
  const items: unknown[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const rawLine = lines[i];
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) {
      i++;
      continue;
    }
    const indent = _countIndent(rawLine);
    if (indent < baseIndent) break;

    const trimmed = rawLine.trim();
    if (!trimmed.startsWith('- ') && trimmed !== '-') {
      break;
    }

    const itemValue = trimmed.startsWith('- ') ? trimmed.slice(2).trim() : '';

    if (itemValue === '' || itemValue === '|' || itemValue === '>') {
      // Multi-line sequence item
      const nextContentLine = _findNextContent(lines, i + 1);
      if (nextContentLine !== -1 && _countIndent(lines[nextContentLine]) > indent) {
        const { result: subResult, nextIndex } = _parseBlock(lines, nextContentLine, _countIndent(lines[nextContentLine]));
        items.push(subResult);
        i = nextIndex;
      } else {
        items.push(null);
        i++;
      }
    } else if (itemValue.includes(':')) {
      // Inline key:value item — parse as sub-object, collecting any indented continuation lines
      // Find continuation lines indented deeper than this item
      const itemIndent = indent + 2;
      const continuationLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextRaw = lines[j];
        if (nextRaw.trim() === '' || nextRaw.trim().startsWith('#')) { j++; continue; }
        if (_countIndent(nextRaw) >= itemIndent) {
          continuationLines.push(nextRaw);
          j++;
        } else {
          break;
        }
      }
      const blockLines = [' '.repeat(itemIndent) + itemValue, ...continuationLines];
      const { result: subResult } = _parseBlock(blockLines, 0, itemIndent);
      items.push(subResult);
      i = j;
    } else {
      items.push(_parseScalar(itemValue));
      i++;
    }
  }

  return { items, nextIndex: i };
}

function _parseInlineArray(text: string): string[] {
  const inner = text.replace(/^\[/, '').replace(/\].*$/, '');
  return inner.split(',').map(s => _parseScalar(s.trim()) as string).filter(s => s !== null && s !== undefined) as string[];
}

function _parseScalar(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);
  // Quoted string
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function _countIndent(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

function _findNextContent(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t !== '' && !t.startsWith('#')) return i;
  }
  return -1;
}

// ── PatternLibraryLoader ──────────────────────────────────────────────────────

export class PatternLibraryLoader {
  /**
   * Load, validate, and merge rules from the builtin path and optional custom path.
   * User-supplied rules override bundled rules on id collision.
   */
  load(builtinPath: string, customPath?: string): PatternRule[] {
    const builtin = this._loadDirectory(builtinPath, 'builtin');
    const builtinMap = new Map<string, PatternRule>();
    for (const rule of builtin) builtinMap.set(rule.id, rule);

    if (!customPath) return builtin;

    const custom = this._loadDirectory(customPath, 'custom');
    const merged = new Map<string, PatternRule>(builtinMap);
    for (const rule of custom) {
      if (merged.has(rule.id)) {
        logWarn(`PatternLibraryLoader: custom rule "${rule.id}" overrides bundled rule`);
      }
      merged.set(rule.id, rule);
    }

    return [...merged.values()];
  }

  private _loadDirectory(dirPath: string, source: string): PatternRule[] {
    if (!fs.existsSync(dirPath)) {
      logWarn(`PatternLibraryLoader: ${source} library path does not exist: ${dirPath}`);
      return [];
    }

    const rules: PatternRule[] = [];
    const seenIds = new Map<string, string>();

    let files: string[];
    try {
      files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch (err) {
      logWarn(`PatternLibraryLoader: failed to read ${source} directory "${dirPath}": ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const text = fs.readFileSync(filePath, 'utf8');
        const parsed = _parseYaml(text);
        const rule = this._validate(parsed, filePath);
        if (!rule) continue;

        if (seenIds.has(rule.id)) {
          logWarn(`PatternLibraryLoader: duplicate rule id "${rule.id}" in ${source} library — found in "${seenIds.get(rule.id)}" and "${filePath}", using last loaded`);
        }
        seenIds.set(rule.id, filePath);
        rules.push(rule);
      } catch (err) {
        logWarn(`PatternLibraryLoader: failed to load rule file "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return rules;
  }

  private _validate(parsed: Record<string, unknown>, filePath: string): PatternRule | null {
    const required = ['id', 'language', 'severity', 'owaspCategory', 'description', 'fixHint', 'rule'];
    for (const field of required) {
      if (parsed[field] === undefined || parsed[field] === null) {
        logWarn(`PatternLibraryLoader: rule file "${filePath}" is missing required field "${field}", skipping`);
        return null;
      }
    }

    const id = String(parsed['id']);
    const language = parsed['language'];
    const severity = String(parsed['severity']) as PatternRule['severity'];
    const owaspCategory = String(parsed['owaspCategory']);
    const description = String(parsed['description']);
    const fixHint = String(parsed['fixHint']);
    const rule = parsed['rule'];

    const validSeverities = new Set(['critical', 'high', 'medium', 'low']);
    if (!validSeverities.has(severity)) {
      logWarn(`PatternLibraryLoader: rule file "${filePath}" has invalid severity "${severity}", skipping`);
      return null;
    }

    if (typeof language !== 'string' && !Array.isArray(language)) {
      logWarn(`PatternLibraryLoader: rule file "${filePath}" has invalid language field, skipping`);
      return null;
    }

    if (typeof rule !== 'object' || Array.isArray(rule) || rule === null) {
      logWarn(`PatternLibraryLoader: rule file "${filePath}" has invalid rule field (must be an object), skipping`);
      return null;
    }

    return {
      id,
      language: Array.isArray(language) ? (language as string[]) : String(language),
      severity,
      owaspCategory,
      description,
      fixHint,
      rule: rule as Record<string, unknown>,
    };
  }
}
