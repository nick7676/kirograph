-- KiroGraph Patterns Schema (opt-in, enablePatterns=true)
-- Stores index-time AST pattern match results.

CREATE TABLE IF NOT EXISTS pattern_matches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT    NOT NULL,
  pattern_id     TEXT    NOT NULL,
  line           INTEGER NOT NULL,
  col            INTEGER NOT NULL,
  match_text     TEXT    NOT NULL,
  severity       TEXT    NOT NULL,  -- critical | high | medium | low
  owasp_category TEXT    NOT NULL,  -- e.g. A03
  language       TEXT    NOT NULL,
  indexed_at     INTEGER NOT NULL,  -- epoch ms
  symbol_node_id TEXT              -- ID of the enclosing symbol node (function/method/class), nullable
);

CREATE INDEX IF NOT EXISTS idx_pm_file       ON pattern_matches(file_path);
CREATE INDEX IF NOT EXISTS idx_pm_pattern    ON pattern_matches(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pm_severity   ON pattern_matches(severity);
CREATE INDEX IF NOT EXISTS idx_pm_file_line  ON pattern_matches(file_path, line);
CREATE INDEX IF NOT EXISTS idx_pm_owasp      ON pattern_matches(owasp_category);
CREATE INDEX IF NOT EXISTS idx_pm_symbol     ON pattern_matches(symbol_node_id);
