/**
 * KiroGraph Patterns — graph-level helpers for pattern match analysis.
 */

/**
 * Find all symbol node IDs that have pattern matches, along with caller nodes.
 * Useful for "who calls code with SQL injection patterns?"
 */
export function findCallersOfPatternMatches(
  rawDb: any,
  patternIdFilter?: string  // e.g. 'sql-injection' prefix match
): Array<{ symbolNodeId: string; symbolName: string; filePath: string; patternId: string; callerNodeId: string; callerName: string }> {
  const patternClause = patternIdFilter ? `AND pm.pattern_id LIKE ?` : '';
  const params: any[] = patternIdFilter ? [`${patternIdFilter}%`] : [];

  return rawDb.all(`
    SELECT DISTINCT
      pm.symbol_node_id, n.name as symbol_name, n.file_path,
      pm.pattern_id,
      e.source as caller_node_id, nc.name as caller_name
    FROM pattern_matches pm
    JOIN nodes n ON n.id = pm.symbol_node_id
    JOIN edges e ON e.target = pm.symbol_node_id AND e.kind = 'calls'
    JOIN nodes nc ON nc.id = e.source
    WHERE pm.symbol_node_id IS NOT NULL
    ${patternClause}
    LIMIT 100
  `, params);
}
