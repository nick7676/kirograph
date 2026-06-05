import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, section } from '../ui';

// ── OWASP Categories ──────────────────────────────────────────────────────────

const OWASP_CATEGORIES: Record<string, string> = {
  A01: 'Broken Access Control',
  A02: 'Cryptographic Failures',
  A03: 'Injection',
  A04: 'Insecure Design',
  A05: 'Security Misconfiguration',
  A06: 'Vulnerable Components',
  A07: 'Auth Failures',
  A08: 'Integrity Failures',
  A09: 'Logging Failures',
  A10: 'SSRF',
};

const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;
type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  critical: 3, high: 2, medium: 1, low: 0,
};

function severityColor(severity: string): string {
  if (severity === 'critical') return '\x1b[31m';
  if (severity === 'high')     return '\x1b[31m';
  if (severity === 'medium')   return '\x1b[33m';
  return dim;
}

function resolveLibraryPath(): string {
  // In development: src/patterns/library; in dist: dist/patterns/library
  const devPath = path.join(__dirname, '../../patterns/library');
  if (fs.existsSync(devPath)) return devPath;
  const distPath = path.join(__dirname, '../patterns/library');
  if (fs.existsSync(distPath)) return distPath;
  return devPath;
}

export function register(program: Command): void {
  program
    .command('pattern [pattern] [projectPath]')
    .description('AST structural search: live pattern search or library rule runner')
    .option('--lang <language>', 'Filter to a specific language (js, ts, python, go, rust, java, ...)')
    .option('--severity <level>', 'Filter: critical, high, medium, low')
    .option('--format <fmt>', 'Output format: text|json (default: text)', 'text')
    .option('--list', 'Show all library rules (no @ast-grep/napi required)')
    .option('--library <id>', 'Run a specific library rule by ID')
    .option('--fix', 'Apply the rule\'s fix template to matched files (requires --library <id>)')
    .option('--coverage', 'Show OWASP Top 10 coverage report')
    .option('--save-baseline [label]', 'Save current pattern_matches as a baseline for diffing')
    .option('--diff [label]', 'Diff current pattern_matches against a saved baseline')
    .action(async (
      patternArg: string | undefined,
      projectPathArg: string | undefined,
      opts: {
        lang?: string;
        severity?: string;
        format: string;
        list?: boolean;
        library?: string;
        fix?: boolean;
        coverage?: boolean;
        saveBaseline?: string | boolean;
        diff?: string | boolean;
      },
    ) => {
      const target = path.resolve(projectPathArg ?? process.cwd());

      // ── --list mode ──────────────────────────────────────────────────────────
      if (opts.list) {
        const { PatternLibraryLoader } = await import('../../patterns/loader');
        const loader = new PatternLibraryLoader();
        const config = await loadConfig(target).catch(() => null);
        const libraryPath = resolveLibraryPath();
        const customPath = config?.patternLibraryPath;
        const rules = loader.load(libraryPath, customPath);

        if (opts.format === 'json') {
          process.stdout.write(JSON.stringify(rules, null, 2) + '\n');
          return;
        }

        if (rules.length === 0) {
          console.log(`\n  ${dim}No pattern rules found.${reset}\n`);
          return;
        }

        console.log(`\n  ${section('Pattern Library')} (${rules.length} rules)\n`);

        // Determine column widths
        const maxSev  = Math.max(...rules.map(r => r.severity.length), 8);
        const maxOWASP = Math.max(...rules.map(r => r.owaspCategory.length), 5);
        const maxId   = Math.max(...rules.map(r => r.id.length), 10);

        for (const rule of rules) {
          const sc = severityColor(rule.severity);
          const sev = rule.severity.padEnd(maxSev);
          const owasp = rule.owaspCategory.padEnd(maxOWASP);
          const id = rule.id.padEnd(maxId);
          console.log(`  ${sc}${sev}${reset}  ${dim}${owasp}${reset}  ${violet}${bold}${id}${reset}  ${dim}${rule.description}${reset}`);
        }

        console.log();
        return;
      }

      // ── --coverage mode ───────────────────────────────────────────────────────
      if (opts.coverage) {
        const { PatternLibraryLoader } = await import('../../patterns/loader');
        const loader = new PatternLibraryLoader();
        const cfgCov = await loadConfig(target).catch(() => null);
        const libraryPath = resolveLibraryPath();
        const customPath = cfgCov?.patternLibraryPath;
        const rules = loader.load(libraryPath, customPath);

        // Count rules per OWASP category (normalise e.g. "A03 - Injection" → "A03")
        const ruleCounts: Record<string, number> = {};
        for (const cat of Object.keys(OWASP_CATEGORIES)) ruleCounts[cat] = 0;
        for (const rule of rules) {
          const cat = rule.owaspCategory.trim().split(/[\s-]/)[0].toUpperCase();
          if (cat in ruleCounts) ruleCounts[cat]++;
        }

        // Try to get match/file data from DB if initialized and enablePatterns
        type OwaspRow = { owasp_category: string; matches: number; files: number };
        let dbData: Record<string, { matches: number; files: number }> | null = null;
        const KiroGraphCov = (await import('../../index')).default;
        if (cfgCov?.enablePatterns && KiroGraphCov.isInitialized(target)) {
          try {
            const cg = await KiroGraphCov.open(target);
            const rawDb = cg.getDatabase().getRawDb();
            const tableExists = rawDb.get(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_matches'",
            ) as { name: string } | undefined;
            if (tableExists) {
              const rows = rawDb.all(
                `SELECT owasp_category, COUNT(*) as matches, COUNT(DISTINCT file_path) as files
                 FROM pattern_matches
                 GROUP BY owasp_category`,
              ) as OwaspRow[];
              dbData = {};
              for (const row of rows) {
                const cat = row.owasp_category.trim().split(/[\s-]/)[0].toUpperCase();
                if (cat) dbData[cat] = { matches: row.matches, files: row.files };
              }
            }
            cg.close();
          } catch {
            // non-fatal — show rule counts only
          }
        }

        if (opts.format === 'json') {
          const categories: Record<string, { rules: number; matches: number | null; files: number | null }> = {};
          for (const cat of Object.keys(OWASP_CATEGORIES)) {
            categories[cat] = {
              rules: ruleCounts[cat] ?? 0,
              matches: dbData ? (dbData[cat]?.matches ?? 0) : null,
              files: dbData ? (dbData[cat]?.files ?? 0) : null,
            };
          }
          const covered = Object.values(categories).filter(c => c.rules > 0).length;
          process.stdout.write(JSON.stringify({ categories, covered, total: 10 }, null, 2) + '\n');
          return;
        }

        const BAR_WIDTH = 10;
        const sorted = Object.keys(OWASP_CATEGORIES).sort((a, b) => (ruleCounts[b] ?? 0) - (ruleCounts[a] ?? 0));
        const maxNameLen = Math.max(...Object.values(OWASP_CATEGORIES).map(n => n.length));

        const isInitialized = KiroGraphCov.isInitialized(target);
        const hasEnablePatterns = !!cfgCov?.enablePatterns;
        let coverageSubtitle: string;
        if (!isInitialized || !hasEnablePatterns) {
          coverageSubtitle = `  ${dim}(rules only — no match data)${reset}`;
        } else if (!dbData) {
          coverageSubtitle = `  ${dim}(no match data yet — run kirograph index)${reset}`;
        } else {
          coverageSubtitle = '';
        }

        console.log(`\n  ${section('OWASP Top 10 Coverage')}${coverageSubtitle}`);
        if (!isInitialized || !hasEnablePatterns) {
          console.log(`  ${dim}Run kirograph index with enablePatterns: true to see actual findings.${reset}`);
        }
        console.log();

        for (const cat of sorted) {
          const name = OWASP_CATEGORIES[cat];
          const count = ruleCounts[cat] ?? 0;
          const filledBars = Math.min(count, BAR_WIDTH);
          const bar = count > 0
            ? `${violet}${'█'.repeat(filledBars)}${dim}${'░'.repeat(BAR_WIDTH - filledBars)}${reset}`
            : `${dim}${'░'.repeat(BAR_WIDTH)}${reset}`;
          const catLabel = count > 0
            ? `${violet}${bold}${cat}${reset}`
            : `\x1b[31m${cat}${reset}`;
          const nameStr = name.padEnd(maxNameLen);
          const ruleStr = count === 1 ? '1 rule ' : `${count} rules`;
          const ruleLabel = count > 0 ? `${violet}${bold}${ruleStr}${reset}` : `${dim}${ruleStr}${reset}`;

          if (count === 0) {
            console.log(`  ${catLabel}  ${dim}${nameStr}${reset}  ${bar}  ${dim}${ruleStr}  ·   — no coverage${reset}`);
          } else if (dbData) {
            const m = dbData[cat]?.matches ?? 0;
            const f = dbData[cat]?.files ?? 0;
            console.log(`  ${catLabel}  ${dim}${nameStr}${reset}  ${bar}  ${ruleLabel}  ·  ${violet}${m} match${m !== 1 ? 'es' : ''}${reset}  ${dim}·  ${f} file${f !== 1 ? 's' : ''}${reset}`);
          } else {
            console.log(`  ${catLabel}  ${dim}${nameStr}${reset}  ${bar}  ${ruleLabel}`);
          }
        }

        const covered = Object.values(ruleCounts).filter(n => n > 0).length;
        console.log();
        console.log(`  ${dim}Coverage: ${reset}${violet}${bold}${covered}/10${reset}${dim} OWASP categories have at least one rule.${reset}`);
        if (covered < 10) {
          console.log(`  ${dim}Add custom rules via patternLibraryPath to improve coverage.${reset}`);
        }
        console.log();
        return;
      }

      // ── --save-baseline mode ──────────────────────────────────────────────────
      if (opts.saveBaseline !== undefined) {
        const KiroGraphSB = (await import('../../index')).default;
        if (!KiroGraphSB.isInitialized(target)) {
          console.error(`\n  \x1b[31m✖ KiroGraph not initialized. Run: kirograph init${reset}\n`);
          process.exit(1);
        }
        const configSB = await loadConfig(target).catch(() => null);
        if (!(configSB as any)?.enablePatterns) {
          console.error(`\n  \x1b[33m⚠ kirograph pattern --save-baseline requires enablePatterns: true.${reset}`);
          console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enablePatterns": true${reset}`);
          console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
          process.exit(1);
        }
        const sbLabel = typeof opts.saveBaseline === 'string' && opts.saveBaseline
          ? opts.saveBaseline
          : 'default';

        const cg = await KiroGraphSB.open(target);
        const rawDb = cg.getDatabase().getRawDb();

        const tableExists = rawDb.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_matches'",
        ) as { name: string } | undefined;

        if (!tableExists) {
          cg.close();
          console.error(`\n  \x1b[31m✖ pattern_matches table not found. Run: kirograph index with enablePatterns: true${reset}\n`);
          process.exit(1);
        }

        type SBCountRow = { pattern_id: string; cnt: number };
        const rows = rawDb.all(
          'SELECT pattern_id, COUNT(*) as cnt FROM pattern_matches GROUP BY pattern_id',
        ) as SBCountRow[];

        const counts: Record<string, number> = {};
        let totalMatches = 0;
        for (const row of rows) {
          counts[row.pattern_id] = row.cnt;
          totalMatches += row.cnt;
        }
        cg.close();

        const kirographDir = path.join(target, '.kirograph');
        const baselineFile = path.join(kirographDir, `pattern-baseline-${sbLabel}.json`);
        const data = { savedAt: new Date().toISOString(), counts, totalMatches };
        fs.writeFileSync(baselineFile, JSON.stringify(data, null, 2), 'utf8');

        console.log(`\n  \x1b[32m✓${reset} Baseline saved: ${violet}${bold}${sbLabel}${reset}`);
        console.log(`  ${dim}${totalMatches} total matches across ${Object.keys(counts).length} patterns${reset}`);
        console.log(`  ${dim}Saved to: ${baselineFile}${reset}\n`);
        return;
      }

      // ── --diff mode ───────────────────────────────────────────────────────────
      if (opts.diff !== undefined) {
        const KiroGraphDiff = (await import('../../index')).default;
        if (!KiroGraphDiff.isInitialized(target)) {
          console.error(`\n  \x1b[31m✖ KiroGraph not initialized. Run: kirograph init${reset}\n`);
          process.exit(1);
        }
        const configDiff = await loadConfig(target).catch(() => null);
        if (!(configDiff as any)?.enablePatterns) {
          console.error(`\n  \x1b[33m⚠ kirograph pattern --diff requires enablePatterns: true.${reset}`);
          console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enablePatterns": true${reset}`);
          console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
          process.exit(1);
        }
        const diffLabel = typeof opts.diff === 'string' && opts.diff
          ? opts.diff
          : 'default';

        const kirographDir = path.join(target, '.kirograph');
        const baselineFile = path.join(kirographDir, `pattern-baseline-${diffLabel}.json`);

        if (!fs.existsSync(baselineFile)) {
          const saveCmd = diffLabel !== 'default'
            ? `kirograph pattern --save-baseline ${diffLabel}`
            : 'kirograph pattern --save-baseline';
          console.log(`\n  ${dim}No baseline found. Run: ${reset}${violet}${bold}${saveCmd}${reset}\n`);
          process.exit(0);
        }

        type BaselineData = { savedAt: string; counts: Record<string, number>; totalMatches: number };
        const baseline: BaselineData = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as BaselineData;

        const cg = await KiroGraphDiff.open(target);
        const rawDb = cg.getDatabase().getRawDb();

        const tableExists = rawDb.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_matches'",
        ) as { name: string } | undefined;

        type DiffCountRow = { pattern_id: string; cnt: number };
        const currentRows = tableExists
          ? (rawDb.all('SELECT pattern_id, COUNT(*) as cnt FROM pattern_matches GROUP BY pattern_id') as DiffCountRow[])
          : [];
        cg.close();

        const current: Record<string, number> = {};
        for (const row of currentRows) current[row.pattern_id] = row.cnt;

        const allKeys = new Set([...Object.keys(baseline.counts), ...Object.keys(current)]);
        type DiffEntry = { id: string; baseCount: number; currCount: number; delta: number };
        const newFindings: DiffEntry[] = [];
        const resolved: DiffEntry[] = [];
        const unchanged: DiffEntry[] = [];

        for (const id of allKeys) {
          const base = baseline.counts[id] ?? 0;
          const curr = current[id] ?? 0;
          const delta = curr - base;
          if (delta > 0) newFindings.push({ id, baseCount: base, currCount: curr, delta });
          else if (delta < 0) resolved.push({ id, baseCount: base, currCount: curr, delta });
          else if (curr > 0) unchanged.push({ id, baseCount: base, currCount: curr, delta });
        }

        newFindings.sort((a, b) => b.delta - a.delta);
        resolved.sort((a, b) => a.delta - b.delta);

        const savedDate = baseline.savedAt.slice(0, 10);
        const netDelta = newFindings.reduce((s, e) => s + e.delta, 0) + resolved.reduce((s, e) => s + e.delta, 0);

        if (opts.format === 'json') {
          process.stdout.write(JSON.stringify({
            baseline: { label: diffLabel, savedAt: baseline.savedAt, totalMatches: baseline.totalMatches },
            new: newFindings.map(e => ({ id: e.id, delta: e.delta, current: e.currCount })),
            resolved: resolved.map(e => ({ id: e.id, delta: e.delta, current: e.currCount })),
            unchanged: unchanged.map(e => ({ id: e.id, count: e.currCount })),
            netDelta,
          }, null, 2) + '\n');
          return;
        }

        const allEntries = [...newFindings, ...resolved, ...unchanged];
        const maxIdLen = allEntries.length > 0
          ? Math.max(...allEntries.map(e => e.id.length), 20)
          : 20;

        console.log(`\n  ${section('Pattern Diff')} ${dim}vs ${diffLabel} baseline (saved ${savedDate})${reset}\n`);

        if (newFindings.length > 0) {
          console.log(`  \x1b[31m✖ NEW${reset} ${dim}(${newFindings.length} new finding${newFindings.length !== 1 ? 's' : ''})${reset}`);
          for (const e of newFindings) {
            const idPad = e.id.padEnd(maxIdLen);
            console.log(`    ${violet}${bold}${idPad}${reset}  \x1b[31m+${e.delta} new match${e.delta !== 1 ? 'es' : ''}${reset}`);
          }
          console.log();
        }

        if (resolved.length > 0) {
          console.log(`  \x1b[32m✓ RESOLVED${reset} ${dim}(${resolved.length} resolved)${reset}`);
          for (const e of resolved) {
            const idPad = e.id.padEnd(maxIdLen);
            console.log(`    ${dim}${idPad}${reset}  \x1b[32m${e.delta} match${Math.abs(e.delta) !== 1 ? 'es' : ''}${reset}`);
          }
          console.log();
        }

        if (unchanged.length > 0) {
          console.log(`  ${dim}= UNCHANGED${reset}`);
          for (const e of unchanged) {
            const idPad = e.id.padEnd(maxIdLen);
            console.log(`    ${dim}${idPad}  ${e.currCount} match${e.currCount !== 1 ? 'es' : ''} (no change)${reset}`);
          }
          console.log();
        }

        if (allEntries.length === 0) {
          console.log(`  ${dim}No pattern matches found in either baseline or current index.${reset}\n`);
          return;
        }

        const netLabel = netDelta > 0
          ? `\x1b[31m+${netDelta}${reset}`
          : netDelta < 0
            ? `\x1b[32m${netDelta}${reset}`
            : `${dim}0${reset}`;
        console.log(`  ${dim}Net:${reset} ${netLabel}${dim} findings since baseline${reset}\n`);
        return;
      }

      // ── --fix guard: only works with --library ───────────────────────────────
      if (opts.fix && !opts.library) {
        console.error(`  ${'\x1b[31m'}✖ --fix requires --library <id>. Inline patterns do not support automatic fixes.${reset}`);
        process.exit(1);
      }

      // ── Guards for live search / --library (require enablePatterns + napi) ──
      const config = await loadConfig(target);

      if (!config.enablePatterns) {
        console.error(`\n  ${'\x1b[31m'}✖ kirograph pattern requires enablePatterns: true in .kirograph/config.json${reset}`);
        console.error(`  ${dim}Enable it:${reset}  ${violet}${bold}"enablePatterns": true${reset}`);
        console.error(`  ${dim}Then install:${reset} ${violet}${bold}npm install @ast-grep/napi${reset}`);
        console.error(`  ${dim}Then re-index:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(2);
      }

      const { PatternRunner } = await import('../../patterns/runner');
      const runner = new PatternRunner();

      if (!runner.isAvailable()) {
        console.error(`\n  ${'\x1b[31m'}✖ kirograph pattern requires @ast-grep/napi${reset}`);
        console.error(`  ${dim}Install it with:${reset} ${violet}${bold}npm install @ast-grep/napi${reset}\n`);
        process.exit(2);
      }

      // ── Auto-detect: positional arg that matches a library rule ID ──────────
      if (!opts.library && patternArg) {
        const { PatternLibraryLoader: AutoLoader } = await import('../../patterns/loader');
        const autoRules = new AutoLoader().load(resolveLibraryPath(), config.patternLibraryPath);
        if (autoRules.some(r => r.id === patternArg)) {
          console.log(`  ${dim}Tip: '${patternArg}' is a library rule. Running as --library ${patternArg}${reset}`);
          opts.library = patternArg;
          patternArg = undefined;
        }
      }

      // ── --library <id> mode ──────────────────────────────────────────────────
      if (opts.library) {
        if (!require('../../index').default.isInitialized(target)) {
          console.error('  ✖ KiroGraph not initialized. Run: kirograph init');
          process.exit(1);
        }

        const KiroGraph = (await import('../../index')).default;
        const cg = await KiroGraph.open(target);
        const db = cg.getDatabase();
        const rawDb = db.getRawDb();

        const { PatternLibraryLoader } = await import('../../patterns/loader');
        const loader = new PatternLibraryLoader();
        const libraryPath = resolveLibraryPath();
        const customPath = config.patternLibraryPath;
        const rules = loader.load(libraryPath, customPath);

        const rule = rules.find(r => r.id === opts.library);
        if (!rule) {
          console.error(`  ✖ Rule "${opts.library}" not found. Run: kirograph pattern --list`);
          cg.close();
          process.exitCode = 1; return;
        }

        // Determine languages to filter by
        const langs = Array.isArray(rule.language) ? rule.language : [rule.language];

        // Query files for this language
        const placeholders = langs.map(() => '?').join(', ');
        const files: Array<{ path: string; language: string }> = rawDb.all(
          `SELECT path, language FROM files WHERE language IN (${placeholders}) LIMIT 5000`,
          langs,
        );

        const allMatches: Array<{ filePath: string; line: number; matchText: string; context: string }> = [];

        // ── --fix mode: apply fixes in-place ─────────────────────────────────
        if (opts.fix) {
          const { PatternRunner: FixPatternRunner } = await import('../../patterns/runner');
          const fixRunner = new FixPatternRunner();
          if (!fixRunner.isAvailable()) {
            console.error(`  \x1b[31m✖ --fix requires @ast-grep/napi. Run: npm install @ast-grep/napi${reset}`);
            cg.close?.();
            process.exitCode = 2; return;
          }

          if (!rule.fix) {
            console.error(`  ${'\x1b[31m'}✖ Rule "${rule.id}" does not have a fix: template defined.${reset}`);
            cg.close();
            process.exitCode = 1; return;
          }

          let fixedFiles = 0;
          let totalChanges = 0;

          for (const file of files) {
            let content: string;
            const fullPath = path.isAbsolute(file.path) ? file.path : path.join(target, file.path);
            try {
              content = fs.readFileSync(fullPath, 'utf8');
            } catch {
              continue;
            }

            // Count matches before fix to report change count
            const matchesBefore = await fixRunner.runRule(rule, content, file.language);
            if (matchesBefore.length === 0) continue;

            const fixed = await fixRunner.applyFix(fullPath, content, file.language, rule);
            if (fixed !== null && fixed !== content) {
              fs.writeFileSync(fullPath, fixed, 'utf8');
              const relPath = path.relative(target, fullPath);
              console.log(`  \x1b[32m✓ Fixed\x1b[0m ${relPath} (${matchesBefore.length} change${matchesBefore.length !== 1 ? 's' : ''})`);
              fixedFiles++;
              totalChanges += matchesBefore.length;
            }
          }

          cg.close();
          console.log(`\n  Fixed ${fixedFiles} file${fixedFiles !== 1 ? 's' : ''}, ${totalChanges} total change${totalChanges !== 1 ? 's' : ''}\n`);
          process.exitCode = 0; return;
        }

        for (const file of files) {
          let content: string;
          try {
            const fullPath = path.isAbsolute(file.path) ? file.path : path.join(target, file.path);
            content = fs.readFileSync(fullPath, 'utf8');
          } catch {
            continue;
          }
          const matches = await runner.runRule(rule, content, file.language);
          for (const m of matches) {
            allMatches.push({ filePath: file.path, line: m.line, matchText: m.matchText, context: m.context });
          }
        }

        cg.close();

        // Apply severity filter (already filtered by rule severity — but allow user to filter further)
        const sev = opts.severity as SeverityLevel | undefined;
        if (sev && SEVERITY_LEVELS.includes(sev)) {
          if (SEVERITY_ORDER[rule.severity] < SEVERITY_ORDER[sev]) {
            // The rule's severity is below the requested filter — no results
            if (opts.format === 'json') {
              process.stdout.write(JSON.stringify([], null, 2) + '\n');
            } else {
              console.log(`\n  ${dim}No matches (rule severity "${rule.severity}" is below filter "${sev}").${reset}\n`);
            }
            process.exitCode = 0; return;
          }
        }

        if (opts.format === 'json') {
          process.stdout.write(JSON.stringify(allMatches.map(m => ({
            filePath: m.filePath,
            line: m.line,
            matchText: m.matchText,
            rule: { id: rule.id, severity: rule.severity, owaspCategory: rule.owaspCategory, description: rule.description, fixHint: rule.fixHint },
          })), null, 2) + '\n');
          process.exitCode = allMatches.length > 0 ? 1 : 0; return;
        }

        if (allMatches.length === 0) {
          console.log(`\n  ${dim}No matches for library rule '${rule.id}'.${reset}\n`);
          process.exitCode = 0; return;
        }

        const sc = severityColor(rule.severity);
        console.log(`\n  ${section(rule.description)}`);
        console.log(`  ${dim}Rule:${reset} ${violet}${bold}${rule.id}${reset}  ${sc}${rule.severity}${reset}  ${dim}[${rule.owaspCategory}]${reset}`);
        console.log(`  ${dim}Fix:${reset} ${rule.fixHint}`);
        console.log(`\n  ${allMatches.length} match${allMatches.length !== 1 ? 'es' : ''}\n`);

        for (const m of allMatches) {
          const relPath = path.relative(target, path.isAbsolute(m.filePath) ? m.filePath : path.join(target, m.filePath));
          console.log(`  ${violet}${bold}${relPath}:${m.line}${reset}`);
          console.log(`    ${dim}${m.matchText}${reset}`);
          console.log(`    ${'─'.repeat(17)}`);
        }

        console.log();
        process.exitCode = 1; return;
      }

      // ── Live search mode (positional pattern) ────────────────────────────────
      if (!patternArg) {
        console.error('  ✖ Provide a pattern to search, or use --list / --library <id>');
        process.exit(1);
      }

      const KiroGraph = (await import('../../index')).default;
      if (!KiroGraph.isInitialized(target)) {
        console.error('  ✖ KiroGraph not initialized. Run: kirograph init');
        process.exit(1);
      }

      const cg = await KiroGraph.open(target);
      const db = cg.getDatabase();
      const rawDb = db.getRawDb();

      // Build query based on --lang filter
      let files: Array<{ path: string; language: string }>;
      if (opts.lang) {
        files = rawDb.all(
          'SELECT path, language FROM files WHERE language = ? LIMIT 5000',
          [opts.lang],
        );
      } else {
        files = rawDb.all('SELECT path, language FROM files LIMIT 5000');
      }

      const allMatches: Array<{ filePath: string; line: number; matchText: string; context: string; language: string }> = [];

      for (const file of files) {
        let content: string;
        try {
          const fullPath = path.isAbsolute(file.path) ? file.path : path.join(target, file.path);
          content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }
        const matches = await runner.runInline(patternArg, file.language, content);
        for (const m of matches) {
          allMatches.push({ filePath: file.path, line: m.line, matchText: m.matchText, context: m.context, language: file.language });
        }
      }

      cg.close();

      if (opts.format === 'json') {
        process.stdout.write(JSON.stringify(allMatches.map(m => ({
          filePath: m.filePath,
          line: m.line,
          matchText: m.matchText,
          language: m.language,
        })), null, 2) + '\n');
        process.exitCode = allMatches.length > 0 ? 1 : 0; return;
      }

      const langLabel = opts.lang ? ` in ${opts.lang} files` : '';
      console.log(`\n  ${allMatches.length} match${allMatches.length !== 1 ? 'es' : ''} for ${violet}${bold}'${patternArg}'${reset}${langLabel}\n`);

      if (allMatches.length === 0) {
        process.exitCode = 0; return;
      }

      for (const m of allMatches) {
        const relPath = path.relative(target, path.isAbsolute(m.filePath) ? m.filePath : path.join(target, m.filePath));
        console.log(`  ${violet}${bold}${relPath}:${m.line}${reset}`);
        console.log(`    ${dim}${m.matchText}${reset}`);
        console.log(`    ${'─'.repeat(17)}`);
      }

      console.log();
      process.exitCode = 1; return;
    });
}
