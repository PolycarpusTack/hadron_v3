import { invoke } from "@tauri-apps/api/core";
import { getApiKey, getSetting } from "./secure-storage";

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

async function getJiraCredentials() {
  const baseUrl = (await getSetting<string>("jira.baseUrl")) ?? "";
  const email = (await getSetting<string>("jira.email")) ?? "";
  const apiToken = (await getApiKey("jira")) ?? "";
  const confluenceUrl = (await getSetting<string>("confluence.overrideUrl")) ?? undefined;
  const confluenceEmail = (await getSetting<string>("confluence.overrideEmail")) ?? undefined;
  const confluenceToken = confluenceUrl ? ((await getApiKey("confluence")) ?? undefined) : undefined;
  const whatsonKbUrl = (await getSetting<string>("investigation.whatsonKbUrl")) ?? undefined;
  const modDocsHomepageId = (await getSetting<string>("investigation.modDocsHomepageId")) ?? undefined;
  const modDocsSpacePath = (await getSetting<string>("investigation.modDocsSpacePath")) ?? undefined;
  return {
    base_url: baseUrl,
    email,
    api_token: apiToken,
    confluence_url: confluenceUrl,
    confluence_email: confluenceEmail,
    confluence_token: confluenceToken,
    whatson_kb_url: whatsonKbUrl,
    mod_docs_homepage_id: modDocsHomepageId,
    mod_docs_space_path: modDocsSpacePath,
  };
}

export async function investigateTicket(key: string): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_ticket", { key, ...creds });
}

export async function investigateRegressionFamily(key: string): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_regression_family", { key, ...creds });
}

export async function investigateExpectedBehavior(
  key: string,
  query: string
): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_expected_behavior", { key, query, ...creds });
}

export async function investigateCustomerHistory(key: string): Promise<InvestigationDossier> {
  const creds = await getJiraCredentials();
  return invoke<InvestigationDossier>("investigate_jira_customer_history", { key, ...creds });
}

export async function searchConfluence(
  query: string,
  spaceKey?: string,
  limit?: number
): Promise<ConfluenceDoc[]> {
  const creds = await getJiraCredentials();
  return invoke<ConfluenceDoc[]>("search_confluence_docs", {
    query,
    space_key: spaceKey ?? null,
    limit: limit ?? null,
    ...creds,
  });
}

export async function getConfluencePage(contentId: string): Promise<ConfluenceDoc> {
  const creds = await getJiraCredentials();
  return invoke<ConfluenceDoc>("get_confluence_page", { content_id: contentId, ...creds });
}
