import { api } from "./api";

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
  extraction_status:
    | "success"
    | "skipped"
    | { failed: string };
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
  investigation_type:
    | "ticket"
    | "regression_family"
    | "expected_behavior"
    | "customer_history";
  investigation_status: "complete" | "partial_failure";
}

export const investigationService = {
  async investigateTicket(ticketKey: string): Promise<InvestigationDossier> {
    return api.post("/investigation/ticket", { ticket_key: ticketKey });
  },

  async investigateRegressionFamily(ticketKey: string): Promise<InvestigationDossier> {
    return api.post("/investigation/regression-family", { ticket_key: ticketKey });
  },

  async investigateExpectedBehavior(
    query: string,
    ticketKey?: string
  ): Promise<InvestigationDossier> {
    return api.post("/investigation/expected-behavior", {
      ticket_key: ticketKey ?? "",
      query,
    });
  },

  async investigateCustomerHistory(ticketKey: string): Promise<InvestigationDossier> {
    return api.post("/investigation/customer-history", { ticket_key: ticketKey });
  },

  async searchConfluence(
    query: string,
    options?: { spaceKey?: string; limit?: number }
  ): Promise<ConfluenceDoc[]> {
    return api.post("/confluence/search", {
      query,
      space_key: options?.spaceKey,
      limit: options?.limit,
    });
  },

  async getConfluencePage(contentId: string): Promise<ConfluenceDoc> {
    return api.get(`/confluence/content/${contentId}`);
  },
};
