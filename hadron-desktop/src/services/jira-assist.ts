/**
 * JIRA Assist API functions — Sprints 1-7.
 * Sprint 1: read-only DB access. Sprint 2: AI triage. Sprint 3: Investigation brief.
 * Sprint 4: duplicate detection. Sprint 5: JIRA round-trip. Sprint 7: background poller.
 * Sprint 4: duplicate detection. Sprint 5: JIRA round-trip + engineer feedback.
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

export interface JiraTriageResult {
  severity: string;        // "Critical" | "High" | "Medium" | "Low"
  category: string;        // "Bug" | "Feature" | "Infrastructure" | "UX" | "Performance" | "Security"
  customer_impact: string;
  tags: string[];
  confidence: string;      // "High" | "Medium" | "Low"
  rationale: string;
}

// ─── Brief types — re-exported from api.ts to avoid divergence ───────────────

export type {
  JiraDeepTicketQuality,
  JiraDeepTechnical,
  JiraDeepRecommendedAction,
  JiraDeepRisk,
  JiraDeepResult as JiraDeepAnalysis,
} from "./api";
import type { JiraDeepResult } from "./api";

export interface JiraBriefResult {
  triage: JiraTriageResult;
  analysis: JiraDeepResult;
}

/** Fetch a stored ticket brief by JIRA key. Returns null if not yet generated. */
export async function getTicketBrief(jiraKey: string): Promise<TicketBrief | null> {
  return invoke<TicketBrief | null>("get_ticket_brief", { jiraKey });
}

/** Fetch multiple ticket briefs in a single query. Returns only keys that have stored briefs. */
export async function getTicketBriefsBatch(jiraKeys: string[]): Promise<TicketBrief[]> {
  if (jiraKeys.length === 0) return [];
  return invoke<TicketBrief[]>("get_ticket_briefs_batch", { jiraKeys });
}

/** Fetch all ticket briefs for the history view. */
export async function getAllTicketBriefs(): Promise<TicketBrief[]> {
  return invoke<TicketBrief[]>("get_all_ticket_briefs");
}

/** Delete a ticket brief and its embeddings. */
export async function deleteTicketBrief(jiraKey: string): Promise<void> {
  return invoke<void>("delete_ticket_brief", { jiraKey });
}

/** Run AI triage on a JIRA ticket and persist the result. */
export async function triageJiraTicket(params: {
  jiraKey: string;
  title: string;
  description: string;
  issueType: string;
  priority?: string;
  status?: string;
  components: string[];
  labels: string[];
  comments: string[];
  // apiKey intentionally omitted — Rust command reads it from the encrypted store.
  model: string;
  provider: string;
}): Promise<JiraTriageResult> {
  return invoke<JiraTriageResult>("triage_jira_ticket", {
    request: {
      jira_key: params.jiraKey,
      title: params.title,
      description: params.description,
      issue_type: params.issueType,
      priority: params.priority,
      status: params.status,
      components: params.components,
      labels: params.labels,
      comments: params.comments,
      model: params.model,
      provider: params.provider,
    },
  });
}

/** Generate a full investigation brief (triage + deep analysis in parallel). */
export async function generateTicketBrief(params: {
  jiraKey: string;
  title: string;
  description: string;
  issueType: string;
  priority?: string;
  status?: string;
  components: string[];
  labels: string[];
  comments: string[];
  // apiKey intentionally omitted — Rust command reads it from the encrypted store.
  model: string;
  provider: string;
}): Promise<JiraBriefResult> {
  return invoke<JiraBriefResult>("generate_ticket_brief", {
    request: {
      jira_key:    params.jiraKey,
      title:       params.title,
      description: params.description,
      issue_type:  params.issueType,
      priority:    params.priority,
      status:      params.status,
      components:  params.components,
      labels:      params.labels,
      comments:    params.comments,
      model:       params.model,
      provider:    params.provider,
    },
  });
}

// ─── Similar Tickets (Sprint 4) ─────────────────────────────────────────────

export interface SimilarTicket {
  jira_key: string;
  title: string;
  similarity: number;
  severity: string | null;
  category: string | null;
}

/** Find semantically similar tickets using embedding cosine similarity. */
export async function findSimilarTickets(params: {
  jiraKey: string;
  title: string;
  description: string;
  apiKey: string;
  threshold?: number;
  limit?: number;
}): Promise<SimilarTicket[]> {
  return invoke<SimilarTicket[]>("find_similar_tickets", {
    jiraKey: params.jiraKey,
    title: params.title,
    description: params.description,
    apiKey: params.apiKey,
    threshold: params.threshold,
    limit: params.limit,
  });
}

// ─── JIRA Round-Trip (Sprint 5) ─────────────────────────────────────────────

/** Post a condensed investigation brief to JIRA as a wiki-markup comment. */
export async function postBriefToJira(params: {
  jiraKey: string;
  briefJson: string;
  baseUrl: string;
  email: string;
  apiToken: string;
}): Promise<void> {
  return invoke<void>("post_brief_to_jira", {
    jiraKey: params.jiraKey,
    briefJson: params.briefJson,
    baseUrl: params.baseUrl,
    email: params.email,
    apiToken: params.apiToken,
  });
}

/** Submit engineer feedback (star rating + notes) for a ticket brief. */
export async function submitEngineerFeedback(params: {
  jiraKey: string;
  rating: number | null;
  notes: string | null;
}): Promise<void> {
  return invoke<void>("submit_engineer_feedback", {
    jiraKey: params.jiraKey,
    rating: params.rating,
    notes: params.notes,
  });
}

// ─── Background Poller (Sprint 7) ────────────────────────────────────────────

export interface PollerStatus {
  running: boolean;
  last_polled_at: string | null;
  tickets_triaged_total: number;
  interval_mins: number;
}

/** Start the background poller. Restarts if already running. */
export async function startPoller(): Promise<void> {
  return invoke<void>("start_poller");
}

/** Stop the background poller. */
export async function stopPoller(): Promise<void> {
  return invoke<void>("stop_poller");
}

/** Get current poller status. */
export async function getPollerStatus(): Promise<PollerStatus> {
  return invoke<PollerStatus>("get_poller_status");
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

/** Category → Tailwind color class for badges (dark-mode friendly). */
export const CATEGORY_COLORS: Record<string, string> = {
  Bug:            "bg-red-500/15 text-red-300 border-red-500/30",
  Feature:        "bg-blue-500/15 text-blue-300 border-blue-500/30",
  Infrastructure: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  UX:             "bg-pink-500/15 text-pink-300 border-pink-500/30",
  Performance:    "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Security:       "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

/** Severity → Tailwind color class (dark-mode, for use in TriageBadgePanel). */
export const SEVERITY_BADGE: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-300 border-red-500/40",
  High:     "bg-orange-500/20 text-orange-300 border-orange-500/40",
  Medium:   "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  Low:      "bg-green-500/20 text-green-300 border-green-500/40",
};

/** Confidence → Tailwind text color. */
export const CONFIDENCE_COLOR: Record<string, string> = {
  High:   "text-green-400",
  Medium: "text-yellow-400",
  Low:    "text-red-400",
};
