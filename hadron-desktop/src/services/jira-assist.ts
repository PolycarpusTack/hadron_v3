/**
 * JIRA Assist API functions — Sprint 1 (read-only DB access).
 * Sprint 2+ will add triage, brief generation, and post-to-JIRA.
 */

import { invoke } from "@tauri-apps/api/core";

export interface TicketBrief {
  jira_key: string;
  title: string;
  customer: string | null;
  severity: string | null;  // "Critical" | "High" | "Medium" | "Low"
  category: string | null;  // "Bug" | "Feature" | "Infrastructure" | "UX" | "Performance" | "Security"
  tags: string | null;      // JSON string: '["tag1", "tag2"]'
  triage_json: string | null;
  brief_json: string | null;
  posted_to_jira: boolean;
  posted_at: string | null;
  engineer_rating: number | null;
  engineer_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Fetch a stored ticket brief by JIRA key. Returns null if not yet generated. */
export async function getTicketBrief(jiraKey: string): Promise<TicketBrief | null> {
  return invoke<TicketBrief | null>("get_ticket_brief", { jiraKey });
}

/** Delete a ticket brief and its embeddings. */
export async function deleteTicketBrief(jiraKey: string): Promise<void> {
  return invoke<void>("delete_ticket_brief", { jiraKey });
}

/** Parse tags JSON string to array. Returns [] on parse failure. */
export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    return JSON.parse(tagsJson);
  } catch {
    return [];
  }
}

/** Severity → Tailwind color class for badges. */
export const SEVERITY_COLORS: Record<string, string> = {
  Critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  High:     "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  Medium:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  Low:      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};
