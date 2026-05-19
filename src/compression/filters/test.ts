/**
 * Test runner output filters (jest, vitest, pytest, cargo test, go test, rspec, minitest)
 */

import type { CommandFilter, FilterResult, CompressorOptions } from '../types';

export const testFilter: CommandFilter = {
  name: 'test',

  matches(command: string): boolean {
    return /\b(jest|vitest|pytest|cargo\s+test|go\s+test|rspec|rake\s+test|mocha|ava|tap|npm\s+test|yarn\s+test|pnpm\s+test|npx\s+vitest|npx\s+jest)\b/.test(command);
  },

  filter(command: string, rawOutput: string, level: CompressorOptions['level']): FilterResult {
    // Detect which runner
    if (/vitest/i.test(command)) return filterVitest(rawOutput, level);
    if (/jest/i.test(command)) return filterJest(rawOutput, level);
    if (/pytest/i.test(command)) return filterPytest(rawOutput, level);
    if (/cargo\s+test/i.test(command)) return filterCargoTest(rawOutput, level);
    if (/go\s+test/i.test(command)) return filterGoTest(rawOutput, level);
    if (/rspec/i.test(command)) return filterRspec(rawOutput, level);
    if (/rake\s+test/i.test(command)) return filterMinitest(rawOutput, level);

    // Generic test output
    return filterGenericTest(rawOutput, level);
  },
};

function filterVitest(raw: string, level: CompressorOptions['level']): FilterResult {
  return filterJsTestRunner(raw, level, 'vitest');
}

function filterJest(raw: string, level: CompressorOptions['level']): FilterResult {
  return filterJsTestRunner(raw, level, 'jest');
}

function filterJsTestRunner(raw: string, level: CompressorOptions['level'], runner: string): FilterResult {
  const lines = raw.split('\n');

  // Check if all passed
  const summaryLine = lines.find(l => /Tests:\s+\d+/.test(l) || /\d+\s+passed/.test(l));
  const failedMatch = raw.match(/(\d+)\s+failed/);
  const passedMatch = raw.match(/(\d+)\s+passed/);
  const totalMatch = raw.match(/Tests:\s+(\d+)/);

  const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
  const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
  const total = totalMatch ? parseInt(totalMatch[1]) : (failed + passed);

  if (failed === 0) {
    if (level === 'ultra') {
      return { output: `✓ ${passed}/${total}`, strategy: `${runner}:allpass:ultra` };
    }
    return { output: `PASSED: ${passed}/${total} tests`, strategy: `${runner}:allpass` };
  }

  // Extract failure details
  const failures: string[] = [];
  let inFailure = false;
  let failureBlock: string[] = [];

  for (const line of lines) {
    if (line.includes('FAIL') && line.includes('●') || line.includes('✕') || line.includes('✗') || line.match(/FAIL\s+/)) {
      if (failureBlock.length > 0) failures.push(failureBlock.join('\n'));
      failureBlock = [line];
      inFailure = true;
    } else if (inFailure) {
      if (line.trim() === '' && failureBlock.length > 3) {
        failures.push(failureBlock.join('\n'));
        failureBlock = [];
        inFailure = false;
      } else {
        failureBlock.push(line);
      }
    }
  }
  if (failureBlock.length > 0) failures.push(failureBlock.join('\n'));

  const header = `FAILED: ${failed}/${total} tests`;
  if (level === 'ultra') {
    const shortFailures = failures.map(f => f.split('\n')[0]).slice(0, 5);
    return { output: `${header}\n${shortFailures.join('\n')}`, strategy: `${runner}:failures:ultra` };
  }

  const maxFailures = level === 'aggressive' ? 3 : 5;
  const shown = failures.slice(0, maxFailures).join('\n\n');
  const extra = failures.length > maxFailures ? `\n…+${failures.length - maxFailures} more failures` : '';

  return { output: `${header}\n\n${shown}${extra}`, strategy: `${runner}:failures` };
}

function filterPytest(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');

  // Summary line: "X passed, Y failed"
  const summaryLine = lines.find(l => /\d+\s+passed/.test(l) || /\d+\s+failed/.test(l));
  const failedMatch = raw.match(/(\d+)\s+failed/);
  const passedMatch = raw.match(/(\d+)\s+passed/);

  const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
  const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
  const total = failed + passed;

  if (failed === 0) {
    if (level === 'ultra') return { output: `✓ ${passed}/${total}`, strategy: 'pytest:allpass:ultra' };
    return { output: `PASSED: ${passed}/${total} tests`, strategy: 'pytest:allpass' };
  }

  // Extract FAILED sections
  const failures: string[] = [];
  let inFailure = false;
  let block: string[] = [];

  for (const line of lines) {
    if (line.startsWith('FAILED') || line.startsWith('___ ') || line.includes('FAILURES ___')) {
      if (block.length > 0) failures.push(block.join('\n'));
      block = [line];
      inFailure = true;
    } else if (inFailure) {
      block.push(line);
      if (block.length > 20) {
        failures.push(block.join('\n'));
        block = [];
        inFailure = false;
      }
    }
  }
  if (block.length > 0) failures.push(block.join('\n'));

  const header = `FAILED: ${failed}/${total} tests`;
  const maxFailures = level === 'ultra' ? 2 : level === 'aggressive' ? 3 : 5;
  const shown = failures.slice(0, maxFailures).join('\n\n');
  const extra = failures.length > maxFailures ? `\n…+${failures.length - maxFailures} more` : '';

  return { output: `${header}\n\n${shown}${extra}`, strategy: 'pytest:failures' };
}

function filterCargoTest(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');

  const resultLine = lines.find(l => l.startsWith('test result:'));
  const failedMatch = raw.match(/(\d+)\s+failed/);
  const passedMatch = raw.match(/(\d+)\s+passed/);

  const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
  const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
  const total = failed + passed;

  if (failed === 0) {
    if (level === 'ultra') return { output: `✓ ${passed}/${total}`, strategy: 'cargo-test:allpass:ultra' };
    return { output: `PASSED: ${passed}/${total} tests`, strategy: 'cargo-test:allpass' };
  }

  // Extract failures
  const failures: string[] = [];
  let inFailure = false;
  let block: string[] = [];

  for (const line of lines) {
    if (line.includes('FAILED') || line.includes("panicked at") || line.includes('---- ') && line.includes(' ----')) {
      if (block.length > 0) failures.push(block.join('\n'));
      block = [line];
      inFailure = true;
    } else if (inFailure) {
      if (line.startsWith('test ') && line.includes('...')) {
        failures.push(block.join('\n'));
        block = [];
        inFailure = false;
      } else {
        block.push(line);
      }
    }
  }
  if (block.length > 0) failures.push(block.join('\n'));

  const header = `FAILED: ${failed}/${total} tests`;
  const maxFailures = level === 'ultra' ? 2 : level === 'aggressive' ? 3 : 5;
  const shown = failures.slice(0, maxFailures).join('\n\n');
  const extra = failures.length > maxFailures ? `\n…+${failures.length - maxFailures} more` : '';

  return { output: `${header}\n\n${shown}${extra}`, strategy: 'cargo-test:failures' };
}

function filterGoTest(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');

  const failLines = lines.filter(l => l.startsWith('--- FAIL'));
  const passLines = lines.filter(l => l.startsWith('--- PASS') || l.startsWith('ok'));

  if (failLines.length === 0) {
    const passed = passLines.length || lines.filter(l => l.startsWith('ok')).length;
    if (level === 'ultra') return { output: `✓ ${passed} passed`, strategy: 'go-test:allpass:ultra' };
    return { output: `PASSED: ${passed} test(s)`, strategy: 'go-test:allpass' };
  }

  // Extract failure blocks
  const failures: string[] = [];
  let inFailure = false;
  let block: string[] = [];

  for (const line of lines) {
    if (line.startsWith('--- FAIL')) {
      if (block.length > 0) failures.push(block.join('\n'));
      block = [line];
      inFailure = true;
    } else if (inFailure) {
      if (line.startsWith('--- ') || line.startsWith('FAIL') || line.startsWith('ok')) {
        failures.push(block.join('\n'));
        block = [];
        inFailure = false;
      } else {
        block.push(line);
      }
    }
  }
  if (block.length > 0) failures.push(block.join('\n'));

  const header = `FAILED: ${failLines.length} test(s)`;
  const maxFailures = level === 'ultra' ? 2 : level === 'aggressive' ? 3 : 5;
  const shown = failures.slice(0, maxFailures).join('\n\n');
  const extra = failures.length > maxFailures ? `\n…+${failures.length - maxFailures} more` : '';

  return { output: `${header}\n\n${shown}${extra}`, strategy: 'go-test:failures' };
}

function filterRspec(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');
  const summaryMatch = raw.match(/(\d+)\s+examples?,\s+(\d+)\s+failures?/);

  if (!summaryMatch) return { output: raw, strategy: 'rspec:passthrough' };

  const total = parseInt(summaryMatch[1]);
  const failed = parseInt(summaryMatch[2]);

  if (failed === 0) {
    if (level === 'ultra') return { output: `✓ ${total}/${total}`, strategy: 'rspec:allpass:ultra' };
    return { output: `PASSED: ${total}/${total} examples`, strategy: 'rspec:allpass' };
  }

  // Extract failure messages
  const failures = lines.filter(l => l.includes('Failure/Error') || l.includes('expected') || l.includes('got:'));
  const header = `FAILED: ${failed}/${total} examples`;
  const maxLines = level === 'ultra' ? 5 : level === 'aggressive' ? 10 : 20;
  const shown = failures.slice(0, maxLines).join('\n');

  return { output: `${header}\n\n${shown}`, strategy: 'rspec:failures' };
}

function filterMinitest(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');
  const summaryMatch = raw.match(/(\d+)\s+runs?,\s+\d+\s+assertions?,\s+(\d+)\s+failures?/);

  if (!summaryMatch) return { output: raw, strategy: 'minitest:passthrough' };

  const total = parseInt(summaryMatch[1]);
  const failed = parseInt(summaryMatch[2]);

  if (failed === 0) {
    if (level === 'ultra') return { output: `✓ ${total}/${total}`, strategy: 'minitest:allpass:ultra' };
    return { output: `PASSED: ${total}/${total} tests`, strategy: 'minitest:allpass' };
  }

  const failures = lines.filter(l => l.includes('Failure:') || l.includes('Error:') || l.includes('Expected'));
  const header = `FAILED: ${failed}/${total} tests`;
  const maxLines = level === 'ultra' ? 5 : level === 'aggressive' ? 10 : 20;
  const shown = failures.slice(0, maxLines).join('\n');

  return { output: `${header}\n\n${shown}`, strategy: 'minitest:failures' };
}

function filterGenericTest(raw: string, level: CompressorOptions['level']): FilterResult {
  const lines = raw.split('\n');

  // Try to detect pass/fail from common patterns
  const failedMatch = raw.match(/(\d+)\s+(?:failed|failing|failure)/i);
  const passedMatch = raw.match(/(\d+)\s+(?:passed|passing|success)/i);

  if (failedMatch && parseInt(failedMatch[1]) === 0 && passedMatch) {
    return { output: `PASSED: ${passedMatch[1]} tests`, strategy: 'test:generic:allpass' };
  }

  // Keep only lines that look like failures or summaries
  const important = lines.filter(l =>
    /fail|error|assert|expect|panic/i.test(l) ||
    /\d+\s+(passed|failed|tests)/i.test(l) ||
    l.startsWith('FAIL') || l.startsWith('ERROR')
  );

  if (important.length > 0 && important.length < lines.length * 0.5) {
    const maxLines = level === 'ultra' ? 10 : level === 'aggressive' ? 20 : 30;
    return { output: important.slice(0, maxLines).join('\n'), strategy: 'test:generic:filtered' };
  }

  return { output: raw, strategy: 'test:generic:passthrough' };
}
