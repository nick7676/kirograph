/**
 * KiroGraph CLI Banner
 * Displays the KIROGRAPH ASCII art header and a rotating "Did you know?" tip.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const figlet = require('figlet');

// ANSI color helpers (no external deps)
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  purple: '\x1b[38;5;135m',
  violet: '\x1b[38;5;99m',
  cyan:   '\x1b[38;5;117m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

const TIPS = [
  // Core graph
  `Run ${c.cyan}kirograph context "your task"${c.reset} to get relevant code\n  in one shot — no file scanning needed.`,
  `Use ${c.cyan}kirograph query <name>${c.reset} instead of grep.\n  It searches the symbol index instantly.`,
  `${c.cyan}kirograph affected src/foo.ts${c.reset} finds every test file\n  that depends on a changed file — great for CI.`,
  `${c.cyan}kirograph files --format grouped${c.reset} shows your project\n  structure grouped by language from the index.`,
  `${c.cyan}kirograph path LoginController DatabasePool${c.reset}\n  finds the shortest connection between any two symbols.`,
  `${c.cyan}kirograph hotspots${c.reset} ranks symbols by edge degree —\n  the top results are the riskiest to change.`,
  `${c.cyan}kirograph surprising${c.reset} surfaces hidden cross-module coupling\n  you didn't know existed.`,
  `${c.cyan}kirograph dead-code${c.reset} lists unexported symbols with zero\n  incoming references — safe candidates for deletion.`,
  `${c.cyan}kirograph snapshot save pre-refactor${c.reset} then\n  ${c.cyan}kirograph snapshot diff pre-refactor${c.reset} after — structural changelog.`,
  `Pipe git diff into kirograph:\n  ${c.cyan}git diff --name-only | kirograph affected --stdin${c.reset}`,
  // Indexing
  `${c.cyan}kirograph sync${c.reset} is incremental — it only re-parses\n  files whose content has changed since last index.`,
  `${c.cyan}kirograph sync-if-dirty${c.reset} is safe to call on every agent stop —\n  it's a no-op when nothing changed.`,
  `Run ${c.cyan}kirograph install${c.reset} once per workspace to wire up\n  MCP, auto-sync hooks, and steering automatically.`,
  // Architecture
  `${c.cyan}kirograph coupling --sort instability${c.reset} shows which packages\n  are most volatile and risky to depend on.`,
  `${c.cyan}kirograph architecture${c.reset} detects packages and layers (api/service/\n  data/ui/shared) without any config — just enable it.`,
  `${c.cyan}kirograph package src/auth${c.reset} shows incoming dependents,\n  outgoing deps, and files in one call.`,
  // Security
  `${c.cyan}kirograph security${c.reset} gives an instant vulnerability overview —\n  dep count, CVEs, verdict breakdown, stale warnings.`,
  `${c.cyan}kirograph vulns --verdict affected${c.reset} filters to only CVEs\n  with a confirmed reachable call path from your entry points.`,
  `${c.cyan}kirograph vulns --epss 0.5${c.reset} shows only vulnerabilities\n  with >= 50% exploitation probability — EPSS beats CVSS for triage.`,
  `${c.cyan}kirograph reachability CVE-2024-1234${c.reset} shows the exact\n  call path from your entry points to the vulnerable dependency.`,
  `${c.cyan}kirograph licenses --policy${c.reset} flags dependencies that violate\n  your configured SPDX license policy (deny/warn lists).`,
  `${c.cyan}kirograph staleness --threshold 0.7${c.reset} identifies dependencies\n  that are significantly behind their latest published version.`,
  `${c.cyan}kirograph sbom --output sbom.json${c.reset} exports a CycloneDX 1.5\n  SBOM — parent directory is created automatically if missing.`,
  `${c.cyan}kirograph vex --output vex.json${c.reset} exports a VEX document\n  with reachability-derived analysis states for each CVE.`,
  // Memory
  `${c.cyan}kirograph mem search "auth decision"${c.reset} recalls past observations\n  using hybrid FTS + vector search across all sessions.`,
  `${c.cyan}kirograph mem store "..." --kind decision${c.reset} saves an observation\n  linked to relevant code symbols automatically.`,
  `${c.cyan}kirograph mem timeline${c.reset} shows recent sessions and what\n  the agent observed — great for onboarding after a break.`,
  // Docs & Data
  `${c.cyan}kirograph docs search "authentication"${c.reset} searches indexed\n  documentation sections — faster than reading full files.`,
  `${c.cyan}kirograph data describe orders${c.reset} gives full schema profile\n  without loading a single data row into context.`,
  `${c.cyan}kirograph data aggregate orders --group-by region --metric sum:amount${c.reset}\n  runs GROUP BY server-side — only results enter context.`,
  // Export & token tools
  `${c.cyan}kirograph export start${c.reset} opens an interactive graph dashboard\n  in your browser — search, path-find, cluster, heat map.`,
  `${c.cyan}kirograph exec "npm test"${c.reset} compresses test output by 80-90% —\n  you get pass/fail and errors, not thousands of lines of noise.`,
  `${c.cyan}kirograph gain --graph${c.reset} shows your cumulative token savings\n  from graph tools and shell compression over time.`,
  // Workflow files
  `Type ${c.cyan}/kirograph-security${c.reset} in Kiro to activate a step-by-step\n  security audit workflow with CVE triage and EPSS guidance.`,
  `Type ${c.cyan}/kirograph-review${c.reset} in Kiro for a structured code review:\n  blast radius, test coverage, surprising coupling.`,
  `Type ${c.cyan}/kirograph-refactor${c.reset} in Kiro before any major refactor —\n  it guides you through blast radius, rename preview, and diff verify.`,
  `Type ${c.cyan}/kirograph-debug${c.reset} in Kiro to trace a bug systematically:\n  callers, callees, recent diff, root cause analysis.`,
  `Type ${c.cyan}/kirograph-architecture${c.reset} in Kiro for a full architecture\n  exploration: packages, layers, coupling, hidden cycles.`,
];

function pickTip(): string {
  // Rotate daily so it feels fresh but is deterministic
  const idx = Math.floor(Date.now() / 86_400_000) % TIPS.length;
  return TIPS[idx];
}

function boxed(text: string, width = 70): string {
  const lines = text.split('\n');
  const top    = `${c.gray}┌${'─'.repeat(width - 2)}┐${c.reset}`;
  const bottom = `${c.gray}└${'─'.repeat(width - 2)}┘${c.reset}`;
  const padded = lines.map(l => {
    // Strip ANSI for length calculation
    const plain = l.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - 4 - plain.length);
    return `${c.gray}│${c.reset}  ${l}${' '.repeat(pad)}  ${c.gray}│${c.reset}`;
  });
  return [top, ...padded, bottom].join('\n');
}

export function printBanner(): void {
  // ASCII art title
  const art: string = figlet.textSync('KIROGRAPH', { font: 'ANSI Shadow' });

  // Colorize each line of the art in purple/violet gradient
  const artLines = art.split('\n');
  const colored = artLines.map((line, i) => {
    const color = i < artLines.length / 2 ? c.purple : c.violet;
    return `${color}${line}${c.reset}`;
  }).join('\n');

  console.log('\n' + colored);

  // Subtitle
  console.log(`${c.dim}  Semantic code knowledge graph for Kiro — 100% local${c.reset}`);
  console.log(`${c.dim}  Inspired by CodeGraph — original idea by ${c.reset}${c.violet}github.com/colbymchenry${c.reset}\n`);

  // Did you know box
  const label = `${c.gray}─────────────────────── ${c.reset}${c.bold}${c.white}Did you know?${c.reset}${c.gray} ───────────────────────${c.reset}`;
  console.log(label);
  console.log(boxed(pickTip()));
  console.log();
}
