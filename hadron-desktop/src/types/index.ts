/**
 * TypeScript type definitions for Hadron Crash Analyzer
 */

export interface AnalysisResult {
  // Core fields
  id: number;
  filename: string;
  file_size_kb: number;

  // Crash data
  error_type: string;
  error_message?: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  component?: string;
  stack_trace?: string;

  // AI analysis
  root_cause: string;
  suggested_fixes: string; // JSON string from backend
  confidence?: "HIGH" | "MEDIUM" | "LOW";

  // Metadata
  analyzed_at: string;
  ai_model: string;
  ai_provider?: string;
  tokens_used: number;
  cost: number;
  was_truncated: boolean;

  // Phase 2: Just the essentials
  is_favorite: boolean;
  view_count: number;
  analysis_duration_ms?: number;

  // We won't use these yet (YAGNI):
  // last_viewed_at?: string;
  // full_data?: string;
}

export interface Settings {
  apiKey: string;
  model: string;
  maxFileSize: number;
}

export type Severity = "critical" | "high" | "medium" | "low";
