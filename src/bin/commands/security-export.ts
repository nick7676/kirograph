import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { loadConfig } from '../../config';
import { dim, reset, violet, bold, green } from '../ui';
import { checkLicensePolicy } from '../../security/license';

function openBrowser(filePath: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open';
  spawn(cmd, [filePath], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface VulnRow {
  cve_id: string;
  severity_score: number | null;
  epss_score: number | null;
  epss_percentile: number | null;
  fixed_version: string | null;
  summary: string | null;
  affected_ranges: string | null;
  package_name: string | null;
  ecosystem: string | null;
  resolved_version: string | null;
  declared_constraint: string | null;
  scope: string | null;
  license: string | null;
  verdict: string | null;
  paths: string | null;
  unresolved_symbols: string | null;
  reaching_entry_point_count: number | null;
}

interface DepRow {
  node_id: string;
  package_name: string;
  ecosystem: string;
  resolved_version: string | null;
  declared_constraint: string;
  scope: string;
  /** 'direct' | 'transitive' — derived from declared_in edges, not the scope column */
  classification: string;
  license: string | null;
  latest_version: string | null;
  latest_published: number | null;
  staleness_score: number | null;
}

// ── HTML generation ───────────────────────────────────────────────────────────

function generateHtml(params: {
  projectName: string;
  generatedAt: string;
  vulns: VulnRow[];
  deps: DepRow[];
  sbomJson: string;
  vexJson: string;
  denyList: string[];
  warnList: string[];
}): string {
  const { projectName, generatedAt, vulns, deps, sbomJson, vexJson, denyList, warnList } = params;

  // Compute license violations for the HTML
  const licDeps = deps.map(d => ({ package_name: d.package_name, ecosystem: d.ecosystem, license: d.license }));
  const violations = checkLicensePolicy(licDeps, { deny: denyList, warn: warnList });
  const violationMap: Record<string, 'deny' | 'warn'> = {};
  for (const v of violations) {
    violationMap[`${v.ecosystem}:${v.packageName}`] = v.severity;
  }
  const licenseData = deps.map(d => ({
    package_name: d.package_name,
    ecosystem: d.ecosystem,
    license: d.license ?? null,
    status: violationMap[`${d.ecosystem}:${d.package_name}`] ?? (d.license ? 'ok' : 'unknown'),
  }));

  // Stats
  const totalDeps = deps.length;
  const totalVulns = vulns.length;
  const affected = vulns.filter(v => v.verdict === 'affected').length;
  const underInvestigation = vulns.filter(v => v.verdict === 'under_investigation').length;
  const notAffected = vulns.filter(v => v.verdict === 'not_affected').length;
  const staleDeps = deps.filter(d => (d.staleness_score ?? 0) >= 0.3).length;

  // Top 5 by EPSS × CVSS
  const top5 = [...vulns]
    .filter(v => v.epss_score != null || v.severity_score != null)
    .sort((a, b) => {
      const scoreA = (a.epss_score ?? 0) * (a.severity_score ?? 0);
      const scoreB = (b.epss_score ?? 0) * (b.severity_score ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, 5);

  const directCount = deps.filter(d => d.classification === 'direct').length;
  const transitiveCount = deps.filter(d => d.classification !== 'direct').length;
  const stalenessRows = deps.filter(d => d.staleness_score != null).sort((a, b) => (b.staleness_score ?? 0) - (a.staleness_score ?? 0));

  // Embed JSON data safely
  const safeJson = (obj: unknown) => JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Security Dashboard — ${projectName}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0d1117;
  --bg-card: #161b22;
  --bg-input: #21262d;
  --border: #30363d;
  --accent: #a78bfa;
  --text: #c9d1d9;
  --text-muted: #8b949e;
  --text-bright: #f0f6fc;
  --green: #3fb950;
  --yellow: #d29922;
  --red: #f85149;
  --orange: #db6d28;
  --radius: 8px;
}
html { scroll-behavior: smooth; }
body {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Header */
.header {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 1rem 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.header-title { font-size: 1.1rem; font-weight: 600; color: var(--text-bright); }
.header-meta { font-size: 0.8rem; color: var(--text-muted); }
.header-badge {
  display: inline-flex; align-items: center; gap: 0.35rem;
  background: rgba(167,139,250,0.12); color: var(--accent);
  border: 1px solid rgba(167,139,250,0.25);
  padding: 0.25rem 0.6rem; border-radius: 4px;
  font-size: 0.75rem; font-weight: 600;
}

/* Tabs */
.tabs {
  display: flex; gap: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 0 2rem;
  overflow-x: auto;
}
.tab {
  padding: 0.75rem 1.25rem;
  cursor: pointer;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* Content */
.content { padding: 1.5rem 2rem; }
.tab-panel { display: none; }
.tab-panel.active { display: block; }

/* Stats cards */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
}
.stat-label { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font-size: 1.75rem; font-weight: 700; color: var(--text-bright); line-height: 1; }
.stat-value.red { color: var(--red); }
.stat-value.yellow { color: var(--yellow); }
.stat-value.green { color: var(--green); }
.stat-value.accent { color: var(--accent); }

/* Section heading */
.section-title {
  font-size: 0.85rem; font-weight: 600;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;
  margin-bottom: 1rem;
}

/* Chart bar */
.bar-chart { margin-bottom: 1.5rem; }
.bar-row {
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.bar-label { width: 140px; font-size: 0.8rem; color: var(--text-muted); flex-shrink: 0; }
.bar-track { flex: 1; height: 14px; background: var(--bg-input); border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.bar-count { width: 40px; text-align: right; font-size: 0.8rem; color: var(--text); }

/* Top CVEs */
.top-cve-list { display: flex; flex-direction: column; gap: 0.5rem; }
.top-cve-item {
  display: flex; align-items: center; gap: 0.75rem;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 0.6rem 0.9rem;
}
.top-cve-rank { width: 24px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600; flex-shrink: 0; }
.top-cve-id { font-family: monospace; font-size: 0.85rem; color: var(--accent); min-width: 130px; }
.top-cve-pkg { font-size: 0.8rem; color: var(--text); flex: 1; }
.top-cve-scores { display: flex; gap: 0.5rem; align-items: center; }

/* Filters */
.filters {
  display: flex; gap: 0.75rem; flex-wrap: wrap;
  margin-bottom: 1rem; align-items: center;
}
.filter-label { font-size: 0.8rem; color: var(--text-muted); }
select, input[type=text], input[type=range] {
  background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text); padding: 0.35rem 0.6rem;
  border-radius: var(--radius); font-size: 0.8rem;
  outline: none;
}
select:focus, input[type=text]:focus { border-color: var(--accent); }
input[type=text] { min-width: 180px; }
.range-group { display: flex; align-items: center; gap: 0.5rem; }
#epssValue { min-width: 32px; font-size: 0.8rem; color: var(--accent); }

/* Tables */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
th {
  text-align: left; padding: 0.5rem 0.75rem;
  background: var(--bg-card); border-bottom: 1px solid var(--border);
  color: var(--text-muted); font-weight: 600; font-size: 0.75rem;
  text-transform: uppercase; letter-spacing: 0.04em;
  white-space: nowrap;
}
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--text); }
th.sorted-asc::after { content: ' ▲'; color: var(--accent); }
th.sorted-desc::after { content: ' ▼'; color: var(--accent); }
td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: rgba(255,255,255,0.02); }

/* Verdict row colors */
tr.verdict-affected td:first-child { border-left: 3px solid var(--red); }
tr.verdict-investigating td:first-child { border-left: 3px solid var(--yellow); }
tr.verdict-not-affected td:first-child { border-left: 3px solid var(--green); }

/* Badges */
.badge {
  display: inline-flex; align-items: center;
  padding: 0.15rem 0.45rem; border-radius: 3px;
  font-size: 0.72rem; font-weight: 600; white-space: nowrap;
}
.badge-red    { background: rgba(248,81,73,0.15);  color: var(--red); }
.badge-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
.badge-green  { background: rgba(63,185,80,0.15);  color: var(--green); }
.badge-gray   { background: rgba(139,148,158,0.15);color: var(--text-muted); }
.badge-accent { background: rgba(167,139,250,0.15);color: var(--accent); }
.badge-orange { background: rgba(219,109,40,0.15); color: var(--orange); }

/* Expandable row */
.expand-row td { padding: 0; border-bottom: 1px solid var(--border); }
.expand-body {
  padding: 0.75rem 1rem;
  background: rgba(22,27,34,0.8);
  font-size: 0.8rem; color: var(--text);
}
.expand-body .expand-section { margin-bottom: 0.6rem; }
.expand-body .expand-label { color: var(--text-muted); font-size: 0.75rem; margin-bottom: 0.25rem; }
.expand-body pre { font-family: monospace; font-size: 0.78rem; white-space: pre-wrap; color: var(--text-muted); }
.row-toggle { cursor: pointer; }

/* Download buttons */
.btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.45rem 1rem; border-radius: var(--radius);
  font-size: 0.82rem; font-weight: 500;
  cursor: pointer; border: none; transition: opacity 0.15s;
}
.btn:hover { opacity: 0.85; }
.btn-accent { background: var(--accent); color: #0d1117; }
.btn-outline {
  background: none; border: 1px solid var(--border);
  color: var(--text);
}
.btn-outline:hover { border-color: var(--accent); color: var(--accent); }

/* Staleness bar */
.stale-bar-track { width: 80px; height: 8px; background: var(--bg-input); border-radius: 2px; overflow: hidden; display: inline-block; vertical-align: middle; }
.stale-bar-fill { height: 100%; border-radius: 2px; }

/* Policy banners */
.policy-banner {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.65rem 1rem; border-radius: var(--radius);
  margin-bottom: 0.75rem; font-size: 0.85rem;
}
.policy-banner.deny { background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.3); color: var(--red); }
.policy-banner.warn { background: rgba(210,153,34,0.1); border: 1px solid rgba(210,153,34,0.3); color: var(--yellow); }

/* Score cell */
.score-critical { color: var(--red); font-weight: 700; }
.score-high     { color: var(--orange); font-weight: 600; }
.score-medium   { color: var(--yellow); }
.score-low      { color: var(--green); }

/* Empty state */
.empty-state { text-align: center; padding: 2.5rem; color: var(--text-muted); font-size: 0.85rem; }

/* SBOM summary badges */
.badge-counts { display: flex; gap: 0.5rem; margin-bottom: 1rem; }

/* VEX state colors */
.state-affected      { color: var(--red); }
.state-not_affected  { color: var(--green); }
.state-investigating { color: var(--yellow); }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="header-title">Security Dashboard — ${projectName}</div>
    <div class="header-meta">Generated ${generatedAt}</div>
  </div>
  <div class="header-badge">KiroGraph Security</div>
</div>

<div class="tabs">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="vulns">Vulnerabilities</button>
  <button class="tab" data-tab="sbom">SBOM</button>
  <button class="tab" data-tab="vex">VEX</button>
  <button class="tab" data-tab="licenses">Licenses</button>
  <button class="tab" data-tab="staleness">Staleness</button>
</div>

<div class="content">

  <!-- Tab: Overview -->
  <div class="tab-panel active" id="tab-overview">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Dependencies</div>
        <div class="stat-value accent" id="stat-deps">${totalDeps}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Vulnerabilities</div>
        <div class="stat-value ${totalVulns > 0 ? 'red' : 'green'}" id="stat-vulns">${totalVulns}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Affected</div>
        <div class="stat-value ${affected > 0 ? 'red' : 'green'}">${affected}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Under Investigation</div>
        <div class="stat-value ${underInvestigation > 0 ? 'yellow' : 'green'}">${underInvestigation}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Not Affected</div>
        <div class="stat-value green">${notAffected}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stale Dependencies</div>
        <div class="stat-value ${staleDeps > 0 ? 'yellow' : 'green'}">${staleDeps}</div>
      </div>
    </div>

    ${totalVulns > 0 ? `
    <div class="section-title">Verdict Breakdown</div>
    <div class="bar-chart">
      ${affected > 0 ? `<div class="bar-row">
        <div class="bar-label">Affected</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(affected/totalVulns*100)}%;background:var(--red)"></div></div>
        <div class="bar-count">${affected}</div>
      </div>` : ''}
      ${underInvestigation > 0 ? `<div class="bar-row">
        <div class="bar-label">Under Investigation</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(underInvestigation/totalVulns*100)}%;background:var(--yellow)"></div></div>
        <div class="bar-count">${underInvestigation}</div>
      </div>` : ''}
      ${notAffected > 0 ? `<div class="bar-row">
        <div class="bar-label">Not Affected</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(notAffected/totalVulns*100)}%;background:var(--green)"></div></div>
        <div class="bar-count">${notAffected}</div>
      </div>` : ''}
      ${(totalVulns - affected - underInvestigation - notAffected) > 0 ? `<div class="bar-row">
        <div class="bar-label">Pending Analysis</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((totalVulns-affected-underInvestigation-notAffected)/totalVulns*100)}%;background:var(--text-muted)"></div></div>
        <div class="bar-count">${totalVulns - affected - underInvestigation - notAffected}</div>
      </div>` : ''}
    </div>
    ` : ''}

    ${top5.length > 0 ? `
    <div class="section-title">Top 5 Critical CVEs</div>
    <div class="top-cve-list">
      ${top5.map((v, i) => `
      <div class="top-cve-item">
        <div class="top-cve-rank">#${i+1}</div>
        <div class="top-cve-id">${v.cve_id}</div>
        <div class="top-cve-pkg">${v.package_name ?? '—'} ${v.ecosystem ? `<span style="color:var(--text-muted);font-size:0.75rem">[${v.ecosystem}]</span>` : ''}</div>
        <div class="top-cve-scores">
          ${v.severity_score != null ? `<span class="badge ${v.severity_score >= 9 ? 'badge-red' : v.severity_score >= 7 ? 'badge-orange' : v.severity_score >= 4 ? 'badge-yellow' : 'badge-gray'}">CVSS ${v.severity_score.toFixed(1)}</span>` : ''}
          ${v.epss_score != null ? `<span class="badge ${v.epss_score >= 0.5 ? 'badge-red' : v.epss_score >= 0.1 ? 'badge-yellow' : 'badge-gray'}">EPSS ${(v.epss_score*100).toFixed(2)}%</span>` : ''}
          ${v.verdict ? `<span class="badge ${v.verdict === 'affected' ? 'badge-red' : v.verdict === 'not_affected' ? 'badge-green' : 'badge-yellow'}">${v.verdict}</span>` : ''}
        </div>
      </div>`).join('')}
    </div>
    ` : totalVulns === 0 ? '<div class="empty-state">No vulnerabilities found.</div>' : ''}
  </div>

  <!-- Tab: Vulnerabilities -->
  <div class="tab-panel" id="tab-vulns">
    <div class="filters">
      <div class="filter-label">Severity:</div>
      <select id="filterSeverity">
        <option value="all">All</option>
        <option value="critical">Critical (≥9)</option>
        <option value="high">High (≥7)</option>
        <option value="medium">Medium (≥4)</option>
        <option value="low">Low (&lt;4)</option>
      </select>
      <div class="filter-label">Verdict:</div>
      <select id="filterVerdict">
        <option value="all">All</option>
        <option value="affected">Affected</option>
        <option value="under_investigation">Under Investigation</option>
        <option value="not_affected">Not Affected</option>
      </select>
      <div class="filter-label">Min EPSS:</div>
      <div class="range-group">
        <input type="range" id="filterEpss" min="0" max="1" step="0.01" value="0">
        <span id="epssValue">0.00</span>
      </div>
    </div>
    <div class="table-wrap">
      <table id="vulnTable">
        <thead>
          <tr>
            <th class="sortable" data-col="cve_id">CVE ID</th>
            <th class="sortable" data-col="package_name">Package</th>
            <th>Ecosystem</th>
            <th class="sortable" data-col="severity_score">CVSS</th>
            <th class="sortable sorted-desc" data-col="epss_score">EPSS</th>
            <th class="sortable" data-col="epss_percentile">Percentile</th>
            <th>Verdict</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody id="vulnBody"></tbody>
      </table>
    </div>
    <div id="vulnEmpty" class="empty-state" style="display:none">No vulnerabilities match the current filters.</div>
  </div>

  <!-- Tab: SBOM -->
  <div class="tab-panel" id="tab-sbom">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
      <div class="badge-counts">
        <span class="badge badge-accent">${directCount} direct</span>
        <span class="badge badge-gray">${transitiveCount} transitive</span>
      </div>
      <button class="btn btn-outline" onclick="downloadSBOM()">↓ Download SBOM JSON</button>
    </div>
    <div class="filters">
      <div class="filter-label">Ecosystem:</div>
      <select id="filterEco">
        <option value="all">All</option>
        ${[...new Set(deps.map(d => d.ecosystem))].sort().map(e => `<option value="${e}">${e}</option>`).join('')}
      </select>
      <input type="text" id="filterPkg" placeholder="Search package…">
    </div>
    <div class="table-wrap">
      <table id="sbomTable">
        <thead>
          <tr>
            <th>Package</th>
            <th>Ecosystem</th>
            <th>Version</th>
            <th>Scope</th>
            <th>License</th>
            <th>purl</th>
          </tr>
        </thead>
        <tbody id="sbomBody"></tbody>
      </table>
    </div>
    <div id="sbomEmpty" class="empty-state" style="display:none">No packages match the current filters.</div>
  </div>

  <!-- Tab: VEX -->
  <div class="tab-panel" id="tab-vex">
    <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
      <button class="btn btn-outline" onclick="downloadVEX()">↓ Download VEX JSON</button>
    </div>
    <div class="table-wrap">
      <table id="vexTable">
        <thead>
          <tr>
            <th>CVE ID</th>
            <th>Package</th>
            <th>Analysis State</th>
            <th>Justification</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody id="vexBody"></tbody>
      </table>
    </div>
    <div id="vexEmpty" class="empty-state" style="display:none">No VEX entries found.</div>
  </div>

  <!-- Tab: Licenses -->
  <div class="tab-panel" id="tab-licenses">
    <div id="licBanners"></div>
    <div class="filters">
      <div class="filter-label">Policy:</div>
      <select id="filterLicPolicy">
        <option value="all">All</option>
        <option value="deny">Deny</option>
        <option value="warn">Warn</option>
        <option value="ok">OK</option>
        <option value="unknown">Unknown</option>
      </select>
    </div>
    <div class="table-wrap">
      <table id="licTable">
        <thead>
          <tr>
            <th>Package</th>
            <th>Ecosystem</th>
            <th>License</th>
            <th>Policy Status</th>
          </tr>
        </thead>
        <tbody id="licBody"></tbody>
      </table>
    </div>
    <div id="licEmpty" class="empty-state" style="display:none">No packages match the current filters.</div>
  </div>

  <!-- Tab: Staleness -->
  <div class="tab-panel" id="tab-staleness">
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);max-width:600px;margin-bottom:1.5rem">
      <div class="stat-card">
        <div class="stat-label">Scored</div>
        <div class="stat-value accent">${stalenessRows.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Low (0–0.3)</div>
        <div class="stat-value green">${stalenessRows.filter(r => (r.staleness_score??0) < 0.3).length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">High (0.7–1.0)</div>
        <div class="stat-value red">${stalenessRows.filter(r => (r.staleness_score??0) >= 0.7).length}</div>
      </div>
    </div>

    ${stalenessRows.length > 0 ? `
    <div class="section-title">Distribution</div>
    <div class="bar-chart" style="margin-bottom:1.5rem">
      <div class="bar-row">
        <div class="bar-label">Low (0–0.3)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(stalenessRows.filter(r=>(r.staleness_score??0)<0.3).length/stalenessRows.length*100)}%;background:var(--green)"></div></div>
        <div class="bar-count">${stalenessRows.filter(r=>(r.staleness_score??0)<0.3).length}</div>
      </div>
      <div class="bar-row">
        <div class="bar-label">Medium (0.3–0.7)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(stalenessRows.filter(r=>{const s=r.staleness_score??0;return s>=0.3&&s<0.7}).length/stalenessRows.length*100)}%;background:var(--yellow)"></div></div>
        <div class="bar-count">${stalenessRows.filter(r=>{const s=r.staleness_score??0;return s>=0.3&&s<0.7}).length}</div>
      </div>
      <div class="bar-row">
        <div class="bar-label">High (0.7–1.0)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(stalenessRows.filter(r=>(r.staleness_score??0)>=0.7).length/stalenessRows.length*100)}%;background:var(--red)"></div></div>
        <div class="bar-count">${stalenessRows.filter(r=>(r.staleness_score??0)>=0.7).length}</div>
      </div>
    </div>
    ` : ''}

    <div class="table-wrap">
      <table id="staleTable">
        <thead>
          <tr>
            <th>Package</th>
            <th>Ecosystem</th>
            <th>Current</th>
            <th>Latest</th>
            <th>Months Behind</th>
            <th class="sortable sorted-desc" data-col="staleness_score">Score</th>
            <th>Bar</th>
          </tr>
        </thead>
        <tbody id="staleBody"></tbody>
      </table>
    </div>
    <div id="staleEmpty" class="empty-state" style="display:none">No staleness data available.</div>
  </div>

</div>

<script>
// ── Embedded data ─────────────────────────────────────────────────────────────
const VULNS = ${safeJson(vulns)};
const DEPS  = ${safeJson(deps)};
const LIC_DATA = ${safeJson(licenseData)};
const STALE_DATA = ${safeJson(stalenessRows)};
const SBOM_JSON = ${safeJson(sbomJson)};
const VEX_JSON  = ${safeJson(vexJson)};

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById('tab-' + tabId).classList.add('active');
  });
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function downloadJson(data, filename) {
  const blob = new Blob([data], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
function downloadSBOM() { downloadJson(SBOM_JSON, 'sbom.json'); }
function downloadVEX()  { downloadJson(VEX_JSON,  'vex.json'); }

function epssClass(v) {
  if (v == null) return 'badge-gray';
  if (v >= 0.5) return 'badge-red';
  if (v >= 0.1) return 'badge-yellow';
  return 'badge-gray';
}
function cvssClass(v) {
  if (v == null) return '';
  if (v >= 9) return 'score-critical';
  if (v >= 7) return 'score-high';
  if (v >= 4) return 'score-medium';
  return 'score-low';
}
function verdictBadge(v) {
  if (!v) return '<span class="badge badge-gray">—</span>';
  if (v === 'affected')            return '<span class="badge badge-red">affected</span>';
  if (v === 'not_affected')        return '<span class="badge badge-green">not affected</span>';
  if (v === 'under_investigation') return '<span class="badge badge-yellow">investigating</span>';
  return '<span class="badge badge-gray">' + esc(v) + '</span>';
}
function staleColor(score) {
  if (score >= 0.7) return 'var(--red)';
  if (score >= 0.3) return 'var(--yellow)';
  return 'var(--green)';
}

// ── Vulnerability table ───────────────────────────────────────────────────────
let vulnSortCol = 'epss_score';
let vulnSortDir = -1; // -1 = desc

function renderVulns() {
  const sevFilter = document.getElementById('filterSeverity').value;
  const verdFilter = document.getElementById('filterVerdict').value;
  const epssMin = parseFloat(document.getElementById('filterEpss').value) || 0;

  let rows = VULNS.filter(v => {
    if (sevFilter !== 'all') {
      const s = v.severity_score ?? 0;
      if (sevFilter === 'critical' && s < 9) return false;
      if (sevFilter === 'high'     && (s < 7 || s >= 9)) return false;
      if (sevFilter === 'medium'   && (s < 4 || s >= 7)) return false;
      if (sevFilter === 'low'      && s >= 4) return false;
    }
    if (verdFilter !== 'all') {
      if ((v.verdict ?? '') !== verdFilter) return false;
    }
    if ((v.epss_score ?? 0) < epssMin) return false;
    return true;
  });

  rows = rows.slice().sort((a, b) => {
    const av = a[vulnSortCol] ?? (typeof a[vulnSortCol] === 'number' ? -Infinity : '');
    const bv = b[vulnSortCol] ?? (typeof b[vulnSortCol] === 'number' ? -Infinity : '');
    if (av < bv) return vulnSortDir;
    if (av > bv) return -vulnSortDir;
    return 0;
  });

  const tbody = document.getElementById('vulnBody');
  const empty = document.getElementById('vulnEmpty');

  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = rows.map(v => {
    const rowClass = v.verdict === 'affected' ? 'verdict-affected'
                   : v.verdict === 'under_investigation' ? 'verdict-investigating'
                   : v.verdict === 'not_affected' ? 'verdict-not-affected' : '';
    const purl = v.ecosystem && v.package_name && (v.resolved_version || v.declared_constraint)
      ? 'pkg:' + esc(v.ecosystem) + '/' + esc(v.package_name) + '@' + esc(v.resolved_version || v.declared_constraint)
      : '';
    return \`<tr class="row-toggle \${rowClass}" onclick="toggleExpand(this, \${JSON.stringify(v).replace(/"/g,'&quot;')})">
      <td><code style="font-size:0.8rem;color:var(--accent)">\${esc(v.cve_id)}</code></td>
      <td>\${esc(v.package_name ?? '—')}</td>
      <td><span class="badge badge-gray">\${esc(v.ecosystem ?? '—')}</span></td>
      <td class="\${cvssClass(v.severity_score)}">\${v.severity_score != null ? v.severity_score.toFixed(1) : '—'}</td>
      <td><span class="badge \${epssClass(v.epss_score)}">\${v.epss_score != null ? (v.epss_score*100).toFixed(2)+'%' : '—'}</span></td>
      <td>\${v.epss_percentile != null ? (v.epss_percentile*100).toFixed(0)+'th' : '—'}</td>
      <td>\${verdictBadge(v.verdict)}</td>
      <td>\${v.fixed_version ? '<span class="badge badge-green">'+esc(v.fixed_version)+'</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
    </tr>
    <tr class="expand-row" style="display:none">
      <td colspan="8">
        <div class="expand-body" id="expand-\${esc(v.cve_id)}"></div>
      </td>
    </tr>\`;
  }).join('');
}

function toggleExpand(row, data) {
  const expandRow = row.nextElementSibling;
  if (!expandRow) return;
  const isVisible = expandRow.style.display !== 'none';
  if (isVisible) {
    expandRow.style.display = 'none';
    return;
  }
  expandRow.style.display = '';
  const body = expandRow.querySelector('.expand-body');
  let html = '';
  if (data.summary) {
    html += '<div class="expand-section"><div class="expand-label">Summary</div><div>' + esc(data.summary) + '</div></div>';
  }
  if (data.affected_ranges) {
    try {
      const ranges = JSON.parse(data.affected_ranges);
      html += '<div class="expand-section"><div class="expand-label">Affected Ranges</div><pre>' + esc(JSON.stringify(ranges, null, 2)) + '</pre></div>';
    } catch {}
  }
  if (data.paths) {
    try {
      const paths = JSON.parse(data.paths);
      if (Array.isArray(paths) && paths.length > 0) {
        html += '<div class="expand-section"><div class="expand-label">Call Paths (' + paths.length + ')</div>';
        paths.slice(0, 3).forEach(p => {
          if (p.path && Array.isArray(p.path)) {
            html += '<div style="margin-bottom:0.3rem;font-family:monospace;font-size:0.78rem;color:var(--text-muted)">' + p.path.map(n => esc(n.id || n)).join(' → ') + '</div>';
          }
        });
        if (paths.length > 3) html += '<div style="color:var(--text-muted);font-size:0.75rem">… and ' + (paths.length-3) + ' more</div>';
        html += '</div>';
      }
    } catch {}
  }
  if (!html) html = '<div style="color:var(--text-muted)">No additional details available.</div>';
  body.innerHTML = html;
}

// Sort headers
document.querySelectorAll('#vulnTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.getAttribute('data-col');
    if (vulnSortCol === col) {
      vulnSortDir = -vulnSortDir;
      th.classList.toggle('sorted-asc', vulnSortDir === 1);
      th.classList.toggle('sorted-desc', vulnSortDir === -1);
    } else {
      document.querySelectorAll('#vulnTable th').forEach(t => { t.classList.remove('sorted-asc','sorted-desc'); });
      vulnSortCol = col;
      vulnSortDir = -1;
      th.classList.add('sorted-desc');
    }
    renderVulns();
  });
});

document.getElementById('filterSeverity').addEventListener('change', renderVulns);
document.getElementById('filterVerdict').addEventListener('change', renderVulns);
document.getElementById('filterEpss').addEventListener('input', function() {
  document.getElementById('epssValue').textContent = parseFloat(this.value).toFixed(2);
  renderVulns();
});

// ── SBOM table ────────────────────────────────────────────────────────────────
function renderSBOM() {
  const eco = document.getElementById('filterEco').value;
  const pkg = document.getElementById('filterPkg').value.toLowerCase();

  const rows = DEPS.filter(d => {
    if (eco !== 'all' && d.ecosystem !== eco) return false;
    if (pkg && !d.package_name.toLowerCase().includes(pkg)) return false;
    return true;
  });

  const tbody = document.getElementById('sbomBody');
  const empty = document.getElementById('sbomEmpty');
  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = rows.map(d => {
    const version = d.resolved_version || d.declared_constraint || '—';
    const purl = d.ecosystem && d.package_name
      ? 'pkg:' + esc(d.ecosystem) + '/' + esc(d.package_name) + '@' + esc(version)
      : '—';
    const scopeBadge = d.classification === 'direct'
      ? '<span class="badge badge-accent">direct</span>'
      : '<span class="badge badge-gray">transitive</span>';
    return \`<tr>
      <td><strong>\${esc(d.package_name)}</strong></td>
      <td><span class="badge badge-gray">\${esc(d.ecosystem)}</span></td>
      <td><code style="font-size:0.78rem">\${esc(version)}</code></td>
      <td>\${scopeBadge}</td>
      <td>\${d.license ? esc(d.license) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><code style="font-size:0.72rem;color:var(--text-muted)">\${esc(purl)}</code></td>
    </tr>\`;
  }).join('');
}

document.getElementById('filterEco').addEventListener('change', renderSBOM);
document.getElementById('filterPkg').addEventListener('input', renderSBOM);

// ── VEX table ─────────────────────────────────────────────────────────────────
function renderVEX() {
  let vexData;
  try { vexData = JSON.parse(VEX_JSON); } catch { vexData = null; }
  const tbody = document.getElementById('vexBody');
  const empty = document.getElementById('vexEmpty');

  const vulns = vexData && vexData.vulnerabilities ? vexData.vulnerabilities : [];
  if (vulns.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = vulns.map(entry => {
    const state = entry.analysis && entry.analysis.state ? entry.analysis.state : '—';
    const justification = entry.analysis && entry.analysis.justification ? entry.analysis.justification : '—';
    const detail = entry.analysis && entry.analysis.detail ? entry.analysis.detail : '—';
    const pkg = entry.affects && entry.affects[0] ? entry.affects[0].ref : '—';
    const stateClass = state === 'affected' ? 'state-affected'
                     : state === 'not_affected' ? 'state-not_affected'
                     : state === 'under_investigation' ? 'state-investigating' : '';
    return \`<tr>
      <td><code style="font-size:0.8rem;color:var(--accent)">\${esc(entry.id)}</code></td>
      <td><code style="font-size:0.75rem;color:var(--text-muted)">\${esc(pkg)}</code></td>
      <td><span class="\${stateClass}" style="font-weight:500">\${esc(state)}</span></td>
      <td>\${esc(justification)}</td>
      <td style="max-width:300px">\${esc(detail)}</td>
    </tr>\`;
  }).join('');
}

// ── Licenses table ────────────────────────────────────────────────────────────
function renderLicenses() {
  // Banners
  const bannerEl = document.getElementById('licBanners');
  const denyCount = LIC_DATA.filter(d => d.status === 'deny').length;
  const warnCount = LIC_DATA.filter(d => d.status === 'warn').length;
  let banners = '';
  if (denyCount > 0) banners += \`<div class="policy-banner deny">✗ \${denyCount} package\${denyCount !== 1 ? 's' : ''} with denied license\${denyCount !== 1 ? 's' : ''}</div>\`;
  if (warnCount > 0) banners += \`<div class="policy-banner warn">⚠ \${warnCount} package\${warnCount !== 1 ? 's' : ''} with warned license\${warnCount !== 1 ? 's' : ''}</div>\`;
  bannerEl.innerHTML = banners;

  const pol = document.getElementById('filterLicPolicy').value;
  const rows = LIC_DATA.filter(d => pol === 'all' || d.status === pol);

  const tbody = document.getElementById('licBody');
  const empty = document.getElementById('licEmpty');
  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = rows.map(d => {
    let statusHtml;
    if (d.status === 'deny')         statusHtml = '<span class="badge badge-red">✗ deny</span>';
    else if (d.status === 'warn')    statusHtml = '<span class="badge badge-yellow">⚠ warn</span>';
    else if (d.status === 'ok')      statusHtml = '<span class="badge badge-green">✓ ok</span>';
    else                             statusHtml = '<span class="badge badge-gray">— unknown</span>';
    return \`<tr>
      <td><strong>\${esc(d.package_name)}</strong></td>
      <td><span class="badge badge-gray">\${esc(d.ecosystem)}</span></td>
      <td>\${d.license ? esc(d.license) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>\${statusHtml}</td>
    </tr>\`;
  }).join('');
}

document.getElementById('filterLicPolicy').addEventListener('change', renderLicenses);

// ── Staleness table ───────────────────────────────────────────────────────────
function renderStaleness() {
  const tbody = document.getElementById('staleBody');
  const empty = document.getElementById('staleEmpty');

  if (STALE_DATA.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = STALE_DATA.map(d => {
    const version = d.resolved_version || d.declared_constraint || '—';
    const latest = d.latest_version || '—';
    const score = d.staleness_score ?? 0;
    const months = d.latest_published
      ? Math.round((Date.now() - d.latest_published) / (1000 * 60 * 60 * 24 * 30))
      : null;
    const barPct = Math.round(score * 100);
    const barColor = staleColor(score);
    const scoreClass = score >= 0.7 ? 'score-critical' : score >= 0.3 ? 'score-medium' : 'score-low';
    return \`<tr>
      <td><strong>\${esc(d.package_name)}</strong></td>
      <td><span class="badge badge-gray">\${esc(d.ecosystem)}</span></td>
      <td><code style="font-size:0.78rem">\${esc(version)}</code></td>
      <td><code style="font-size:0.78rem;color:var(--green)">\${esc(latest)}</code></td>
      <td>\${months != null ? months + 'mo' : '—'}</td>
      <td class="\${scoreClass}">\${score.toFixed(2)}</td>
      <td>
        <div class="stale-bar-track">
          <div class="stale-bar-fill" style="width:\${barPct}%;background:\${barColor}"></div>
        </div>
      </td>
    </tr>\`;
  }).join('');
}

// ── Initial render ────────────────────────────────────────────────────────────
renderVulns();
renderSBOM();
renderVEX();
renderLicenses();
renderStaleness();
</script>

</body>
</html>`;
}

// ── Command registration ──────────────────────────────────────────────────────

export function register(secCmd: import('commander').Command): void {
  secCmd
    .command('export [projectPath]')
    .description('Generate a self-contained HTML security dashboard')
    .option('--output <file>', 'Output HTML file path', '.kirograph/security-export.html')
    .option('--open', 'Open in browser after generating')
    .action(async (projectPath: string | undefined, opts: { output: string; open?: boolean }) => {
      const target = path.resolve(projectPath ?? process.cwd());
      const config = await loadConfig(target);

      if (!config.enableSecurity) {
        console.error(`\n  ${'\x1b[33m'}⚠ Security analysis is disabled.${reset}`);
        console.error(`  ${dim}Enable it in .kirograph/config.json:${reset} ${violet}${bold}"enableSecurity": true${reset}`);
        console.error(`  ${dim}Then re-run:${reset} ${violet}${bold}kirograph index${reset}\n`);
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

      // Query all vulnerability + dep data in one JOIN
      const vulns: VulnRow[] = rawDb.all(`
        SELECT v.cve_id, v.severity_score, v.epss_score, v.epss_percentile,
               v.fixed_version, v.summary, v.affected_ranges,
               d.package_name, d.ecosystem, d.resolved_version, d.declared_constraint,
               d.scope, d.license,
               r.verdict, r.paths, r.unresolved_symbols, r.reaching_entry_point_count
        FROM sec_vulnerabilities v
        LEFT JOIN edges e ON e.target = v.node_id AND e.kind = 'has_vulnerability'
        LEFT JOIN sec_dependencies d ON d.node_id = e.source
        LEFT JOIN sec_reachability r ON r.vulnerability_node_id = v.node_id
        ORDER BY v.epss_score DESC NULLS LAST, v.severity_score DESC NULLS LAST
      `);

      // Determine which deps are direct (have a declared_in edge)
      const directNodeIds = new Set<string>(
        (rawDb.all(`SELECT source FROM edges WHERE kind = 'declared_in'`) as Array<{ source: string }>)
          .map((r) => r.source),
      );

      // All dependencies for SBOM tab + licenses + staleness
      const rawDeps: Omit<DepRow, 'classification'>[] = rawDb.all(
        `SELECT node_id, package_name, ecosystem, resolved_version, declared_constraint,
                scope, license, latest_version, latest_published, staleness_score
         FROM sec_dependencies ORDER BY package_name`,
      );
      const deps: DepRow[] = rawDeps.map(d => ({
        ...d,
        classification: directNodeIds.has(d.node_id) ? 'direct' : 'transitive',
      }));

      // Generate SBOM and VEX JSON for download buttons
      const { SBOMExporter } = await import('../../security/export/sbom');
      const { VEXExporter }  = await import('../../security/export/vex');
      const sbomExporter = new SBOMExporter(db, target);
      const vexExporter  = new VEXExporter(db, target);
      const sbomJson = sbomExporter.exportJSON();
      const vexJson  = vexExporter.exportJSON();

      cg.close();

      // Determine license policy
      const denyList = config.securityLicensePolicy?.deny ?? [];
      const warnList = config.securityLicensePolicy?.warn ?? [];

      const projectName = path.basename(target);
      const generatedAt = new Date().toLocaleString();

      const html = generateHtml({
        projectName,
        generatedAt,
        vulns,
        deps,
        sbomJson,
        vexJson,
        denyList,
        warnList,
      });

      // Write output
      const outPath = path.resolve(target, opts.output);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, 'utf-8');

      console.error(`  ${green}✓${reset} Security dashboard written to ${violet}${bold}${outPath}${reset}`);
      console.error(`  ${dim}${vulns.length} vulnerabilities · ${deps.length} dependencies${reset}`);

      if (opts.open) {
        openBrowser(outPath);
        console.error(`  ${dim}Opening in browser…${reset}`);
      }
    });
}
