/**
 * kirograph exec <command...> — Run a shell command with token-optimized output
 *
 * Examples:
 *   kirograph exec git status
 *   kirograph exec --level aggressive npm test
 *   kirograph exec -l ultra ls -la src/
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { compress } from '../../compression/index';
import { TokenTracker } from '../../compression/tracker';
import { loadConfig } from '../../config';
import { dim, green, reset, violet } from '../ui';

export function register(program: Command): void {
  program
    .command('exec')
    .description('Run a shell command and return token-optimized output')
    .option('-l, --level <level>', 'Compression level: normal, aggressive, ultra')
    .option('-t, --timeout <seconds>', 'Timeout in seconds', '60')
    .option('--raw', 'Also print the raw output for comparison')
    .option('--json', 'Output result as JSON')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (opts: { level?: string; timeout?: string; raw?: boolean; json?: boolean }, cmd: Command) => {
      // Everything after "exec" and known options is the command to run
      const args = cmd.args;
      if (args.length === 0) {
        console.error('  Usage: kirograph exec <command...>');
        console.error('  Example: kirograph exec git status');
        process.exit(1);
      }

      const shellCommand = args.join(' ');
      const cwd = process.cwd();
      const timeout = (parseInt(opts.timeout || '60', 10) || 60) * 1000;

      // Read default level from config
      let defaultLevel: 'normal' | 'aggressive' | 'ultra' = 'normal';
      try {
        const config = await loadConfig(cwd);
        if (config.compressionLevel && config.compressionLevel !== 'off') {
          defaultLevel = config.compressionLevel as 'normal' | 'aggressive' | 'ultra';
        }
      } catch { /* no config */ }

      const level = (opts.level as 'normal' | 'aggressive' | 'ultra') || defaultLevel;
      const validLevels = ['normal', 'aggressive', 'ultra'];
      if (!validLevels.includes(level)) {
        console.error(`  Unknown level: ${level}. Choose from: normal, aggressive, ultra`);
        process.exit(1);
      }

      // Execute the command
      let rawOutput: string;
      let exitCode = 0;
      try {
        rawOutput = execSync(shellCommand, {
          cwd,
          timeout,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (err: any) {
        rawOutput = (err.stdout || '') + (err.stderr || '');
        exitCode = err.status ?? 1;
      }

      // Compress
      const result = compress(shellCommand, rawOutput, { level, preserveErrors: exitCode !== 0 });

      // Track savings
      const tracker = new TokenTracker(cwd);
      tracker.record(shellCommand, result.originalTokens, result.compressedTokens, result.strategy);

      // Output
      if (opts.json) {
        console.log(JSON.stringify({
          command: shellCommand,
          exitCode,
          level,
          strategy: result.strategy,
          commandFamily: result.commandFamily,
          originalTokens: result.originalTokens,
          compressedTokens: result.compressedTokens,
          savings: result.savings,
          output: result.output,
        }, null, 2));
        process.exit(exitCode);
        return;
      }

      if (opts.raw) {
        console.log(`${dim}── raw (${result.originalTokens} tokens) ──${reset}`);
        console.log(rawOutput);
        console.log(`${dim}── compressed (${result.compressedTokens} tokens) ──${reset}`);
      }

      // Print compressed output
      if (exitCode !== 0) {
        process.stderr.write(result.output + '\n');
      } else {
        console.log(result.output);
      }

      // Print savings footer
      if (result.savings > 5) {
        console.log(`\n${dim}[${green}${result.savings}% saved${reset}${dim} | ${result.originalTokens}→${result.compressedTokens} tokens | ${violet}${result.strategy}${reset}${dim}]${reset}`);
      }

      process.exit(exitCode);
    });
}
