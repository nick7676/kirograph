import { Command } from 'commander';
import * as path from 'path';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green, section } from '../ui';

export function register(program: Command): Command {
  const secCmd = program
    .command('security')
    .description('Security analysis: overview, dashboard export, and vulnerability management')
    .argument('[projectPath]', 'Project root path (optional)')
    .option('--refresh-staleness', 'Fetch latest version info from registries and show stale dependency count')
    .option('--fail-on <condition>', 'Exit 1 if condition is met. Supported: affected')
    .action(async (projectPath: string | undefined, opts: { refreshStaleness?: boolean; failOn?: string }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      if (!config.enableArchitecture) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security requires Architecture analysis to be enabled.${reset}`);
        console.error(`  ${dim}Enable both in .kirograph/config.json:${reset}`);
        console.error(`    ${violet}${bold}"enableArchitecture": true${reset}`);
        console.error(`    ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
        process.exit(1);
      }

      if (opts.failOn !== undefined && opts.failOn !== 'affected') {
        console.error(`  ✖ Invalid --fail-on value: ${opts.failOn}. Supported: affected`);
        process.exit(1);
      }

      const KiroGraph = (await import('../../index')).default;
      if (!KiroGraph.isInitialized(target)) {
        console.error('  ✖ KiroGraph not initialized. Run: kirograph init');
        process.exit(1);
      }

      const cg = await KiroGraph.open(target);
      const db = cg.getDatabase();
      db.applySecuritySchema();
      const rawDb = db.getRawDb();

      // Optionally refresh staleness data from registries
      if (opts.refreshStaleness) {
        console.error(`  ${dim}Fetching latest version info from package registries...${reset}`);
        const { StalenessChecker } = await import('../../security/staleness');
        const checker = new StalenessChecker(db);
        const result = await checker.checkAll();
        console.error(`  ${green}✓${reset} Checked ${bold}${result.checked}${reset} packages, ${bold}${result.stale}${reset} stale`);
        if (result.errors.length > 0) {
          console.error(`  ${'\x1b[33m'}⚠${reset} ${result.errors.length} error(s) during registry fetch`);
        }
        console.error();
      }

      // Query dependency counts
      const depCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies`,
      ) ?? { count: 0 };

      // Query vulnerability counts
      const vulnCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_vulnerabilities`,
      ) ?? { count: 0 };

      // Query reachability verdict counts
      const verdictRows: Array<{ verdict: string; count: number }> = rawDb.all(
        `SELECT verdict, COUNT(*) as count FROM sec_reachability GROUP BY verdict`,
      );
      const verdicts: Record<string, number> = {};
      for (const row of verdictRows) {
        verdicts[row.verdict] = row.count;
      }

      // Check for stale data
      const staleCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies WHERE vuln_data_stale = 1`,
      ) ?? { count: 0 };

      // Display overview
      console.log(`\n  ${section('Security Overview')}\n`);
      console.log(`  ${dim}Dependencies:${reset}          ${violet}${bold}${depCount.count}${reset}`);
      console.log(`  ${dim}Vulnerabilities:${reset}       ${violet}${bold}${vulnCount.count}${reset}`);
      console.log();

      if (vulnCount.count > 0) {
        // Show top-risk CVE when data is available
        const topCVE: { cve_id: string; risk_score: number | null; package_name: string | null } | undefined =
          rawDb.get(
            `SELECT v.cve_id, v.risk_score, d.package_name
             FROM sec_vulnerabilities v
             LEFT JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
             LEFT JOIN sec_dependencies d ON d.node_id = e.source
             LEFT JOIN sec_reachability r ON r.vulnerability_node_id = v.node_id
             WHERE r.verdict = 'affected' AND v.risk_score IS NOT NULL
             ORDER BY v.risk_score DESC NULLS LAST
             LIMIT 1`,
          );
        if (topCVE && topCVE.risk_score != null) {
          const riskColor = topCVE.risk_score >= 7 ? '\x1b[31m' : topCVE.risk_score >= 4 ? '\x1b[33m' : dim;
          const pkgLabel = topCVE.package_name ? ` in ${dim}${topCVE.package_name}${reset}` : '';
          console.log(`  ${riskColor}Top risk:${reset}              ${violet}${bold}${topCVE.cve_id}${reset} ${riskColor}(Risk: ${topCVE.risk_score.toFixed(1)})${reset}${pkgLabel}`);
          console.log();
        }

        console.log(`  ${section('Reachability Verdicts')}\n`);
        const affected = verdicts['affected'] ?? 0;
        const notAffected = verdicts['not_affected'] ?? 0;
        const underInvestigation = verdicts['under_investigation'] ?? 0;
        const noAnalysis = vulnCount.count - affected - notAffected - underInvestigation;

        if (affected > 0) {
          console.log(`  ${'\x1b[31m'}●${reset} Affected:              ${bold}${affected}${reset}`);
        }
        if (notAffected > 0) {
          console.log(`  ${green}●${reset} Not affected:          ${bold}${notAffected}${reset}`);
        }
        if (underInvestigation > 0) {
          console.log(`  ${'\x1b[33m'}●${reset} Under investigation:   ${bold}${underInvestigation}${reset}`);
        }
        if (noAnalysis > 0) {
          console.log(`  ${dim}●${reset} Pending analysis:      ${bold}${noAnalysis}${reset}`);
        }
        console.log();
      }

      if (staleCount.count > 0) {
        console.log(`  ${'\x1b[33m'}⚠${reset} ${bold}${staleCount.count}${reset} ${dim}dependenc${staleCount.count === 1 ? 'y has' : 'ies have'} stale vulnerability data.${reset}`);
        console.log(`  ${dim}Run${reset} ${violet}${bold}kirograph vulns --refresh${reset} ${dim}to update.${reset}\n`);
      }

      // Show stale dependency count (version staleness) if data exists
      const stalenessDataCount: { count: number } = rawDb.get(
        `SELECT COUNT(*) as count FROM sec_dependencies WHERE staleness_score IS NOT NULL`,
      ) ?? { count: 0 };

      if (stalenessDataCount.count > 0) {
        const staleDepCount: { count: number } = rawDb.get(
          `SELECT COUNT(*) as count FROM sec_dependencies WHERE staleness_score >= 0.3`,
        ) ?? { count: 0 };
        console.log(`  ${dim}Stale dependencies:${reset}    ${staleDepCount.count > 0 ? `${'\x1b[33m'}${bold}${staleDepCount.count}${reset}` : `${green}${bold}0${reset}`} ${dim}of ${stalenessDataCount.count} scored${reset}`);
        if (staleDepCount.count > 0) {
          console.log(`  ${dim}Run${reset} ${violet}${bold}kirograph staleness${reset} ${dim}for details.${reset}`);
        }
        console.log();
      } else if (!opts.refreshStaleness) {
        console.log(`  ${dim}No staleness data.${reset} ${dim}Run${reset} ${violet}${bold}kirograph security --refresh-staleness${reset} ${dim}to score dependencies.${reset}\n`);
      }

      // Check if vulnerability data is stale
      const lastCheck = (rawDb.get(
        `SELECT MIN(last_vuln_check) as oldest FROM sec_dependencies WHERE last_vuln_check IS NOT NULL`,
      ) as { oldest: number | null } | undefined)?.oldest;
      if (lastCheck != null) {
        const ageMs = Date.now() - lastCheck;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const maxAge = config.securityEnrichMaxAgeDays ?? 7;
        if (ageDays > maxAge) {
          console.log(`\n  ${'\x1b[33m'}⚠ Vulnerability data is ${Math.floor(ageDays)} days old (max: ${maxAge}).${reset}`);
          console.log(`  ${dim}Run${reset} ${violet}${bold}kirograph vulns --refresh${reset} ${dim}to update.${reset}`);
        }
      }

      // Pattern SAST findings (if enablePatterns and data exists)
      try {
        if (config.enablePatterns) {
          const tableExists = rawDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='pattern_matches'");
          if (tableExists) {
            const pm = rawDb.get('SELECT COUNT(*) as cnt FROM pattern_matches') as { cnt: number } | undefined;
            if ((pm?.cnt ?? 0) > 0) {
              const critPm = rawDb.get("SELECT COUNT(*) as cnt FROM pattern_matches WHERE severity='critical'") as { cnt: number } | undefined;
              console.log(`  ${dim}SAST findings:${reset}         ${violet}${bold}${pm!.cnt}${reset} ${dim}pattern matches (${critPm?.cnt ?? 0} critical)${reset}`);
              console.log(`  ${dim}Run${reset} ${violet}${bold}kirograph pattern --coverage${reset} ${dim}for details.${reset}\n`);
            }
          }
        }
      } catch { /* non-critical */ }

      // --fail-on: exit 1 if condition is met (after all output)
      if (opts.failOn === 'affected') {
        const affectedCount = verdicts['affected'] ?? 0;
        if (affectedCount > 0) {
          console.log(`\n  \x1b[31m✖\x1b[0m --fail-on affected: ${affectedCount} affected vulnerabilit${affectedCount === 1 ? 'y' : 'ies'} found. Exiting with code 1.`);
          cg.close();
          process.exit(1);
        }
      }

      cg.close();
    });

  return secCmd;
}
