/**
 * Ask Hadron 2.0 — Session Summary Service
 *
 * Tauri invoke wrappers for AI-generated session summaries and export.
 */

import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Types
// ============================================================================

export interface SessionSummary {
  id: number;
  sessionId: string;
  summaryMarkdown: string;
  topic?: string;
  wonVersion?: string;
  customer?: string;
  isIndexed: boolean;
  isExported: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateSummaryParams {
  sessionId: string;
  provider: string;
  model: string;
  apiKey: string;
}

export interface SaveSummaryParams {
  sessionId: string;
  summaryMarkdown: string;
  topic: string;
  wonVersion?: string;
  customer?: string;
}

export interface ExportSummariesParams {
  dateFrom?: string;
  dateTo?: string;
  customer?: string;
  unexportedOnly?: boolean;
}

// ============================================================================
// Commands
// ============================================================================

export async function generateSessionSummary(params: GenerateSummaryParams): Promise<string> {
  return invoke("generate_session_summary", { request: params });
}

export async function saveSessionSummary(params: SaveSummaryParams): Promise<number> {
  return invoke("save_session_summary", { request: params });
}

export async function getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
  return invoke("get_session_summary", { sessionId });
}

export async function exportSummariesBundle(params: ExportSummariesParams): Promise<string> {
  return invoke("export_summaries_bundle", { request: params });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Convert markdown to plain text for JIRA/email/Slack.
 * Strips markdown formatting, converts headers to UPPERCASE labels.
 */
export function markdownToPlainText(md: string): string {
  return md
    // Headers to UPPERCASE labels
    .replace(/^#{1,6}\s+(.+)$/gm, (_, title) => `${title.toUpperCase()}\n${"=".repeat(title.length)}`)
    // Bold/italic
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    // Links: [text](url) -> text (url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    // Code blocks
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, "").trim())
    // Inline code
    .replace(/`([^`]+)`/g, "$1")
    // List markers
    .replace(/^[-*]\s+/gm, "- ")
    // Multiple blank lines -> single
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
