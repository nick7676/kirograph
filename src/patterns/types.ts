/**
 * KiroGraph Patterns — shared types for pattern rules, matches, and results.
 */

export interface PatternRule {
  id: string;
  language: string | string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  owaspCategory: string;
  description: string;
  fixHint: string;
  fix?: string;          // ast-grep fix template using metavariables
  rule: Record<string, unknown>;
}

export interface PatternMatch {
  patternId: string;
  filePath: string;
  line: number;       // 1-based
  col: number;        // 0-based
  matchText: string;  // truncated to 500 chars
  context: string;    // line before + matched + line after
  severity: PatternRule['severity'];
  owaspCategory: string;
  language: string;
  fixSuggestion?: string;  // populated when the rule has a fix: field
}

export const SEVERITY_ORDER: Record<PatternRule['severity'], number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};
