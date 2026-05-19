/**
 * kirograph gain — Token savings analytics CLI command
 */

import { Command } from 'commander';

export function register(program: Command): void {
  program
    .command('gain')
    .description('Show token savings from kirograph_exec compression')
    .option('--graph', 'Show ASCII graph of daily savings')
    .option('--history', 'Show recent command history')
    .option('--daily', 'Show day-by-day breakdown')
    .option('--period <period>', 'Time period: session, today, week, all', 'all')
    .option('--json', 'Output as JSON')
    .action(async (opts: { graph?: boolean; history?: boolean; daily?: boolean; period: string; json?: boolean }) => {
      const { TokenTracker } = await import('../../compression/tracker');
      const tracker = new TokenTracker(process.cwd());

      if (opts.history) {
        const history = tracker.getHistory(20);
        if (history.length === 0) {
          console.log('  No commands recorded yet. Use kirograph_exec to run commands with compression.');
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(history, null, 2));
          return;
        }

        console.log('  Recent compressed commands:\n');
        for (const r of history) {
          const date = new Date(r.timestamp).toLocaleString();
          const savings = r.originalTokens > 0
            ? Math.round(((r.originalTokens - r.compressedTokens) / r.originalTokens) * 100)
            : 0;
          const cmd = r.command.length > 50 ? r.command.slice(0, 47) + '...' : r.command;
          console.log(`  ${date}  ${cmd.padEnd(50)}  ${savings}% saved  (${r.strategy})`);
        }
        return;
      }

      if (opts.daily || opts.graph) {
        const daily = tracker.getDailyBreakdown(30);
        if (daily.length === 0) {
          console.log('  No data yet.');
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(daily, null, 2));
          return;
        }

        if (opts.graph) {
          console.log('  Token savings (last 30 days):\n');
          const maxSaved = Math.max(...daily.map(d => d.saved), 1);
          const barWidth = 40;

          for (const day of daily) {
            const bar = '█'.repeat(Math.round((day.saved / maxSaved) * barWidth));
            const label = day.date.slice(5); // MM-DD
            console.log(`  ${label} ${bar} ${day.saved.toLocaleString()} tokens (${day.commands} cmds)`);
          }
          return;
        }

        console.log('  Daily breakdown:\n');
        console.log('  Date        Commands  Tokens Saved');
        console.log('  ' + '─'.repeat(40));
        for (const day of daily) {
          console.log(`  ${day.date}  ${String(day.commands).padStart(8)}  ${day.saved.toLocaleString().padStart(12)}`);
        }
        return;
      }

      // Default: summary stats
      const period = opts.period as 'session' | 'today' | 'week' | 'all';
      const stats = tracker.getStats(period);

      if (stats.totalCommands === 0) {
        console.log('  No compressed commands recorded yet.');
        console.log('  Use kirograph_exec (MCP tool) to run commands with compression.');
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(`\n  Token Savings (${period}):`);
      console.log(`  ${'─'.repeat(40)}`);
      console.log(`  Commands executed:   ${stats.totalCommands}`);
      console.log(`  Original tokens:     ${stats.totalOriginal.toLocaleString()}`);
      console.log(`  Compressed tokens:   ${stats.totalCompressed.toLocaleString()}`);
      console.log(`  Tokens saved:        ${stats.totalSaved.toLocaleString()} (${stats.savingsPercent}%)`);

      if (Object.keys(stats.byFamily).length > 0) {
        console.log(`\n  By command family:`);
        for (const [family, data] of Object.entries(stats.byFamily)) {
          console.log(`    ${family.padEnd(15)} ${String(data.count).padStart(4)} calls  ${data.savings}% avg savings`);
        }
      }

      console.log();
    });
}
