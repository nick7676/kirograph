import * as path from 'path';
import { Command } from 'commander';
import { bold, dim, green, reset, violet } from '../ui';
import { loadConfig } from '../../config';

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function register(program: Command): void {
  program
    .command('hotspots [projectPath]')
    .description('Find the most-connected symbols by edge degree')
    .option('--limit <n>', 'Max results (default: 20)', '20')
    .option('--format <fmt>', 'Output format: table | json', 'table')
    .option('--security', 'Show only symbols with pattern matches, sorted by severity × caller count')
    .action(async (projectPath: string | undefined, opts: { limit: string; format: string; security?: boolean }) => {
      const KiroGraph = (await import('../../index')).default;
      const target = path.resolve(projectPath ?? process.cwd());
      const cg = await KiroGraph.open(target);
      const limit = Math.max(1, Math.min(100, parseInt(opts.limit) || 20));

      if (opts.security) {
        try {
          const config = await loadConfig(target);
          if (!config.enablePatterns) {
            console.error(`\n  kirograph hotspots --security requires enablePatterns: true and kirograph index to have been run.\n`);
            cg.close();
            process.exit(1);
          }

          const db = cg.getDatabase();
          (db as any).applyPatternsSchema?.();
          const rawDb = db.getRawDb();

          const tableExists = rawDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_matches'");
          if (!tableExists) {
            console.error(`\n  kirograph hotspots --security requires enablePatterns: true and kirograph index to have been run.\n`);
            cg.close();
            process.exit(1);
          }

          // Get all symbols that have pattern matches, with their worst severity
          const patternSymbols: Array<{ symbol_node_id: string; worst_severity: string; match_count: number; pattern_id: string; file_path: string; start_line: number }> =
            rawDb.all(`
              SELECT
                pm.symbol_node_id,
                pm.file_path,
                pm.start_line,
                pm.pattern_id,
                CASE MAX(CASE pm.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
                  WHEN 4 THEN 'critical' WHEN 3 THEN 'high' WHEN 2 THEN 'medium' WHEN 1 THEN 'low' ELSE 'unknown'
                END as worst_severity,
                COUNT(*) as match_count
              FROM pattern_matches pm
              GROUP BY pm.symbol_node_id
            `);

          if (patternSymbols.length === 0) {
            console.log(`\n  ${dim}No pattern matches found. Run kirograph index to populate pattern data.${reset}\n`);
            cg.close();
            return;
          }

          // Get hotspot data for all symbols, then join with pattern data
          const hotspots = cg.findHotspots(1000);
          cg.close();

          const hotspotMap = new Map(hotspots.map(h => [h.id ?? `${h.filePath}:${h.startLine}:${h.name}`, h]));

          // Build security hotspots: combine pattern severity × caller count
          type SecurityHotspot = {
            name: string;
            filePath: string;
            startLine: number;
            worstSeverity: string;
            patternId: string;
            matchCount: number;
            callerCount: number;
            calledCount: number;
            score: number;
          };

          const secHotspots: SecurityHotspot[] = patternSymbols.map(ps => {
            const h = hotspotMap.get(ps.symbol_node_id);
            const callerCount = h?.inDegree ?? 0;
            const calledCount = h?.outDegree ?? 0;
            const sevRank = SEVERITY_RANK[ps.worst_severity] ?? 1;
            return {
              name: h?.name ?? path.basename(ps.file_path),
              filePath: ps.file_path,
              startLine: ps.start_line,
              worstSeverity: ps.worst_severity,
              patternId: ps.pattern_id,
              matchCount: ps.match_count,
              callerCount,
              calledCount,
              score: sevRank * Math.max(1, callerCount),
            };
          });

          secHotspots.sort((a, b) => b.score - a.score);
          const results = secHotspots.slice(0, limit);

          if (opts.format === 'json') {
            console.log(JSON.stringify(results, null, 2));
            return;
          }

          console.log();
          console.log(`  ${violet}${bold}Security Hotspots${reset}  ${dim}(symbols with pattern matches)${reset}\n`);

          const severityColor = (sev: string): string => {
            if (sev === 'critical') return '\x1b[31m';
            if (sev === 'high') return '\x1b[33m';
            if (sev === 'medium') return '\x1b[36m';
            return dim;
          };

          for (const r of results) {
            const sevColor = severityColor(r.worstSeverity);
            const sevTag = `[${r.worstSeverity.toUpperCase()}]`.padEnd(10);
            console.log(`  ${dim}${r.filePath}:${r.startLine}${reset}   ${violet}${bold}${r.name}${reset}`);
            console.log(`    ${sevColor}● ${sevTag}${reset} ${dim}${r.patternId}${reset}  ${dim}·  calls: ${r.calledCount}  ·  callers: ${r.callerCount}${reset}`);
            console.log();
          }

          console.log(`  ${dim}${results.length} result(s)${reset}\n`);
        } catch (err) {
          cg.close();
          throw err;
        }
        return;
      }

      const hotspots = cg.findHotspots(limit);
      cg.close();

      if (hotspots.length === 0) {
        console.log(`\n  ${dim}No symbols found in index.${reset}\n`);
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(hotspots, null, 2));
        return;
      }

      console.log();
      console.log(`  ${violet}${bold}Hotspots${reset}  ${dim}most-connected symbols${reset}\n`);

      const maxDegree = hotspots[0].degree;
      const BAR_WIDTH = 20;

      for (let i = 0; i < hotspots.length; i++) {
        const n = hotspots[i];
        const rank = String(i + 1).padStart(2);
        const bar = Math.round((n.degree / maxDegree) * BAR_WIDTH);
        const barStr = '█'.repeat(bar) + '░'.repeat(BAR_WIDTH - bar);
        console.log(`  ${dim}${rank}.${reset} ${violet}${bold}${n.name}${reset}  ${dim}${n.kind}${reset}`);
        console.log(`      ${violet}${barStr}${reset}  ${bold}${n.degree}${reset}${dim} edges (↑${n.inDegree} ↓${n.outDegree})${reset}`);
        console.log(`      ${dim}${n.filePath}:${n.startLine}${reset}`);
      }

      console.log(`\n  ${dim}${hotspots.length} result(s)${reset}\n`);
    });
}
