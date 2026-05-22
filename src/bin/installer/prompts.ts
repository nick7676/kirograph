/**
 * KiroGraph Installer — interactive prompt helpers
 */

import * as readline from 'readline';

// ── ANSI ──────────────────────────────────────────────────────────────────────

export const violet = '\x1b[38;5;99m';
export const reset  = '\x1b[0m';
export const dim    = '\x1b[2m';
const bold          = '\x1b[1m';
const green         = '\x1b[32m';
const yellow        = '\x1b[33m';
const cyan          = '\x1b[36m';

// ── Primitives ────────────────────────────────────────────────────────────────

export function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Prompt a yes/no question, re-prompting on invalid input.
 * Accepts: "" (use default), "y", "Y", "n", "N".
 */
export async function askBool(
  rl: readline.Interface,
  question: string,
  description: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  console.log(`\n  ${dim}${description}${reset}`);
  while (true) {
    const raw = await ask(rl, `  ${violet}${question}${reset} ${dim}(${hint})${reset} `);
    if (raw === '') return defaultYes;
    if (raw === 'y' || raw === 'Y') return true;
    if (raw === 'n' || raw === 'N') return false;
    console.log(`  Please enter y or n.`);
  }
}

/**
 * Interactive enable/disable toggle using arrow keys.
 * More visual alternative to askBool.
 */
export async function askToggle(
  rl: readline.Interface,
  label: string,
  description: string,
  defaultEnabled = true,
): Promise<boolean> {
  return arrowSelect<boolean>(rl, label, [
    { value: true,  label: 'yes',  description },
    { value: false, label: 'no', description: 'Skip' },
  ], defaultEnabled ? 0 : 1);
}

/**
 * Prompt for a string value, returning the default on empty input.
 */
export async function askString(
  rl: readline.Interface,
  question: string,
  description: string,
  defaultValue: string,
): Promise<string> {
  console.log(`\n  ${dim}${description}${reset}`);
  const raw = await ask(rl, `  ${violet}${question}${reset} ${dim}(${defaultValue})${reset} `);
  return raw === '' ? defaultValue : raw;
}

/**
 * Print a styled section header with an icon.
 */
export function printSection(icon: string, title: string): void {
  console.log(`\n  ${violet}${bold}${icon}  ${title}${reset}`);
  console.log(`  ${violet}${'─'.repeat(title.length + 4)}${reset}`);
}

/**
 * Print a separator line.
 */
export function printSeparator(): void {
  console.log(`\n  ${dim}${'·'.repeat(50)}${reset}`);
}

/**
 * Print a feature summary line.
 */
export function printFeature(enabled: boolean, label: string): void {
  const icon = enabled ? `${green}✓${reset}` : `${dim}✗${reset}`;
  const text = enabled ? label : `${dim}${label}${reset}`;
  console.log(`    ${icon} ${text}`);
}

/**
 * Interactive arrow-key selection menu.
 * Temporarily pauses the readline interface to take over raw stdin,
 * then resumes it when done so subsequent prompts work normally.
 */
export async function arrowSelect<T>(
  rl: readline.Interface,
  label: string,
  options: Array<{ value: T; label: string; description: string }>,
  defaultIndex = 0,
): Promise<T> {
  const CURSOR_UP   = '\x1b[A';
  const CURSOR_DOWN = '\x1b[B';
  const CLEAR_LINE  = '\x1b[2K\x1b[G';

  function descLineCount(desc: string): number {
    const termWidth = process.stdout.columns || 80;
    return Math.max(1, Math.ceil((desc.length + 4) / termWidth));
  }

  let selected = defaultIndex;
  let prevDescLines = descLineCount(options[defaultIndex]!.description);

  function render(first: boolean) {
    if (!first) {
      process.stdout.write(`\x1b[${options.length + prevDescLines}A`);
    }
    for (let i = 0; i < options.length; i++) {
      const active = i === selected;
      const cursor = active ? `${green}${bold}❯${reset}` : ' ';
      const text   = active ? `${bold}${options[i]!.label}${reset}` : `${dim}${options[i]!.label}${reset}`;
      process.stdout.write(`${CLEAR_LINE}  ${cursor} ${text}\n`);
    }
    const desc = options[selected]!.description;
    process.stdout.write(`${CLEAR_LINE}  ${dim}${desc}${reset}\n`);
    prevDescLines = descLineCount(desc);
  }

  return new Promise(resolve => {
    console.log(`\n  ${violet}${label}${reset}`);
    render(true);

    rl.pause();
    const stdin = process.stdin;
    const wasTTY = stdin.isTTY;
    if (wasTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function onData(key: string) {
      if (key === CURSOR_UP || key === '\x1b[A') {
        selected = (selected - 1 + options.length) % options.length;
        render(false);
      } else if (key === CURSOR_DOWN || key === '\x1b[B') {
        selected = (selected + 1) % options.length;
        render(false);
      } else if (key === '\r' || key === '\n' || key === ' ') {
        stdin.removeListener('data', onData);
        if (wasTTY) stdin.setRawMode(false);
        stdin.pause();
        rl.resume();
        // Clear all rendered lines (options + desc + label + blank line before label)
        const totalLines = options.length + prevDescLines + 2;
        process.stdout.write(`\x1b[${options.length + prevDescLines}A`); // go up to first option
        process.stdout.write(`\x1b[1A`); // go up past label
        process.stdout.write(`\x1b[1A`); // go up past blank line
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write(`${CLEAR_LINE}\n`);
        }
        process.stdout.write(`\x1b[${totalLines}A`);
        process.stdout.write(`${CLEAR_LINE}  ${green}${bold}✓${reset} ${label} ${green}${bold}${options[selected]!.label}${reset}\n`);
        resolve(options[selected]!.value);
      } else if (key === '\x03') {
        stdin.removeListener('data', onData);
        if (wasTTY) stdin.setRawMode(false);
        process.exit(1);
      }
    }

    stdin.on('data', onData);
  });
}
