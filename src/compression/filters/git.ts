/**
 * Git command output filters
 */

import type { CommandFilter, FilterResult, CompressorOptions } from '../types';

export const gitFilter: CommandFilter = {
  name: 'git',

  matches(command: string): boolean {
    return /^\s*(git\s|rtk\s+git\s)/.test(command);
  },

  filter(command: string, rawOutput: string, level: CompressorOptions['level']): FilterResult {
    const subcommand = extractGitSubcommand(command);

    switch (subcommand) {
      case 'status': return filterGitStatus(rawOutput, level);
      case 'log': return filterGitLog(rawOutput, level);
      case 'diff': return filterGitDiff(rawOutput, level);
      case 'push': return filterGitPush(rawOutput);
      case 'pull': return filterGitPull(rawOutput);
      case 'add': return filterGitAdd(rawOutput);
      case 'commit': return filterGitCommit(rawOutput);
      case 'fetch': return filterGitFetch(rawOutput);
      case 'branch': return filterGitBranch(rawOutput, level);
      case 'stash': return filterGitStash(rawOutput);
      default: return { output: rawOutput, strategy: 'git:passthrough' };
    }
  },
};

function extractGitSubcommand(command: string): string {
  const match = command.match(/git\s+(\w+)/);
  return match ? match[1] : '';
}

function filterGitStatus(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  // Detect clean state
  if (raw.includes('nothing to commit') || raw.includes('working tree clean')) {
    return { output: 'clean', strategy: 'git:status:clean' };
  }

  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const deleted: string[] = [];
  const renamed: string[] = [];

  let section = '';
  for (const line of lines) {
    if (line.includes('Changes to be committed')) { section = 'staged'; continue; }
    if (line.includes('Changes not staged')) { section = 'unstaged'; continue; }
    if (line.includes('Untracked files')) { section = 'untracked'; continue; }
    if (line.startsWith('  (use')) continue; // hint lines
    if (line.startsWith('On branch') || line.startsWith('Your branch')) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Short format (git status -s) or porcelain
    const shortMatch = trimmed.match(/^([MADRCU?! ]{1,2})\s+(.+)$/);
    if (shortMatch) {
      const [, status, file] = shortMatch;
      if (status.includes('M')) modified.push(file);
      else if (status.includes('A')) staged.push(file);
      else if (status.includes('D')) deleted.push(file);
      else if (status.includes('R')) renamed.push(file);
      else if (status.includes('?')) untracked.push(file);
      continue;
    }

    // Long format
    if (section === 'staged') {
      const m = trimmed.match(/(?:new file|modified|deleted|renamed):\s+(.+)/);
      if (m) staged.push(m[1]);
    } else if (section === 'unstaged') {
      const m = trimmed.match(/(?:modified|deleted):\s+(.+)/);
      if (m) modified.push(m[1]);
    } else if (section === 'untracked') {
      if (!trimmed.startsWith('(')) untracked.push(trimmed);
    }
  }

  if (level === 'ultra') {
    const parts: string[] = [];
    if (staged.length) parts.push(`S:${staged.length}`);
    if (modified.length) parts.push(`M:${modified.length}`);
    if (deleted.length) parts.push(`D:${deleted.length}`);
    if (untracked.length) parts.push(`?:${untracked.length}`);
    if (renamed.length) parts.push(`R:${renamed.length}`);
    return { output: parts.join(' ') || 'clean', strategy: 'git:status:ultra' };
  }

  const parts: string[] = [];
  if (staged.length) parts.push(`Staged (${staged.length}): ${groupByDir(staged, level)}`);
  if (modified.length) parts.push(`Modified (${modified.length}): ${groupByDir(modified, level)}`);
  if (deleted.length) parts.push(`Deleted (${deleted.length}): ${groupByDir(deleted, level)}`);
  if (untracked.length) parts.push(`Untracked (${untracked.length}): ${groupByDir(untracked, level)}`);
  if (renamed.length) parts.push(`Renamed (${renamed.length}): ${groupByDir(renamed, level)}`);

  return { output: parts.join('\n') || raw, strategy: 'git:status' };
}

function filterGitLog(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');

  // Already one-line format
  if (lines.every(l => !l.startsWith('commit ') && !l.startsWith('Author:'))) {
    const filtered = lines.filter(l => l.trim()).slice(0, level === 'ultra' ? 10 : 20);
    return { output: filtered.join('\n'), strategy: 'git:log:oneline' };
  }

  // Parse full format into one-line
  const commits: string[] = [];
  let currentHash = '';
  let currentMsg = '';

  for (const line of lines) {
    if (line.startsWith('commit ')) {
      if (currentHash && currentMsg) {
        commits.push(`${currentHash.slice(0, 7)} ${currentMsg.trim()}`);
      }
      currentHash = line.replace('commit ', '').trim();
      currentMsg = '';
    } else if (!line.startsWith('Author:') && !line.startsWith('Date:') && !line.startsWith('Merge:')) {
      if (line.trim()) currentMsg = currentMsg || line.trim();
    }
  }
  if (currentHash && currentMsg) {
    commits.push(`${currentHash.slice(0, 7)} ${currentMsg.trim()}`);
  }

  const limit = level === 'ultra' ? 10 : 20;
  const output = commits.slice(0, limit).join('\n');
  return { output: output || raw, strategy: 'git:log' };
}

function filterGitDiff(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');
  const result: string[] = [];
  let contextLines = level === 'ultra' ? 1 : level === 'aggressive' ? 2 : 3;
  let inHunk = false;
  let afterChange = 0;
  let contextBuffer: string[] = [];

  for (const line of lines) {
    // Keep file headers
    if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++')) {
      result.push(line);
      inHunk = false;
      contextBuffer = [];
      continue;
    }

    // Keep hunk headers
    if (line.startsWith('@@')) {
      result.push(line);
      inHunk = true;
      afterChange = 0;
      contextBuffer = [];
      continue;
    }

    if (!inHunk) continue;

    // Changed lines — always keep
    if (line.startsWith('+') || line.startsWith('-')) {
      // Flush context buffer (last N lines before change)
      if (contextBuffer.length > 0) {
        const keep = contextBuffer.slice(-contextLines);
        result.push(...keep);
        contextBuffer = [];
      }
      result.push(line);
      afterChange = 0;
      continue;
    }

    // Context lines after a change
    afterChange++;
    if (afterChange <= contextLines) {
      result.push(line);
    } else {
      contextBuffer.push(line);
    }
  }

  return { output: result.join('\n'), strategy: 'git:diff' };
}

function filterGitPush(raw: string): FilterResult {
  // Extract branch and remote info
  const branchMatch = raw.match(/(\S+)\s*->\s*(\S+)/);
  if (branchMatch) {
    return { output: `ok ${branchMatch[1]} → ${branchMatch[2]}`, strategy: 'git:push' };
  }
  if (raw.includes('Everything up-to-date')) {
    return { output: 'ok (up-to-date)', strategy: 'git:push' };
  }
  // Fallback: just show last meaningful line
  const meaningful = raw.split('\n').filter(l => l.trim() && !l.includes('Enumerating') && !l.includes('Counting') && !l.includes('Compressing') && !l.includes('Writing'));
  return { output: meaningful.pop() || 'ok', strategy: 'git:push' };
}

function filterGitPull(raw: string): FilterResult {
  if (raw.includes('Already up to date')) {
    return { output: 'ok (up-to-date)', strategy: 'git:pull' };
  }

  const filesMatch = raw.match(/(\d+)\s+file/);
  const insertMatch = raw.match(/(\d+)\s+insertion/);
  const deleteMatch = raw.match(/(\d+)\s+deletion/);

  const files = filesMatch ? filesMatch[1] : '0';
  const ins = insertMatch ? `+${insertMatch[1]}` : '+0';
  const del = deleteMatch ? `-${deleteMatch[1]}` : '-0';

  return { output: `ok ${files} files ${ins} ${del}`, strategy: 'git:pull' };
}

function filterGitAdd(raw: string): FilterResult {
  // git add produces no output on success
  if (!raw.trim()) return { output: 'ok', strategy: 'git:add' };
  return { output: raw.trim() || 'ok', strategy: 'git:add' };
}

function filterGitCommit(raw: string): FilterResult {
  const hashMatch = raw.match(/\[[\w/]+\s+([a-f0-9]+)\]/);
  if (hashMatch) {
    return { output: `ok ${hashMatch[1]}`, strategy: 'git:commit' };
  }
  // Fallback
  const firstLine = raw.split('\n').find(l => l.trim());
  return { output: firstLine || 'ok', strategy: 'git:commit' };
}

function filterGitFetch(raw: string): FilterResult {
  if (!raw.trim()) return { output: 'ok', strategy: 'git:fetch' };
  const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('remote:'));
  return { output: lines.length > 0 ? lines.join('\n') : 'ok', strategy: 'git:fetch' };
}

function filterGitBranch(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());
  const current = lines.find(l => l.startsWith('*'));
  const others = lines.filter(l => !l.startsWith('*')).map(l => l.trim());

  if (level === 'ultra') {
    return {
      output: `* ${current?.replace('*', '').trim() || '?'} (+${others.length} branches)`,
      strategy: 'git:branch:ultra',
    };
  }

  const limit = level === 'aggressive' ? 10 : 20;
  const shown = others.slice(0, limit);
  const parts = [current || '* (unknown)'];
  parts.push(...shown);
  if (others.length > limit) parts.push(`  …and ${others.length - limit} more`);

  return { output: parts.join('\n'), strategy: 'git:branch' };
}

function filterGitStash(raw: string): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { output: 'ok', strategy: 'git:stash' };
  return { output: lines.slice(0, 10).join('\n'), strategy: 'git:stash' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByDir(files: string[], level: CompressorOptions['level']): string {
  if (level === 'aggressive' || level === 'ultra') {
    const dirs = new Map<string, number>();
    for (const f of files) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
      dirs.set(dir, (dirs.get(dir) || 0) + 1);
    }
    return [...dirs.entries()].map(([d, c]) => `${d}/ (${c})`).join(', ');
  }
  // Normal: show up to 5 files, then count
  if (files.length <= 5) return files.join(', ');
  return files.slice(0, 5).join(', ') + ` …+${files.length - 5} more`;
}
