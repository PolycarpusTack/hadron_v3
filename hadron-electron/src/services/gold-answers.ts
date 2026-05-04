/**
 * Ask Hadron 2.0 — Gold Answers Service
 *
 * Tauri invoke wrappers for curated gold-standard Q&A management.
 */

import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Types
// ============================================================================

export interface GoldAnswer {
  id: number;
  question: string;
  answer: string;
  sessionId: string;
  messageId: string;
  wonVersion?: string;
  customer?: string;
  tags?: string;
  verifiedBy?: string;
  toolResultsJson?: string;
  createdAt: string;
}

export interface SaveGoldAnswerParams {
  question: string;
  answer: string;
  sessionId: string;
  messageId: string;
  wonVersion?: string;
  customer?: string;
  tags?: string;
  verifiedBy?: string;
  toolResultsJson?: string;
}

export interface ExportGoldParams {
  dateFrom?: string;
  dateTo?: string;
  customer?: string;
  tags?: string;
}

// ============================================================================
// Commands
// ============================================================================

export async function saveGoldAnswer(params: SaveGoldAnswerParams): Promise<number> {
  return invoke("save_gold_answer", { request: params });
}

export async function listGoldAnswers(
  limit?: number,
  offset?: number,
  customer?: string,
  tag?: string
): Promise<GoldAnswer[]> {
  return invoke("list_gold_answers", { limit, offset, customer, tag });
}

export async function searchGoldAnswers(query: string, limit?: number): Promise<GoldAnswer[]> {
  return invoke("search_gold_answers_cmd", { query, limit });
}

export async function deleteGoldAnswer(id: number): Promise<void> {
  return invoke("delete_gold_answer_cmd", { id });
}

export async function exportGoldAnswersJsonl(params: ExportGoldParams): Promise<string> {
  return invoke("export_gold_answers_jsonl", { request: params });
}
