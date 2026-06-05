# Security Module

KiroGraph-Sec extends the semantic knowledge graph with dependency vulnerability detection and reachability-aware impact analysis. Unlike traditional SCA tools that only report "vulnerable dependency present," KiroGraph-Sec leverages the existing call graph and architecture layers to determine whether vulnerable code paths are actually reachable from your application's entry points.

## Configuration

Enable the security module in `.kirograph/config.json`:

```json
{
  "enableSecurity": true,
  "securityDatabases": ["OSV"],
  "securityAutoEnrich": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enableSecurity` | boolean | `false` | Enable dependency scanning and vulnerability detection |
| `securityDatabases` | string[] | `["OSV"]` | Vulnerability databases to query |
| `securityAutoEnrich` | boolean | `true` | Auto-run vulnerability enrichment after manifest parsing |

**Dependency:** `enableSecurity` requires `enableArchitecture: true`. If architecture is disabled, the config validator auto-enables it with a warning.

## How It Works

The security pipeline runs **after architecture analysis** during indexing:

```
code extraction → reference resolution → architecture analysis → security analysis
```

### Pipeline Phases

1. **Manifest discovery** — Finds all supported manifest files in the project tree (respects .gitignore and SKIP_DIRS)
2. **Dependency parsing** — Extracts package names, version constraints, and scopes from each manifest
3. **Dependency graph integration** — Links dependencies to code symbols via import/reference edges, resolves transitives up to 10 levels
4. **Vulnerability enrichment** — Queries configured databases (OSV) for known CVEs affecting project dependencies
5. **Reachability analysis** — Traverses the call graph from entry points to determine if vulnerable code is actually reachable
6. **Impact analysis** — Identifies affected architectural layers, entry points, and distinct code paths

### Graph Model

Two new node kinds are added to the knowledge graph:

- **`dependency`** — Represents a third-party package declared in a manifest
- **`vulnerability`** — Represents a CVE record linked to an affected dependency

Three new edge kinds:

- **`has_vulnerability`** — Links a dependency to a vulnerability
- **`depends_on`** — Links dependencies to their transitive dependencies
- **`declared_in`** — Links a dependency to its declaring manifest file

## CLI Commands

### `kirograph security`

Show security overview: total dependencies, vulnerabilities found, verdict breakdown, stale data warnings.

```bash
kirograph security [path]
kirograph security --refresh-staleness   # Re-query registries for latest versions first
```

### `kirograph sbom`

Export CycloneDX 1.5 SBOM to stdout or file.

```bash
kirograph sbom [path]
kirograph sbom --output sbom.json
```

### `kirograph vex`

Export CycloneDX 1.5 VEX with reachability verdicts.

```bash
kirograph vex [path]
kirograph vex --output vex.json
```

### `kirograph vulns`

List vulnerabilities with filtering and management options.

```bash
kirograph vulns [path]
kirograph vulns --severity critical
kirograph vulns --verdict affected
kirograph vulns --refresh
kirograph vulns --add CVE-2024-1234 --package lodash --version 4.17.20
```

| Flag | Description |
|------|-------------|
| `--severity <level>` | Filter by severity: `critical`, `high`, `medium`, `low` |
| `--verdict <verdict>` | Filter by verdict: `affected`, `not_affected`, `under_investigation` |
| `--epss <threshold>` | Filter by EPSS exploitation probability (0.0–1.0, e.g. `--epss 0.5`) |
| `--stale` | Show staleness score of the affected dependency alongside each CVE |
| `--sort <key>` | Sort results by: `risk` (default), `cvss`, `epss`, `name` |
| `--group-by workspace` | Group output by source manifest directory (monorepo support) |
| `--fail-on <condition>` | Exit 1 if condition met: `affected`, `any`, `critical`, `high`, `epss=N` |
| `--refresh` | Trigger fresh enrichment from configured databases before listing |
| `--add <cveId>` | Manually register a CVE (requires `--package` and `--version`) |
| `--package <name>` | Package name for manual CVE registration |
| `--version <ver>` | Package version for manual CVE registration |

### `kirograph reachability`

Analyze reachability for a specific CVE or dependency package.

```bash
kirograph reachability <target> [path]
kirograph reachability CVE-2023-12345
kirograph reachability lodash
```

Accepts either a CVE ID or a package name. Shows: verdict, reaching entry point count, call paths (up to 5), unresolved symbols if any, and full impact summary (affected layers, entry points, distinct paths) when verdict is `affected`.

### `kirograph security export`

Generate a self-contained HTML security dashboard with 10 tabs: Overview, Vulnerabilities, SBOM, VEX, Licenses, Staleness, Attack Surface, Secrets, Flows, and Remediation.

```bash
kirograph security export [path]
kirograph security export --output security-report.html
kirograph security export --open           # open in browser immediately
```

| Flag | Description |
|------|-------------|
| `--output <file>` | Write dashboard to file (default: stdout) |
| `--open` | Open in default browser immediately after generation |

### `kirograph attack-surface`

Maps all HTTP routes to reachable vulnerable dependencies.

```bash
kirograph attack-surface [path]
kirograph attack-surface --public-only
kirograph attack-surface --limit 10
kirograph attack-surface --format json
```

Shows: route name, exposure level (public/authenticated/internal), hop count to vulnerable dependency, risk score.

### `kirograph security secrets`

Scans for 14 secret types (AWS keys, GitHub tokens, DB URLs, JWT, etc.) enriched with call-graph blast radius — shows which entry points reach the secret.

```bash
kirograph security secrets [path]
kirograph security secrets --include-tests
kirograph security secrets --severity critical
kirograph security secrets --format json
```

### `kirograph security flows`

SAST-lite: detects SQL injection, dangerous eval/exec, unsafe deserialization, path traversal, weak crypto. Each finding is tagged with OWASP Top 10 (2021) category.

```bash
kirograph security flows [path]
kirograph security flows --type sql
kirograph security flows --format json
```

### `kirograph security ci-report`

Generates structured CI/CD report: JSON, SARIF 2.1.0 (uploadable to GitHub Security tab), or compact text.

```bash
kirograph security ci-report [path]
kirograph security ci-report --format sarif --output results.sarif
kirograph security ci-report --fail-on critical
```

### `kirograph supply-chain`

Supply chain health: OpenSSF Scorecard scores, maintainer count, abandoned package detection (>365 days inactive), new package risk (<30 days old).

```bash
kirograph supply-chain [path]
kirograph supply-chain --threshold high
kirograph supply-chain --refresh
kirograph supply-chain --format json
```

### `kirograph dep-confusion`

Detects dependency confusion: internal packages whose names exist in public registries (supply chain attack vector). Also detects typosquatting (Levenshtein distance ≤ 2 from popular packages).

```bash
kirograph dep-confusion [path]
kirograph dep-confusion --format json
```

### `kirograph remediation`

SLA tracking per CVE. Thresholds: critical=7 days, high=30 days, medium=90 days. Shows days open, days with fix available, SLA status (ok/warning/overdue).

```bash
kirograph remediation [path]
kirograph remediation --overdue-only
kirograph remediation --format json
```

### `kirograph licenses`

List dependency licenses and check against configured policy.

```bash
kirograph licenses [path]
kirograph licenses --policy                          # Show only violations
kirograph licenses --deny "GPL-*,AGPL-3.0"          # Override deny list
kirograph licenses --warn "LGPL-*"                  # Override warn list
kirograph licenses --format json
```

### `kirograph staleness`

Check dependency freshness against registries (npm, PyPI, crates.io, RubyGems, Packagist).

```bash
kirograph staleness [path]
kirograph staleness --threshold 0.5    # Only show score >= 0.5
kirograph staleness --refresh          # Re-query registries first
kirograph staleness --format json
```

Staleness score 0.0–1.0: accounts for major versions behind (up to 0.6) and months since latest release (up to 0.4).

### CVE Suppression

Mark false positives or accepted risks to exclude them from all output.

```bash
kirograph vuln suppress CVE-2024-1234 --reason "not in code path"
kirograph vuln suppress CVE-2024-1234 --expires 2026-12-31
kirograph vuln unsuppress CVE-2024-1234
kirograph vuln suppressions
kirograph vuln suppressions --format json
```

Suppressions are stored in `.kirograph/security-suppressions.json`. Expired suppressions are auto-pruned on each run.

### Risk Score

Each vulnerability receives a combined risk score on a 0–10 scale:

```
risk_score = reachability_factor × (0.4 × CVSS + 0.6 × EPSS) × staleness_bonus
```

- **reachability_factor**: 1.0 if `affected`, 0.5 if `under_investigation`, 0.1 if `not_affected`
- **CVSS**: normalized CVSS v3.1 base score (0–10)
- **EPSS**: exploitation probability weight (0.0–1.0)
- **staleness_bonus**: up to 1.2× multiplier for stale dependencies

The score is shown as a badge `[Risk: 8.5]` in `kirograph vulns` output and used as the default sort order (`--sort risk`).

## Pattern-based SAST *(requires `enablePatterns: true` and `@ast-grep/napi`)*

When `enablePatterns: true` is set and `@ast-grep/napi` is installed, KiroGraph runs AST structural pattern rules during indexing. Unlike the heuristic SAST (which matches symbol names), AST patterns match the actual code structure — finding SQL injection in helper functions, not just handlers named "controller".

**The existing SQL heuristic SAST always runs.** AST findings are merged on top (additive, deduplicating by file+line with AST entries preferred).

### `kirograph pattern`

```bash
kirograph pattern 'eval($X)'                    # live structural search
kirograph pattern 'eval($X)' --lang typescript  # filter by language
kirograph pattern --list                         # show all bundled rules
kirograph pattern --library sql-injection-concat-js  # run a specific rule
kirograph pattern --format json                  # JSON output
```

Exit codes: `0` = no findings, `1` = findings (CI security gate), `2` = dependency missing.

### Bundled SAST rules

| ID | Severity | OWASP | Description |
|----|----------|-------|-------------|
| `sql-injection-concat-js` | critical | A03 | SQL query by string concatenation (JS/TS) |
| `sql-injection-template-js` | critical | A03 | SQL query by template literal (JS/TS) |
| `sql-injection-py` | critical | A03 | SQL query by string formatting (Python) |
| `dangerous-eval-js` | critical | A03 | `eval()` with non-literal argument (JS/TS) |
| `dangerous-exec-py` | critical | A03 | `os.system()` / `subprocess` with `shell=True` (Python) |
| `path-traversal-readfile-js` | high | A01 | `fs.readFile` with request param path (JS/TS) |
| `path-traversal-py` | high | A01 | `open()` with request param path (Python) |
| `prototype-pollution-js` | high | A08 | `__proto__` assignment (JS/TS) |
| `weak-crypto-md5-js` | medium | A02 | `createHash('md5'/'sha1')` (JS/TS) |
| `weak-crypto-py` | medium | A02 | `hashlib.md5/sha1()` (Python) |

Custom rules can be added via `patternLibraryPath` in `.kirograph/config.json`.

## MCP Tools

All security tools require `enableSecurity: true` and `enableArchitecture: true`.

### `kirograph_security`

Security overview: vulnerability counts, verdict breakdown, stale data warnings.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_vulns`

List vulnerabilities with filtering by severity and reachability verdict.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `severity` | string | - | Filter: `critical`, `high`, `medium`, `low` |
| `verdict` | string | - | Filter: `affected`, `not_affected`, `under_investigation` |
| `refresh` | boolean | false | Trigger fresh enrichment before listing |
| `projectPath` | string | cwd | Project root path |

### `kirograph_sbom`

Generate CycloneDX 1.5 SBOM JSON for the project.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_vex`

Generate CycloneDX 1.5 VEX JSON with reachability-derived analysis states.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_reachability`

Analyze reachability for a specific CVE or dependency — verdict, paths from entry points, and impact summary.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | string | required | CVE identifier (e.g. `CVE-2024-1234`) or package name (e.g. `lodash`) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_vuln_add`

Manually register a CVE against a dependency. Useful for private/internal advisories not in public databases.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cveId` | string | required | CVE identifier (e.g. `CVE-2024-9999`) |
| `package` | string | required | Package name (must match an indexed dependency) |
| `severity` | number | - | CVSS v3.1 base score (0.0–10.0) |
| `summary` | string | - | Human-readable description (truncated to 500 chars) |
| `fixedVersion` | string | - | Version that fixes the vulnerability |
| `projectPath` | string | cwd | Project root path |

### `kirograph_vuln_suppress`

Suppress a CVE (mark as false positive or accepted risk). Suppressed CVEs are excluded from all output until the expiry date or until unsuppressed.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cveId` | string | required | CVE identifier to suppress (e.g. `CVE-2024-1234`) |
| `reason` | string | - | Human-readable reason for suppression |
| `expires` | string | - | ISO 8601 expiry date (e.g. `2026-12-31`); suppression is auto-pruned after this date |
| `projectPath` | string | cwd | Project root path |

### `kirograph_attack_surface`

Map HTTP routes to reachable vulnerable dependencies with exposure levels and risk scores.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | - | Max routes to return |
| `publicOnly` | boolean | false | Return only public-facing routes |
| `projectPath` | string | cwd | Project root path |

### `kirograph_secrets`

Scan for secrets (AWS keys, GitHub tokens, DB URLs, JWT, etc.) with call-graph blast radius showing which entry points reach each secret.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `includeTests` | boolean | false | Include test files in the scan |
| `severity` | string | - | Filter by severity: `critical`, `high`, `medium`, `low` |
| `projectPath` | string | cwd | Project root path |

### `kirograph_security_flows`

SAST-lite: detect SQL injection, dangerous eval/exec, unsafe deserialization, path traversal, and weak crypto. Results tagged with OWASP Top 10 (2021) category.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | - | Filter flow type: `sql`, `eval`, `deserialization`, `path-traversal`, `crypto` |
| `projectPath` | string | cwd | Project root path |

### `kirograph_supply_chain`

Supply chain health: OpenSSF Scorecard scores, maintainer count, abandoned package detection, new package risk.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | string | - | Minimum risk threshold to include: `low`, `medium`, `high`, `critical` |
| `refresh` | boolean | false | Re-query external sources before returning results |
| `projectPath` | string | cwd | Project root path |

### `kirograph_dep_confusion`

Detect dependency confusion attacks: internal packages whose names exist in public registries, and typosquatting (Levenshtein distance ≤ 2 from popular packages).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectPath` | string | cwd | Project root path |

### `kirograph_remediation`

SLA tracking per CVE: critical=7 days, high=30 days, medium=90 days. Shows days open, days with fix available, SLA status.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `overdueOnly` | boolean | false | Return only CVEs that have breached their SLA threshold |
| `projectPath` | string | cwd | Project root path |

### `kirograph_licenses`

List dependency licenses and check against the configured `securityLicensePolicy`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `policy` | boolean | false | Return only policy violations (deny/warn) |
| `projectPath` | string | cwd | Project root path |

### `kirograph_staleness`

Check dependency freshness. Queries npm, PyPI, crates.io, RubyGems, and Packagist for latest versions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | 0.3 | Minimum staleness score to include (0.0–1.0) |
| `refresh` | boolean | false | Re-query registries before returning results |
| `projectPath` | string | cwd | Project root path |

## CycloneDX Output Format

### SBOM

The SBOM exporter produces CycloneDX 1.5 JSON with:

- **Metadata**: tool name, version, ISO 8601 UTC timestamp, project identifier
- **Components**: each dependency as a `library` component with:
  - Package name and version (or declared constraint)
  - Package URL (purl): `pkg:<ecosystem>/<name>@<version>`
  - Scope: `required` (direct) or `optional` (transitive)
- **Dependencies**: relationships reflecting `depends_on` edges in the graph

Example purl formats:
- `pkg:npm/express@4.18.2`
- `pkg:maven/org.apache.logging.log4j/log4j-core@2.17.0`
- `pkg:golang/github.com/gin-gonic/gin@1.9.1`
- `pkg:pypi/django@4.2.0`
- `pkg:cargo/serde@1.0.188`

### VEX

The VEX exporter produces CycloneDX 1.5 VEX JSON with one entry per vulnerability:

| Reachability Verdict | VEX Analysis State | Justification | Detail |
|---------------------|-------------------|---------------|--------|
| `affected` | `affected` | — | Entry points, layers traversed, path length |
| `not_affected` | `not_affected` | `code_not_reachable` | No reachable path from any entry point |
| `under_investigation` | `under_investigation` | — | Unresolved symbols or pending analysis |

## Reachability Verdicts

KiroGraph-Sec classifies each vulnerability using BFS traversal from application entry points:

### `affected`

At least one path exists from an entry point to the vulnerable dependency through call, import, or reference edges. The shortest path from each reaching entry point is recorded.

### `not_affected`

No path exists from any entry point to the vulnerable dependency, and no unresolved imports were encountered during traversal. This is the strongest signal that the vulnerability is not exploitable in your deployment.

### `under_investigation`

The traversal encountered at least one unresolved import or symbol whose outgoing edges could not be determined. The vulnerability *might* be reachable through the unresolved path. Up to 50 unresolved symbol identifiers are listed.

## Supported Ecosystems

| Ecosystem | Manifest | Lock File | OSV Ecosystem | Purl Prefix |
|-----------|----------|-----------|---------------|-------------|
| npm | `package.json` | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | `npm` | `pkg:npm/` |
| Maven | `pom.xml` | — | `Maven` | `pkg:maven/` |
| Gradle | `build.gradle`, `build.gradle.kts` | `gradle.lockfile` | `Maven` | `pkg:maven/` |
| Go | `go.mod` | `go.sum` | `Go` | `pkg:golang/` |
| pip | `requirements.txt` | — | `PyPI` | `pkg:pypi/` |
| Python (modern) | `pyproject.toml` | `poetry.lock`, `pdm.lock`, `uv.lock` | `PyPI` | `pkg:pypi/` |
| Cargo | `Cargo.toml` | `Cargo.lock` | `crates.io` | `pkg:cargo/` |
| NuGet | `*.csproj`, `packages.config` | `packages.lock.json` | `NuGet` | `pkg:nuget/` |
| RubyGems | `Gemfile` | `Gemfile.lock` | `RubyGems` | `pkg:gem/` |
| Composer | `composer.json` | `composer.lock` | `Packagist` | `pkg:composer/` |
| Swift PM | `Package.swift` | `Package.resolved` | `SwiftURL` | `pkg:swift/` |
| Dart/Flutter | `pubspec.yaml` | `pubspec.lock` | `Pub` | `pkg:pub/` |
| Elixir/Hex | `mix.exs` | `mix.lock` | `Hex` | `pkg:hex/` |

### Scope Mapping

| Ecosystem | Production | Development | Optional |
|-----------|-----------|-------------|----------|
| npm | `dependencies` | `devDependencies` | `optionalDependencies` |
| Maven | `compile`, `runtime` | `test` | `provided`, `system` |
| Gradle | `implementation`, `api`, etc. | `testImplementation`, `testApi` | — |
| Go | `require` | — | — |
| pip | default | — | — |
| Python (pyproject) | `[project]`, `[tool.poetry.dependencies]` | `[project.optional-dependencies]`, Poetry groups | `require-dev`/dev groups |
| Cargo | `[dependencies]` | `[dev-dependencies]`, `[build-dependencies]` | — |
| NuGet | default | `PrivateAssets="all"` | — |
| RubyGems | default | `group :development`, `group :test` | — |
| Composer | `require` | `require-dev` | — |
| Swift PM | all (no dev-dep concept) | — | — |
| Dart/Flutter | `dependencies` | `dev_dependencies` | — |
| Elixir/Hex | default | `only: :dev`, `only: :test` | — |

## Limitations

- **Reachability is conservative**: If the call graph has unresolved symbols (dynamic dispatch, reflection, eval), the verdict defaults to `under_investigation` rather than `not_affected`.
- **Transitive depth**: Transitive dependencies are resolved up to 10 levels. Deeper chains are marked `incomplete`.
- **Lock file dependency**: Resolved versions require a lock file. Without one, the declared constraint is used and transitive resolution is incomplete.
- **OSV coverage**: The OSV database is comprehensive but may not cover all ecosystems equally. Private/internal vulnerabilities must be registered manually via `kirograph vulns --add` or `kirograph_vuln_add`.
- **Performance**: Reachability analysis completes within 5 seconds for projects with up to 50,000 graph nodes. Larger projects may experience longer analysis times.
- **Vulnerability database timeout**: Each dependency query has a 30-second timeout. Unreachable databases result in stale data (clearly marked).
- **Architecture dependency**: The security module requires `enableArchitecture: true`. Without it, layer classification is omitted from impact summaries but reachability analysis still works using call graph edges.
- **OWASP mapping**: OWASP Top 10 category tagging in `kirograph security flows` is heuristic-based on CVE text analysis; categories may not be accurate for all findings.
- **Secrets scanner false positives**: The secrets scanner may produce false positives for generic patterns (e.g. placeholder strings that match key formats). Review findings before acting on them.
- **SAST flows are structural**: Security flow detection (`kirograph security flows`) uses structural call-graph analysis, not data taint tracking. Results indicate potential risk but do not confirm exploitability.
