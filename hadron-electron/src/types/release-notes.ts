export type ReleaseNotesContentType = "features" | "fixes" | "both";

export type ReleaseNotesStatus = "draft" | "in_review" | "approved" | "published" | "archived";

export interface ReleaseNotesConfig {
  fixVersion: string;
  contentType: ReleaseNotesContentType;
  projectKey?: string;
  jqlFilter?: string;
  moduleFilter?: string[];
  aiEnrichment: AiEnrichmentConfig;
}

export interface AiEnrichmentConfig {
  rewriteDescriptions: boolean;
  generateKeywords: boolean;
  classifyModules: boolean;
  detectBreakingChanges: boolean;
}

export interface ReleaseNotesDraft {
  id: number;
  fixVersion: string;
  contentType: string;
  title: string;
  markdownContent: string;
  originalAiContent: string | null;
  ticketKeys: string;
  ticketCount: number;
  jqlFilter: string | null;
  moduleFilter: string | null;
  aiModel: string;
  aiProvider: string;
  tokensUsed: number;
  cost: number;
  generationDurationMs: number | null;
  aiInsights: string | null;
  status: ReleaseNotesStatus;
  checklistState: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  version: number;
  parentId: number | null;
  isManualEdit: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ReleaseNotesSummary {
  id: number;
  fixVersion: string;
  contentType: string;
  title: string;
  ticketCount: number;
  status: ReleaseNotesStatus;
  version: number;
  isManualEdit: boolean;
  aiModel: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseNotesAiInsights {
  qualityScore: number;
  suggestions: string[];
  moduleBreakdown: Record<string, number>;
  ticketCoverage: number;
  breakingChanges: string[];
}

export interface ReleaseNotesProgress {
  phase: ReleaseNotesPhase;
  progress: number;
  message: string;
  requestId?: string | null;
}

export type ReleaseNotesPhase =
  | "fetching_tickets"
  | "classifying_tickets"
  | "enriching_content"
  | "generating_draft"
  | "applying_style_guide"
  | "computing_insights"
  | "saving"
  | "complete"
  | "failed";

export interface ReleaseNoteTicketPreview {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  status: string;
  components: string[];
  labels: string[];
}

export interface JiraFixVersion {
  id: string;
  name: string;
  description: string | null;
  released: boolean;
  archived: boolean;
  releaseDate: string | null;
}

export interface ReleaseNotesChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  autoDetected?: boolean;
}

export type ReleaseNotesExportFormat = "markdown" | "confluence" | "html";

export interface ComplianceReport {
  terminologyViolations: TerminologyViolation[];
  structureViolations: StructureViolation[];
  screenshotSuggestions: ScreenshotSuggestion[];
  score: number;
  tokensUsed: number;
  cost: number;
}

export interface TerminologyViolation {
  lineContext: string;
  violation: string;
  suggestedFix: string;
  ruleReference: string;
}

export interface StructureViolation {
  section: string;
  violation: string;
  suggestedFix: string;
  ruleReference: string;
}

export interface ScreenshotSuggestion {
  ticketKey: string;
  description: string;
  placementHint: string;
  inlinePlaceholder: string;
}
