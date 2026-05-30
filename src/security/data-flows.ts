/**
 * KiroGraph SAST-lite: Dangerous Data Flow Detection
 *
 * Detects dangerous patterns by analysing call edges in the graph database.
 * Uses symbol names and callee chains rather than full AST traversal.
 */

import type { GraphDatabase } from '../db/database';
import type { OwaspCategory } from './owasp';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataFlowFinding {
  type: 'sql-injection' | 'path-traversal' | 'xss' | 'dangerous-eval' | 'unsafe-deserialize' | 'hardcoded-crypto';
  severity: 'critical' | 'high' | 'medium';
  owaspCategory: OwaspCategory;
  filePath: string;
  line: number;
  symbol: string;
  description: string;
  recommendation: string;
}

// ── Internal row type returned by the DB queries ──────────────────────────────

interface CallEdgeRow {
  caller: string;
  file_path: string;
  start_line: number;
  callee: string;
}

// ── DataFlowAnalyzer ──────────────────────────────────────────────────────────

export class DataFlowAnalyzer {
  constructor(private readonly db: GraphDatabase) {}

  async analyze(): Promise<DataFlowFinding[]> {
    const rawDb = this.db.getRawDb();
    const findings: DataFlowFinding[] = [];

    findings.push(...this._detectDangerousEval(rawDb));
    findings.push(...this._detectUnsafeDeserialize(rawDb));
    findings.push(...this._detectHardcodedCrypto(rawDb));
    findings.push(...this._detectSqlInjection(rawDb));
    findings.push(...this._detectPathTraversal(rawDb));

    return findings;
  }

  // ── Detection: dangerous eval / exec ────────────────────────────────────────

  private _detectDangerousEval(rawDb: any): DataFlowFinding[] {
    const rows: CallEdgeRow[] = rawDb.all(`
      SELECT n.name as caller, n.file_path, n.start_line, n2.name as callee
      FROM edges e
      JOIN nodes n  ON n.id  = e.source
      JOIN nodes n2 ON n2.id = e.target
      WHERE e.kind = 'calls'
        AND n2.name IN ('eval', 'Function', 'execSync', 'exec', 'spawn', 'spawnSync', 'execFileSync', 'execFile')
        AND n.file_path != ''
    `);

    return rows.map((row) => ({
      type: 'dangerous-eval' as const,
      severity: 'critical' as const,
      owaspCategory: 'A03' as const,
      filePath: row.file_path,
      line: row.start_line,
      symbol: row.caller,
      description: `Function '${row.caller}' calls '${row.callee}', which can execute arbitrary code or OS commands.`,
      recommendation: `Avoid '${row.callee}'. Use structured APIs or allowlists for dynamic execution. Validate and sanitize all inputs.`,
    }));
  }

  // ── Detection: unsafe deserialization ────────────────────────────────────────

  private _detectUnsafeDeserialize(rawDb: any): DataFlowFinding[] {
    const rows: CallEdgeRow[] = rawDb.all(`
      SELECT n.name as caller, n.file_path, n.start_line, n2.name as callee
      FROM edges e
      JOIN nodes n  ON n.id  = e.source
      JOIN nodes n2 ON n2.id = e.target
      WHERE e.kind = 'calls'
        AND (
          n2.name IN ('unserialize', 'deserialize', 'fromJson', 'loads')
          OR n2.name LIKE '%pickle%'
          OR n2.name LIKE '%marshal%'
          OR n2.name = 'yaml.load'
        )
        AND n.file_path != ''
    `);

    return rows.map((row) => ({
      type: 'unsafe-deserialize' as const,
      severity: 'high' as const,
      owaspCategory: 'A08' as const,
      filePath: row.file_path,
      line: row.start_line,
      symbol: row.caller,
      description: `Function '${row.caller}' calls '${row.callee}', which may deserialize untrusted data unsafely.`,
      recommendation: `Validate data before deserialization. Use safe alternatives (e.g. yaml.safe_load, JSON schema validation). Never deserialize data from untrusted sources.`,
    }));
  }

  // ── Detection: hardcoded weak crypto ─────────────────────────────────────────

  private _detectHardcodedCrypto(rawDb: any): DataFlowFinding[] {
    const rows: CallEdgeRow[] = rawDb.all(`
      SELECT n.name as caller, n.file_path, n.start_line, n2.name as callee
      FROM edges e
      JOIN nodes n  ON n.id  = e.source
      JOIN nodes n2 ON n2.id = e.target
      WHERE e.kind = 'calls'
        AND (
          n2.name LIKE '%md5%'
          OR n2.name LIKE '%sha1%'
          OR n2.name LIKE '%des%'
          OR n2.name LIKE '%rc4%'
          OR n2.name LIKE '%blowfish%'
        )
        AND (
          n.name LIKE '%crypto%'
          OR n.name LIKE '%hash%'
          OR n.name LIKE '%cipher%'
          OR n.name LIKE '%encrypt%'
          OR n.name LIKE '%digest%'
          OR n.file_path LIKE '%crypto%'
          OR n.file_path LIKE '%hash%'
          OR n.file_path LIKE '%cipher%'
          OR n.file_path LIKE '%auth%'
        )
        AND n.file_path != ''
    `);

    return rows.map((row) => ({
      type: 'hardcoded-crypto' as const,
      severity: 'medium' as const,
      owaspCategory: 'A02' as const,
      filePath: row.file_path,
      line: row.start_line,
      symbol: row.caller,
      description: `Function '${row.caller}' uses weak or deprecated cryptographic algorithm '${row.callee}'.`,
      recommendation: `Replace with a strong algorithm: SHA-256 or SHA-3 for hashing, AES-256-GCM for symmetric encryption. Avoid MD5 and SHA-1 for security purposes.`,
    }));
  }

  // ── Detection: SQL injection ──────────────────────────────────────────────────

  private _detectSqlInjection(rawDb: any): DataFlowFinding[] {
    // Find functions that:
    //  (a) call a known DB query function
    //  (b) AND whose name suggests user-input handling (controller/route/request context)
    const rows: CallEdgeRow[] = rawDb.all(`
      SELECT n.name as caller, n.file_path, n.start_line, n2.name as callee
      FROM edges e
      JOIN nodes n  ON n.id  = e.source
      JOIN nodes n2 ON n2.id = e.target
      WHERE e.kind = 'calls'
        AND n2.name IN ('query', 'execute', 'exec', 'raw', 'runQuery', 'executeQuery', 'runSql', 'executeSql')
        AND (
          n.name LIKE '%handle%'
          OR n.name LIKE '%controller%'
          OR n.name LIKE '%route%'
          OR n.name LIKE '%request%'
          OR n.name LIKE '%req%'
          OR n.name LIKE '%endpoint%'
          OR n.name LIKE '%action%'
          OR n.name LIKE '%handler%'
        )
        AND n.file_path != ''
    `);

    // Only report entries that do NOT also have a sanitize/escape call in the same scope
    const sanitizeCallers: Set<string> = new Set<string>(
      (rawDb.all(`
        SELECT DISTINCT n.id
        FROM edges e
        JOIN nodes n  ON n.id  = e.source
        JOIN nodes n2 ON n2.id = e.target
        WHERE e.kind = 'calls'
          AND (
            n2.name LIKE '%sanitize%'
            OR n2.name LIKE '%escape%'
            OR n2.name LIKE '%parameteriz%'
            OR n2.name LIKE '%prepared%'
            OR n2.name LIKE '%placeholder%'
          )
      `) as Array<{ id: string }>).map((r) => r.id),
    );

    // Cross-reference: look up caller node IDs to filter sanitized callers
    const callerIds: Map<string, string> = new Map(
      (rawDb.all(`
        SELECT id, name FROM nodes WHERE kind IN ('function', 'method', 'arrow_function')
      `) as Array<{ id: string; name: string }>).map((r) => [r.name, r.id]),
    );

    return rows
      .filter((row) => {
        const callerId = callerIds.get(row.caller);
        return !callerId || !sanitizeCallers.has(callerId);
      })
      .map((row) => ({
        type: 'sql-injection' as const,
        severity: 'critical' as const,
        owaspCategory: 'A03' as const,
        filePath: row.file_path,
        line: row.start_line,
        symbol: row.caller,
        description: `Controller/handler '${row.caller}' calls database function '${row.callee}' without apparent input sanitization.`,
        recommendation: `Use parameterized queries or prepared statements. Never concatenate user input into SQL strings. Consider an ORM with query builders.`,
      }));
  }

  // ── Detection: path traversal ─────────────────────────────────────────────────

  private _detectPathTraversal(rawDb: any): DataFlowFinding[] {
    // Find functions that call file I/O operations and look like they handle requests.
    // Exclusions:
    //   - Internal analysis/infrastructure paths (mcp, resolution, security, extraction, graph, architecture)
    //   - 'open' is excluded from file ops because KiroGraph.open() (DB) triggers false positives
    //   - Class names ending in 'Handler' or 'Server' are excluded (too broad — use more specific patterns)
    const rows: CallEdgeRow[] = rawDb.all(`
      SELECT n.name as caller, n.file_path, n.start_line, n2.name as callee
      FROM edges e
      JOIN nodes n  ON n.id  = e.source
      JOIN nodes n2 ON n2.id = e.target
      WHERE e.kind = 'calls'
        AND n2.name IN ('readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'createReadStream', 'createWriteStream', 'openSync', 'unlink', 'unlinkSync')
        AND (
          n.name LIKE '%controller%'
          OR n.name LIKE '%route%'
          OR n.name LIKE '%request%'
          OR n.name LIKE '%download%'
          OR n.name LIKE '%upload%'
          OR n.name LIKE '%get%file%'
          OR n.name LIKE '%fetch%file%'
          OR n.name LIKE '%serve%file%'
          OR n.name LIKE '%handle%file%'
        )
        AND n.file_path != ''
        AND n.file_path NOT LIKE '%/mcp/%'
        AND n.file_path NOT LIKE '%/resolution/%'
        AND n.file_path NOT LIKE '%/security/%'
        AND n.file_path NOT LIKE '%/extraction/%'
        AND n.file_path NOT LIKE '%/graph/%'
        AND n.file_path NOT LIKE '%/architecture/%'
        AND n.file_path NOT LIKE '%/frameworks/%'
        AND n.file_path NOT LIKE '%/bridges/%'
    `);

    return rows.map((row) => ({
      type: 'path-traversal' as const,
      severity: 'high' as const,
      owaspCategory: 'A01' as const,
      filePath: row.file_path,
      line: row.start_line,
      symbol: row.caller,
      description: `Handler '${row.caller}' calls file operation '${row.callee}'. Path may be influenced by user input, enabling directory traversal.`,
      recommendation: `Validate and normalize file paths. Use path.resolve() and verify the result is inside an allowed base directory. Reject paths containing '..'.`,
    }));
  }
}
