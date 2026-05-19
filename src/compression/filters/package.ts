/**
 * Package manager output filters (npm, pip, bundle, pnpm, yarn)
 */

import type { CommandFilter, FilterResult, CompressorOptions } from '../types';

export const packageFilter: CommandFilter = {
  name: 'package',

  matches(command: string): boolean {
    return /\b(npm\s+(list|ls|outdated|install|i\b)|pnpm\s+(list|ls|outdated|install)|yarn\s+(list|outdated|add|install)|pip\s+(list|freeze|outdated|install)|bundle\s+(install|list|outdated)|cargo\s+(update|add)|go\s+(mod|get))\b/.test(command);
  },

  filter(command: string, rawOutput: string, level: CompressorOptions['level']): FilterResult {
    if (/npm\s+(install|i)\b|pnpm\s+install|yarn\s+(install|add)/.test(command)) return filterNpmInstall(rawOutput, level);
    if (/npm\s+(list|ls)|pnpm\s+(list|ls)/.test(command)) return filterNpmList(rawOutput, level);
    if (/npm\s+outdated|pnpm\s+outdated|yarn\s+outdated/.test(command)) return filterOutdated(rawOutput, level);
    if (/pip\s+(list|freeze)/.test(command)) return filterPipList(rawOutput, level);
    if (/pip\s+outdated/.test(command)) return filterOutdated(rawOutput, level);
    if (/pip\s+install/.test(command)) return filterPipInstall(rawOutput, level);
    if (/bundle\s+install/.test(command)) return filterBundleInstall(rawOutput, level);
    if (/bundle\s+list/.test(command)) return filterBundleList(rawOutput, level);

    return { output: rawOutput, strategy: 'package:passthrough' };
  },
};

function filterNpmInstall(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  // Extract summary
  const addedMatch = raw.match(/added\s+(\d+)\s+packages?/);
  const removedMatch = raw.match(/removed\s+(\d+)\s+packages?/);
  const changedMatch = raw.match(/changed\s+(\d+)\s+packages?/);
  const auditMatch = raw.match(/(\d+)\s+vulnerabilit/);

  const parts: string[] = [];
  if (addedMatch) parts.push(`+${addedMatch[1]}`);
  if (removedMatch) parts.push(`-${removedMatch[1]}`);
  if (changedMatch) parts.push(`~${changedMatch[1]}`);

  if (parts.length > 0) {
    const audit = auditMatch ? ` (${auditMatch[1]} vulnerabilities)` : '';
    return { output: `ok ${parts.join(' ')} packages${audit}`, strategy: 'npm-install:summary' };
  }

  // Already up to date
  if (raw.includes('up to date')) {
    return { output: 'ok (up to date)', strategy: 'npm-install:uptodate' };
  }

  // Fallback: last meaningful line
  const meaningful = lines.filter(l => !l.startsWith('npm') || l.includes('added') || l.includes('removed'));
  return { output: meaningful.pop() || 'ok', strategy: 'npm-install:fallback' };
}

function filterNpmList(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  if (lines.length <= 10) return { output: raw, strategy: 'npm-list:short' };

  // Count top-level deps
  const topLevel = lines.filter(l => l.startsWith('├') || l.startsWith('└'));

  if (level === 'ultra') {
    return { output: `${topLevel.length} top-level packages`, strategy: 'npm-list:ultra' };
  }

  if (level === 'aggressive') {
    const shown = topLevel.slice(0, 20).join('\n');
    const extra = topLevel.length > 20 ? `\n…+${topLevel.length - 20} more` : '';
    return { output: `${topLevel.length} packages:\n${shown}${extra}`, strategy: 'npm-list:toplevel' };
  }

  // Normal: truncate tree
  const maxLines = 40;
  if (lines.length <= maxLines) return { output: raw, strategy: 'npm-list:full' };

  const shown = lines.slice(0, maxLines).join('\n');
  return { output: `${shown}\n…+${lines.length - maxLines} more lines`, strategy: 'npm-list:truncated' };
}

function filterOutdated(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  if (lines.length <= 1) return { output: 'all up to date', strategy: 'outdated:clean' };

  const rows = lines.slice(1); // Skip header

  if (level === 'ultra') {
    return { output: `${rows.length} outdated packages`, strategy: 'outdated:ultra' };
  }

  const maxRows = level === 'aggressive' ? 10 : 20;
  if (rows.length <= maxRows) return { output: raw, strategy: 'outdated:short' };

  const shown = [lines[0], ...rows.slice(0, maxRows)].join('\n');
  return { output: `${shown}\n…+${rows.length - maxRows} more`, strategy: 'outdated:truncated' };
}

function filterPipList(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  if (lines.length <= 5) return { output: raw, strategy: 'pip-list:short' };

  // Skip header lines (Package, Version, ---)
  const packages = lines.filter(l => !l.startsWith('Package') && !l.startsWith('---') && !l.startsWith('WARNING'));

  if (level === 'ultra') {
    return { output: `${packages.length} packages installed`, strategy: 'pip-list:ultra' };
  }

  const maxPkgs = level === 'aggressive' ? 20 : 40;
  if (packages.length <= maxPkgs) return { output: packages.join('\n'), strategy: 'pip-list:full' };

  const shown = packages.slice(0, maxPkgs).join('\n');
  return { output: `${shown}\n…+${packages.length - maxPkgs} more packages`, strategy: 'pip-list:truncated' };
}

function filterPipInstall(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  // Success
  if (raw.includes('Successfully installed')) {
    const installed = raw.match(/Successfully installed (.+)/);
    if (installed) {
      const pkgs = installed[1].split(/\s+/);
      if (level === 'ultra') return { output: `ok +${pkgs.length} packages`, strategy: 'pip-install:ultra' };
      return { output: `ok installed ${pkgs.length} packages: ${pkgs.slice(0, 5).join(', ')}${pkgs.length > 5 ? '…' : ''}`, strategy: 'pip-install:summary' };
    }
  }

  if (raw.includes('already satisfied')) {
    return { output: 'ok (already satisfied)', strategy: 'pip-install:satisfied' };
  }

  // Strip download progress lines
  const meaningful = lines.filter(l => !l.includes('Downloading') && !l.includes('━') && !l.includes('Using cached'));
  return { output: meaningful.join('\n') || 'ok', strategy: 'pip-install:filtered' };
}

function filterBundleInstall(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());

  // Strip "Using ..." lines
  const meaningful = lines.filter(l => !l.startsWith('Using ') && !l.startsWith('Fetching'));
  const installed = lines.filter(l => l.startsWith('Installing'));

  if (level === 'ultra') {
    return { output: `ok ${installed.length} installed`, strategy: 'bundle-install:ultra' };
  }

  if (meaningful.length <= 10) return { output: meaningful.join('\n'), strategy: 'bundle-install:short' };

  // Show summary
  const summary = meaningful.filter(l => l.startsWith('Bundle') || l.startsWith('Installing'));
  return { output: summary.join('\n') || meaningful.slice(-5).join('\n'), strategy: 'bundle-install:summary' };
}

function filterBundleList(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n').filter(l => l.trim());
  const gems = lines.filter(l => l.startsWith('  *'));

  if (level === 'ultra') {
    return { output: `${gems.length} gems`, strategy: 'bundle-list:ultra' };
  }

  const maxGems = level === 'aggressive' ? 20 : 40;
  if (gems.length <= maxGems) return { output: raw, strategy: 'bundle-list:full' };

  const shown = gems.slice(0, maxGems).join('\n');
  return { output: `${gems.length} gems:\n${shown}\n…+${gems.length - maxGems} more`, strategy: 'bundle-list:truncated' };
}
