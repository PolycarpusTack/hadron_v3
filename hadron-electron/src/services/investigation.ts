import { invoke } from "@tauri-apps/api/core";

export interface EvidenceClaim {
  text: string;
  category:
    | "observed_behavior"
    | "linked_context"
    | "historical_match"
    | "expected_behavior"
    | "attachment_signal"
    | "issue_comment"
    | "customer_history";
  entities: string[];
}

export interface RelatedIssue {
  key: string;
  summary: string;
  status: string;
  relation_type: "direct_link" | "project_history" | "cross_project_sibling";
  url: string;
}

export interface ConfluenceDoc {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  space_key: string | null;
}

export interface Hypothesis {
  text: string;
  confidence: "high" | "medium" | "low";
  supporting_claims: string[];
}

export interface AttachmentResult {
  filename: string;
  extracted_text: string | null;
  extraction_status: "success" | "skipped" | { failed: string };
}

export interface InvestigationDossier {
  ticket_key: string;
  ticket_summary: string;
  ticket_url: string;
  status: string;
  assignee: string | null;
  claims: EvidenceClaim[];
  related_issues: RelatedIssue[];
  confluence_docs: ConfluenceDoc[];
  hypotheses: Hypothesis[];
  open_questions: string[];
  next_checks: string[];
  attachments: AttachmentResult[];
  warnings: string[];
  investigation_type: "ticket" | "regression_family" | "expected_behavior" | "customer_history";
  investigation_status: "complete" | "partial_failure";
}

// Credentials are read from the app store on the Rust side;
// only non-sensitive args are sent over IPC.

export async function investigateTicket(key: string): Promise<InvestigationDossier> {
  return invoke<InvestigationDossier>("investigate_jira_ticket", { key });
}

export async function investigateRegressionFamily(key: string): Promise<InvestigationDossier> {
  return invoke<InvestigationDossier>("investigate_jira_regression_family", { key });
}

export async function investigateExpectedBehavior(
  key: string,
  query: string
): Promise<InvestigationDossier> {
  return invoke<InvestigationDossier>("investigate_jira_expected_behavior", { key, query });
}

export async function investigateCustomerHistory(key: string): Promise<InvestigationDossier> {
  return invoke<InvestigationDossier>("investigate_jira_customer_history", { key });
}

export async function searchConfluence(
  query: string,
  spaceKey?: string,
  limit?: number
): Promise<ConfluenceDoc[]> {
  return invoke<ConfluenceDoc[]>("search_confluence_docs", {
    query,
    spaceKey: spaceKey ?? null,
    limit: limit ?? null,
  });
}

export async function getConfluencePage(contentId: string): Promise<ConfluenceDoc> {
  return invoke<ConfluenceDoc>("get_confluence_page", { contentId });
}
