/**
 * API client for Hadron Web — replaces Tauri's invoke() IPC.
 *
 * All methods:
 *   1. Acquire an Azure AD token via MSAL
 *   2. Call the REST API with Authorization: Bearer <token>
 *   3. Return typed responses
 *
 * For streaming (chat), use fetchSSE() which returns an EventSource-like reader.
 */

import { acquireToken } from "../auth/msal";

const API_BASE = "/api";
const DEV_MODE = import.meta.env.VITE_AUTH_MODE === "dev";

// ============================================================================
// Types (mirrors hadron-core models)
// ============================================================================

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: "analyst" | "lead" | "admin";
  teamName: string | null;
}

export interface AnalysisSummary {
  id: number;
  filename: string;
  errorType: string | null;
  severity: string | null;
  component: string | null;
  confidence: string | null;
  isFavorite: boolean;
  analyzedAt: string;
}

export interface Analysis extends AnalysisSummary {
  userId: string;
  fileSizeKb: number | null;
  errorMessage: string | null;
  stackTrace: string | null;
  rootCause: string | null;
  suggestedFixes: string[] | null;
  aiModel: string | null;
  aiProvider: string | null;
  tokensUsed: number | null;
  cost: number | null;
  analysisDurationMs: number | null;
  viewCount: number;
  errorSignature: string | null;
  fullData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatStreamEvent {
  type: "token" | "toolUse" | "toolResult" | "done" | "error";
  content?: string;
  toolName?: string;
  args?: string;
  sessionId?: string;
  message?: string;
}

export interface TeamAnalysisSummary extends AnalysisSummary {
  analystName: string;
}

export interface AuditLogEntry {
  id: number;
  userId: string;
  userName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface ReleaseNote {
  id: number;
  userId: string;
  title: string;
  version: string | null;
  content: string;
  format: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  aiInsights: AiInsights | null;
  status: string | null;
  checklistState: ChecklistItem[] | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  markdownContent: string | null;
}

export interface SimilarAnalysis {
  id: number;
  filename: string;
  errorType: string | null;
  severity: string | null;
  similarity: number;
}

export interface OpenSearchHit {
  index: string;
  id: string;
  score: number | null;
  source: Record<string, unknown>;
}

export interface OpenSearchResponse {
  total: number;
  hits: OpenSearchHit[];
  tookMs: number;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string | null;
  issueType: string;
  assignee: string | null;
  created: string;
  updated: string;
  url: string;
}

export interface JiraTicketResult {
  key: string;
  url: string;
  id: string;
}

export interface ApiError {
  error: string;
  code: string;
}

// ============================================================================
// New feature types
// ============================================================================

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  usageCount: number;
  createdAt: string;
}

export interface AnalysisNote {
  id: number;
  analysisId: number;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisFeedback {
  id: number;
  analysisId: number;
  userId: string;
  feedbackType: string;
  fieldName: string | null;
  originalValue: string | null;
  correctedValue: string | null;
  rating: number | null;
  comment: string | null;
  createdAt: string;
}

export interface FeedbackSummary {
  thumbsUp: number;
  thumbsDown: number;
  corrections: number;
  averageRating: number | null;
}

export interface GoldAnalysis {
  id: number;
  analysisId: number;
  promotedBy: string;
  verifiedBy: string | null;
  verificationStatus: string;
  verificationNotes: string | null;
  qualityScore: number | null;
  promotedAt: string;
  verifiedAt: string | null;
  filename: string | null;
  errorType: string | null;
  severity: string | null;
  promoterName: string | null;
}

export interface CrashSignatureInfo {
  hash: string;
  canonical: string;
  components: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  linkedTicketId: string | null;
  linkedTicketUrl: string | null;
  status: string;
}

export interface AnalyticsDashboard {
  totalAnalyses: number;
  thisWeek: number;
  thisMonth: number;
  severityDistribution: { label: string; count: number }[];
  componentDistribution: { label: string; count: number }[];
  errorTypeTop: { label: string; count: number }[];
  dailyTrend: { date: string; count: number }[];
}

export interface PatternRule {
  id: string;
  name: string;
  pattern: string;
  patternType: string;
  severity: string | null;
  component: string | null;
  description: string | null;
  enabled: boolean;
}

export interface PatternMatch {
  ruleId: string;
  ruleName: string;
  severity: string | null;
  component: string | null;
}

export interface BulkResult {
  affected: number;
}

export interface AiConfigStatus {
  provider: string;
  modelOpenai: string;
  modelAnthropic: string;
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
}

export interface AiConfigTestResult {
  success: boolean;
  provider?: string;
  model?: string;
  error?: string;
}

// ============================================================================
// Code Analysis Types
// ============================================================================

export interface CodeAnalysisResult {
  summary: string;
  issues: CodeIssue[];
  walkthrough: WalkthroughSection[];
  optimizedCode: string | null;
  qualityScores: CodeQualityScores;
  glossary: GlossaryTerm[];
}

export interface CodeIssue {
  id: number;
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "error" | "best-practice";
  line: number;
  title: string;
  description: string;
  technical: string;
  fix: string;
  complexity: string;
  impact: string;
}

export interface WalkthroughSection {
  lines: string;
  title: string;
  code: string;
  whatItDoes: string;
  whyItMatters: string;
  evidence: string;
  dependencies: CodeDependency[];
  impact: string;
  testability: string;
  eli5: string;
  quality: string;
}

export interface CodeDependency {
  name: string;
  type: string;
  note: string;
}

export interface CodeQualityScores {
  overall: number;
  security: number;
  performance: number;
  maintainability: number;
  bestPractices: number;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}

// ============================================================================
// JIRA Deep Analysis Types
// ============================================================================

export interface JiraTicketDetail {
  key: string;
  summary: string;
  description: string;
  issueType: string;
  priority: string | null;
  status: string;
  components: string[];
  labels: string[];
  comments: string[];
  url: string;
}

export interface JiraDeepResult {
  plain_summary: string;
  quality: {
    score: number;
    verdict: string;
    strengths: string[];
    gaps: string[];
  };
  technical: {
    root_cause: string;
    affected_areas: string[];
    error_type: string;
    severity_estimate: string;
    confidence: string;
    confidence_rationale: string;
  };
  open_questions: string[];
  recommended_actions: {
    priority: string;
    action: string;
    rationale: string;
  }[];
  risk: {
    user_impact: string;
    blast_radius: string;
    urgency: string;
    do_nothing_risk: string;
  };
}

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

// ============================================================================
// JIRA Triage & Brief Types
// ============================================================================

export interface JiraTriageResult {
  severity: string;
  category: string;
  customer_impact: string;
  tags: string[];
  confidence: string;
  rationale: string;
}

export interface JiraBriefResult {
  triage: JiraTriageResult;
  analysis: JiraDeepResult;
}

export interface TicketBriefRow {
  jiraKey: string;
  title: string;
  severity: string | null;
  category: string | null;
  tags: string | null;
  triageJson: string | null;
  briefJson: string | null;
  postedToJira: boolean;
  postedAt: string | null;
  engineerRating: number | null;
  engineerNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimilarTicketMatch {
  jiraKey: string;
  title: string;
  similarity: number;
  severity: string | null;
  category: string | null;
}

// ============================================================================
// JIRA Poller Types
// ============================================================================

export interface PollerConfigStatus {
  running: boolean;
  enabled: boolean;
  jqlFilter: string;
  intervalMins: number;
  jiraBaseUrl: string;
  jiraEmail: string;
  hasApiToken: boolean;
  lastPolledAt: string | null;
}

// ── Release Notes AI Generation Types ─────────────────────────────────

export interface JiraFixVersion {
  id: string;
  name: string;
  released: boolean;
  releaseDate: string | null;
}

export interface ReleaseNotesGenerateRequest {
  fixVersion: string;
  contentType: 'features' | 'fixes' | 'both';
  projectKey?: string;
  jqlFilter?: string;
  moduleFilter?: string[];
  enrichment: {
    rewriteDescriptions: boolean;
    generateKeywords: boolean;
    classifyModules: boolean;
    detectBreakingChanges: boolean;
  };
}

export interface ReleaseNoteTicketPreview {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  status: string;
  components: string[];
  labels: string[];
}

export interface AiInsights {
  qualityScore: number;
  suggestions: string[];
  moduleBreakdown: Record<string, number>;
  ticketCoverage: number;
  breakingChanges: string[];
}

export interface StyleGuideResponse {
  content: string;
  isCustom: boolean;
}

// ── Release Notes Review & Compliance Types ───────────────────────────

export interface ComplianceReport {
  terminologyViolations: TerminologyViolation[];
  structureViolations: StructureViolation[];
  screenshotSuggestions: ScreenshotSuggestion[];
  score: number;
}

export interface TerminologyViolation {
  term: string;
  correctTerm: string;
  context: string;
  suggestion: string;
}

export interface StructureViolation {
  rule: string;
  description: string;
  location: string;
  suggestion: string;
}

export interface ScreenshotSuggestion {
  location: string;
  description: string;
  reason: string;
}

export interface ChecklistItem {
  item: string;
  checked: boolean;
}

export interface ChecklistResponse {
  items: ChecklistItem[];
  complete: boolean;
}

export interface ChecklistConfigResponse {
  items: string[];
  isCustom: boolean;
}

// ============================================================================
// Export Types
// ============================================================================

export interface ExportSection {
  id: string;
  label: string;
  content: string;
}

export type ExportFormat = 'markdown' | 'html' | 'interactive_html' | 'json' | 'txt';

export interface GenericExportRequest {
  title: string;
  sourceType: string;
  audience?: string;
  sections: ExportSection[];
  footer?: string;
  format: ExportFormat;
}

// ============================================================================
// Confluence Types
// ============================================================================

export interface ConfluencePageResult {
  id: string;
  url: string;
  created: boolean;
}

export interface ConfluenceConfig {
  spaceKey: string;
  parentPageId: string;
  configured: boolean;
}

// ============================================================================
// Sentry Analysis Types
// ============================================================================

export interface SentryConfigStatus {
  baseUrl: string;
  organization: string;
  hasAuthToken: boolean;
  configured: boolean;
}

export interface UpdateSentryConfigRequest {
  baseUrl?: string;
  organization?: string;
  authToken?: string;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
}

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string | null;
  level: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
  shortId?: string;
  platform?: string | null;
  userCount?: number | null;
  permalink?: string | null;
}

export interface SentryAnalysisSummary {
  id: number;
  filename: string;
  errorType: string | null;
  severity: string | null;
  confidence: string | null;
  component: string | null;
  analyzedAt: string;
}

export interface SentryAnalysisResult {
  errorType: string;
  errorMessage: string;
  severity: string;
  rootCause: string;
  suggestedFixes: string[];
  component: string;
  confidence: string;
  patternType: string;
  userImpact: string;
  breadcrumbAnalysis: string;
  recommendations: SentryRecommendation[];
}

export interface SentryRecommendation {
  priority: string;
  title: string;
  description: string;
  effort: string;
  codeSnippet: string | null;
}

export interface DetectedPattern {
  patternType: string;
  confidence: number;
  evidence: string[];
}

export interface SentryBreadcrumb {
  timestamp: string | null;
  category: string | null;
  message: string | null;
  level: string | null;
  data: Record<string, unknown> | null;
  type: string | null;
}

export interface SentryException {
  type: string | null;
  value: string | null;
  module: string | null;
  stacktrace: SentryFrame[] | null;
}

export interface SentryFrame {
  filename: string | null;
  function: string | null;
  lineNo: number | null;
  colNo: number | null;
  contextLine: string | null;
  inApp: boolean | null;
  module: string | null;
}

export interface SentryTag {
  key: string;
  value: string;
}

export interface SentryAnalysisFullData {
  issue: SentryIssue;
  event: {
    breadcrumbs: SentryBreadcrumb[];
    exceptions: SentryException[];
    tags: SentryTag[];
    contexts: Record<string, unknown>;
  };
  patterns: DetectedPattern[];
  aiResult: SentryAnalysisResult;
}

export interface SentryAnalysisDetail {
  id: number;
  filename: string;
  errorType: string | null;
  severity: string | null;
  fullData: SentryAnalysisFullData | null;
  analyzedAt: string;
}

// ── RAG/Search Types ──────────────────────────────────────────────────

export interface SearchHitResult {
  id: string;
  title: string;
  content: string;
  score: number;
  source: string;
  metadata: Record<string, string>;
}

export interface EmbeddingStatus {
  totalAnalyses: number;
  embedded: number;
  coverage: number;
}

export interface BackfillResult {
  processed: number;
  skipped: number;
  errors: number;
}

// ── Performance Analyzer Types ────────────────────────────────────────

export interface PerformanceTraceResult {
  filename: string;
  user: string | null;
  timestamp: string | null;
  header: PerformanceHeader;
  derived: PerfDerivedMetrics;
  processes: ProcessInfo[];
  topMethods: TopMethod[];
  patterns: PerfDetectedPattern[];
  scenario: UserScenario;
  recommendations: PerfRecommendation[];
  overallSeverity: string;
  summary: string;
}

export interface PerformanceHeader {
  samples: number; avgMsPerSample: number;
  scavenges: number; incGcs: number;
  stackSpills: number; markStackOverflows: number;
  weakListOverflows: number; jitCacheSpills: number;
  activeTime: number; otherProcesses: number;
  realTime: number; profilingOverhead: number;
}

export interface PerfDerivedMetrics {
  cpuUtilization: number; activityRatio: number;
  sampleDensity: number; gcPressure: number;
}

export interface ProcessInfo {
  name: string; priority: string;
  percentage: number; status: string;
}

export interface TopMethod {
  method: string; category: string; percentage: number;
}

export interface PerfDetectedPattern {
  patternType: string; severity: string;
  title: string; description: string; confidence: number;
}

export interface UserScenario {
  trigger: string; action: string; context: string;
  impactPercentage: number; contributingFactors: string[];
}

export interface PerfRecommendation {
  recType: string; title: string; priority: string;
  description: string; effort: string;
}

export interface PerformanceAnalysisSummary {
  id: number; filename: string; severity: string | null;
  component: string | null; analyzedAt: string;
}

// ============================================================================
// HTTP helpers
// ============================================================================

class ApiClient {
  private async headers(): Promise<HeadersInit> {
    if (DEV_MODE) {
      return {
        "Content-Type": "application/json",
        Authorization: "Bearer dev",
      };
    }
    try {
      const token = await acquireToken();
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
    } catch {
      // No token available — return headers without auth (will 401)
      return { "Content-Type": "application/json" };
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = await this.headers();
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "UNKNOWN",
      }));
      throw new HadronApiError(response.status, error.error, error.code);
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // === Auth ===

  async getMe(): Promise<UserProfile> {
    return this.request("GET", "/me");
  }

  // === Analyses ===

  async uploadAndAnalyze(
    file: File,
    apiKey: string,
    model = "gpt-4o",
    provider = "openai",
  ): Promise<Analysis> {
    const token = DEV_MODE ? "dev" : await acquireToken();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("api_key", apiKey);
    formData.append("model", model);
    formData.append("provider", provider);

    const response = await fetch(`${API_BASE}/analyses/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "UNKNOWN",
      }));
      throw new HadronApiError(response.status, error.error, error.code);
    }

    return response.json();
  }

  async analyzeContent(
    content: string,
    apiKey: string,
    options?: {
      filename?: string;
      model?: string;
      provider?: string;
      analysisMode?: string;
    },
  ): Promise<Analysis> {
    return this.request("POST", "/analyses/analyze", {
      content,
      apiKey,
      filename: options?.filename,
      model: options?.model || "gpt-4o",
      provider: options?.provider || "openai",
      analysisMode: options?.analysisMode,
    });
  }

  async getAnalyses(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<AnalysisSummary>> {
    return this.request(
      "GET",
      `/analyses?limit=${limit}&offset=${offset}`,
    );
  }

  async getAnalysis(id: number): Promise<Analysis> {
    return this.request("GET", `/analyses/${id}`);
  }

  async deleteAnalysis(id: number): Promise<void> {
    return this.request("DELETE", `/analyses/${id}`);
  }

  async toggleFavorite(id: number): Promise<{ isFavorite: boolean }> {
    return this.request("POST", `/analyses/${id}/favorite`);
  }

  async searchAnalyses(
    q: string,
    limit = 50,
  ): Promise<AnalysisSummary[]> {
    return this.request("POST", "/analyses/search", { q, limit });
  }

  // === Embeddings / RAG ===

  async embedAnalysis(
    id: number,
    apiKey: string,
  ): Promise<{ embeddingId: number }> {
    return this.request("POST", `/analyses/${id}/embed`, { apiKey });
  }

  async getSimilarAnalyses(
    id: number,
    options?: { limit?: number; threshold?: number },
  ): Promise<SimilarAnalysis[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.threshold)
      params.set("threshold", options.threshold.toString());
    const qs = params.toString();
    return this.request(
      "GET",
      `/analyses/${id}/similar${qs ? `?${qs}` : ""}`,
    );
  }

  // === Chat ===

  async getChatSessions(): Promise<ChatSession[]> {
    return this.request("GET", "/chat/sessions");
  }

  async createChatSession(title?: string): Promise<ChatSession> {
    return this.request("POST", "/chat/sessions", { title });
  }

  async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.request("GET", `/chat/sessions/${sessionId}/messages`);
  }

  /**
   * Send a chat message with SSE streaming response.
   *
   * Returns an async iterator of ChatStreamEvents.
   */
  async *chatStream(
    messages: ChatMessage[],
    options?: {
      sessionId?: string;
      model?: string;
      provider?: string;
      apiKey?: string;
      useRag?: boolean;
    },
  ): AsyncGenerator<ChatStreamEvent> {
    const headers = await this.headers();
    const response = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: {
        ...headers,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        messages,
        sessionId: options?.sessionId,
        model: options?.model,
        provider: options?.provider,
        apiKey: options?.apiKey || "",
        useRag: options?.useRag,
      }),
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "UNKNOWN",
      }));
      throw new HadronApiError(response.status, error.error, error.code);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data) {
            try {
              yield JSON.parse(data) as ChatStreamEvent;
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    }
  }

  // === Settings ===

  async getSettings(): Promise<Record<string, unknown>> {
    return this.request("GET", "/settings");
  }

  async updateSettings(settings: Record<string, unknown>): Promise<void> {
    return this.request("PUT", "/settings", settings);
  }

  // === Release Notes ===

  async getReleaseNotes(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<ReleaseNote>> {
    return this.request(
      "GET",
      `/release-notes?limit=${limit}&offset=${offset}`,
    );
  }

  async createReleaseNote(note: {
    title: string;
    version?: string;
    content: string;
    format?: string;
  }): Promise<ReleaseNote> {
    return this.request("POST", "/release-notes", note);
  }

  async getReleaseNote(id: number): Promise<ReleaseNote> {
    return this.request("GET", `/release-notes/${id}`);
  }

  async updateReleaseNote(
    id: number,
    updates: {
      title?: string;
      version?: string;
      content?: string;
      format?: string;
    },
  ): Promise<ReleaseNote> {
    return this.request("PUT", `/release-notes/${id}`, updates);
  }

  async deleteReleaseNote(id: number): Promise<void> {
    return this.request("DELETE", `/release-notes/${id}`);
  }

  async publishReleaseNote(id: number): Promise<ReleaseNote> {
    return this.request("POST", `/release-notes/${id}/publish`);
  }

  // === Team (lead+) ===

  async getTeamAnalyses(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<TeamAnalysisSummary>> {
    return this.request(
      "GET",
      `/team/analyses?limit=${limit}&offset=${offset}`,
    );
  }

  // === OpenSearch ===

  async searchOpenSearch(
    url: string,
    index: string,
    query: string,
    options?: {
      username?: string;
      password?: string;
      size?: number;
      from?: number;
    },
  ): Promise<OpenSearchResponse> {
    return this.request("POST", "/search/opensearch", {
      url,
      index,
      query,
      username: options?.username,
      password: options?.password,
      size: options?.size || 20,
      from: options?.from || 0,
    });
  }

  async testOpenSearch(
    url: string,
    username?: string,
    password?: string,
  ): Promise<{ connected: boolean }> {
    return this.request("POST", "/search/opensearch/test", {
      url,
      username,
      password,
    });
  }

  // === Jira ===

  async createJiraTicket(
    credentials: {
      baseUrl: string;
      email: string;
      apiToken: string;
      projectKey: string;
    },
    ticket: {
      summary: string;
      description: string;
      priority?: string;
      labels?: string[];
      issueType?: string;
      analysisId?: number;
    },
  ): Promise<JiraTicketResult> {
    return this.request("POST", "/jira/tickets", {
      credentials,
      ...ticket,
    });
  }

  async searchJira(
    projectKey: string,
    options?: {
      jql?: string;
      text?: string;
      maxResults?: number;
    },
  ): Promise<{ issues: JiraIssue[]; total: number }> {
    return this.request("POST", "/jira/search", {
      projectKey,
      ...options,
    });
  }

  async testJira(
    baseUrl: string,
    email: string,
    apiToken: string,
  ): Promise<{ connected: boolean }> {
    return this.request("POST", "/jira/test", {
      baseUrl,
      email,
      apiToken,
    });
  }

  // === JIRA Deep Analysis ===

  async fetchJiraIssueDetail(
    key: string,
  ): Promise<JiraTicketDetail> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/detail`, {});
  }

  async analyzeJiraIssue(
    key: string,
  ): Promise<JiraDeepResult> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/analyze`, {});
  }

  // === JIRA Triage & Brief ===

  async triageJiraIssue(
    key: string,
  ): Promise<JiraTriageResult> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/triage`, {});
  }

  async generateJiraBrief(
    key: string,
  ): Promise<JiraBriefResult> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/brief`, {});
  }

  async getTicketBrief(key: string): Promise<TicketBriefRow | null> {
    try {
      return await this.request("GET", `/jira/briefs/${encodeURIComponent(key)}`);
    } catch (e) {
      if (e instanceof HadronApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async getTicketBriefsBatch(keys: string[]): Promise<TicketBriefRow[]> {
    if (keys.length === 0) return [];
    return this.request("POST", "/jira/briefs/batch", { jiraKeys: keys });
  }

  async deleteTicketBrief(key: string): Promise<void> {
    return this.request("DELETE", `/jira/briefs/${encodeURIComponent(key)}`);
  }

  // === JIRA Similar Tickets + Round-Trip ===

  async findSimilarTickets(
    key: string,
    threshold?: number,
    limit?: number,
  ): Promise<SimilarTicketMatch[]> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/similar`, {
      threshold,
      limit,
    });
  }

  async postBriefToJira(
    key: string,
  ): Promise<void> {
    return this.request("POST", `/jira/issues/${encodeURIComponent(key)}/post-brief`);
  }

  async submitEngineerFeedback(
    key: string,
    rating?: number,
    notes?: string,
  ): Promise<void> {
    return this.request("PUT", `/jira/briefs/${encodeURIComponent(key)}/feedback`, {
      rating,
      notes,
    });
  }

  // === JIRA Poller (Admin) ===

  async getPollerConfig(): Promise<PollerConfigStatus> {
    return this.request("GET", "/admin/jira-poller");
  }

  async updatePollerConfig(config: {
    enabled?: boolean;
    jqlFilter?: string;
    intervalMins?: number;
    jiraBaseUrl?: string;
    jiraEmail?: string;
    jiraApiToken?: string;
  }): Promise<void> {
    return this.request("PUT", "/admin/jira-poller", config);
  }

  async startPoller(): Promise<void> {
    return this.request("POST", "/admin/jira-poller/start");
  }

  async stopPoller(): Promise<void> {
    return this.request("POST", "/admin/jira-poller/stop");
  }

  // === JIRA Subscriptions ===

  async getUserSubscriptions(): Promise<string[]> {
    return this.request("GET", "/jira/subscriptions");
  }

  async setUserSubscriptions(projectKeys: string[]): Promise<string[]> {
    return this.request("PUT", "/jira/subscriptions", { projectKeys });
  }

  // === Admin ===

  async listUsers(): Promise<UserProfile[]> {
    return this.request("GET", "/admin/users");
  }

  async updateUserRole(
    userId: string,
    role: "analyst" | "lead" | "admin",
  ): Promise<void> {
    return this.request("PUT", `/admin/users/${userId}/role`, { role });
  }

  async getAllAnalyses(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<TeamAnalysisSummary>> {
    return this.request(
      "GET",
      `/admin/analyses?limit=${limit}&offset=${offset}`,
    );
  }

  async getAuditLog(
    options?: {
      limit?: number;
      offset?: number;
      action?: string;
    },
  ): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", options.limit.toString());
    if (options?.offset) params.set("offset", options.offset.toString());
    if (options?.action) params.set("action", options.action);
    const qs = params.toString();
    return this.request("GET", `/admin/audit-log${qs ? `?${qs}` : ""}`);
  }

  // === AI Config (Admin) ===

  async getAiConfigStatus(): Promise<AiConfigStatus> {
    return this.request("GET", "/admin/ai-config");
  }

  async updateAiConfig(config: {
    provider?: string;
    modelOpenai?: string;
    modelAnthropic?: string;
    apiKeyOpenai?: string;
    apiKeyAnthropic?: string;
  }): Promise<void> {
    return this.request("PUT", "/admin/ai-config", config);
  }

  async testAiConfig(): Promise<AiConfigTestResult> {
    return this.request("POST", "/admin/ai-config/test");
  }

  // === Tags ===

  async listTags(): Promise<Tag[]> {
    return this.request("GET", "/tags");
  }

  async createTag(name: string, color?: string): Promise<Tag> {
    return this.request("POST", "/tags", { name, color });
  }

  async updateTag(id: number, updates: { name?: string; color?: string }): Promise<Tag> {
    return this.request("PUT", `/tags/${id}`, updates);
  }

  async deleteTag(id: number): Promise<void> {
    return this.request("DELETE", `/tags/${id}`);
  }

  async getAnalysisTags(analysisId: number): Promise<Tag[]> {
    return this.request("GET", `/analyses/${analysisId}/tags`);
  }

  async setAnalysisTags(analysisId: number, tagIds: number[]): Promise<Tag[]> {
    return this.request("PUT", `/analyses/${analysisId}/tags`, { tagIds });
  }

  // === Notes ===

  async getAnalysisNotes(analysisId: number): Promise<AnalysisNote[]> {
    return this.request("GET", `/analyses/${analysisId}/notes`);
  }

  async createNote(analysisId: number, content: string): Promise<AnalysisNote> {
    return this.request("POST", `/analyses/${analysisId}/notes`, { content });
  }

  async updateNote(noteId: number, content: string): Promise<AnalysisNote> {
    return this.request("PUT", `/notes/${noteId}`, { content });
  }

  async deleteNote(noteId: number): Promise<void> {
    return this.request("DELETE", `/notes/${noteId}`);
  }

  // === Archive & Restore ===

  async getArchivedAnalyses(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<AnalysisSummary>> {
    return this.request("GET", `/analyses/archived?limit=${limit}&offset=${offset}`);
  }

  async restoreAnalysis(id: number): Promise<void> {
    return this.request("POST", `/analyses/${id}/restore`);
  }

  async permanentDeleteAnalysis(id: number): Promise<void> {
    return this.request("DELETE", `/analyses/${id}/permanent`);
  }

  // === Signatures ===

  async listSignatures(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<CrashSignatureInfo>> {
    return this.request("GET", `/signatures?limit=${limit}&offset=${offset}`);
  }

  async getSignature(hash: string): Promise<CrashSignatureInfo> {
    return this.request("GET", `/signatures/${hash}`);
  }

  async getSignatureAnalyses(hash: string): Promise<AnalysisSummary[]> {
    return this.request("GET", `/signatures/${hash}/analyses`);
  }

  async updateSignatureStatus(hash: string, status: string): Promise<void> {
    return this.request("PUT", `/signatures/${hash}/status`, { status });
  }

  async linkSignatureTicket(
    hash: string,
    ticketId?: string,
    ticketUrl?: string,
  ): Promise<void> {
    return this.request("PUT", `/signatures/${hash}/ticket`, { ticketId, ticketUrl });
  }

  // === Feedback ===

  async submitFeedback(
    analysisId: number,
    feedback: {
      feedbackType: string;
      fieldName?: string;
      originalValue?: string;
      correctedValue?: string;
      rating?: number;
      comment?: string;
    },
  ): Promise<AnalysisFeedback> {
    return this.request("POST", `/analyses/${analysisId}/feedback`, feedback);
  }

  async getAnalysisFeedback(analysisId: number): Promise<AnalysisFeedback[]> {
    return this.request("GET", `/analyses/${analysisId}/feedback`);
  }

  async getFeedbackSummary(analysisId: number): Promise<FeedbackSummary> {
    return this.request("GET", `/analyses/${analysisId}/feedback/summary`);
  }

  async deleteFeedback(feedbackId: number): Promise<void> {
    return this.request("DELETE", `/feedback/${feedbackId}`);
  }

  // === Gold Standard ===

  async promoteToGold(
    analysisId: number,
    qualityScore?: number,
  ): Promise<GoldAnalysis> {
    return this.request("POST", `/analyses/${analysisId}/gold`, { qualityScore });
  }

  async demoteGold(analysisId: number): Promise<void> {
    return this.request("DELETE", `/analyses/${analysisId}/gold`);
  }

  async listGold(
    limit = 50,
    offset = 0,
  ): Promise<PaginatedResponse<GoldAnalysis>> {
    return this.request("GET", `/gold?limit=${limit}&offset=${offset}`);
  }

  async verifyGold(
    goldId: number,
    status: string,
    notes?: string,
    qualityScore?: number,
  ): Promise<GoldAnalysis> {
    return this.request("POST", `/gold/${goldId}/verify`, { status, notes, qualityScore });
  }

  // === Advanced Search ===

  async advancedSearch(params: {
    q?: string;
    severity?: string[];
    component?: string[];
    tags?: number[];
    dateFrom?: string;
    dateTo?: string;
    isFavorite?: boolean;
    hasSignature?: boolean;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<AnalysisSummary>> {
    return this.request("POST", "/analyses/advanced-search", params);
  }

  // === Analytics ===

  async getAnalytics(days = 30): Promise<AnalyticsDashboard> {
    return this.request("GET", `/analytics?days=${days}`);
  }

  async getTeamAnalytics(days = 30): Promise<AnalyticsDashboard> {
    return this.request("GET", `/analytics/team?days=${days}`);
  }

  async getGlobalAnalytics(days = 30): Promise<AnalyticsDashboard> {
    return this.request("GET", `/analytics/global?days=${days}`);
  }

  // === Bulk Operations ===

  async bulkOperation(
    ids: number[],
    operation: string,
    tagIds?: number[],
  ): Promise<BulkResult> {
    return this.request("POST", "/analyses/bulk", { ids, operation, tagIds });
  }

  // === Export ===

  async exportAnalysis(
    id: number,
    format: string,
    audience?: string,
  ): Promise<string> {
    const headers = await this.headers();
    const response = await fetch(`${API_BASE}/analyses/${id}/export`, {
      method: "POST",
      headers,
      body: JSON.stringify({ format, audience }),
    });
    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "UNKNOWN",
      }));
      throw new HadronApiError(response.status, error.error, error.code);
    }
    return response.text();
  }

  async exportGenericReport(request: GenericExportRequest): Promise<string> {
    const headers = await this.headers();
    const response = await fetch(`${API_BASE}/export/generic`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "UNKNOWN",
      }));
      throw new HadronApiError(response.status, error.error, error.code);
    }
    return response.text();
  }

  // === Patterns (Admin) ===

  async listPatterns(): Promise<PatternRule[]> {
    return this.request("GET", "/admin/patterns");
  }

  async createPattern(rule: PatternRule): Promise<PatternRule[]> {
    return this.request("POST", "/admin/patterns", rule);
  }

  async updatePattern(id: string, rule: PatternRule): Promise<PatternRule[]> {
    return this.request("PUT", `/admin/patterns/${id}`, rule);
  }

  async deletePattern(id: string): Promise<void> {
    return this.request("DELETE", `/admin/patterns/${id}`);
  }

  async testPatterns(content: string, errorType?: string): Promise<PatternMatch[]> {
    return this.request("POST", "/admin/patterns/test", { content, errorType });
  }

  // === Training Data Export ===

  async exportTrainingData(): Promise<string> {
    const headers = await this.headers();
    const response = await fetch(`${API_BASE}/admin/export/training-data`, {
      method: "GET",
      headers,
    });
    if (!response.ok) {
      throw new HadronApiError(response.status, "Export failed", "EXPORT_FAILED");
    }
    return response.text();
  }

  // === Sentry Admin Config ===

  async getSentryConfigStatus(): Promise<SentryConfigStatus> {
    return this.request("GET", "/admin/sentry");
  }

  async updateSentryConfig(config: UpdateSentryConfigRequest): Promise<void> {
    return this.request("PUT", "/admin/sentry", config);
  }

  async testSentryConnection(config: {
    baseUrl: string;
    authToken: string;
    organization: string;
  }): Promise<{ connected: boolean }> {
    return this.request("POST", "/sentry/test", config);
  }

  // === Sentry Browse ===

  async getSentryProjects(): Promise<SentryProject[]> {
    return this.request("GET", "/sentry/projects");
  }

  async getSentryIssues(
    project: string,
    limit?: number,
  ): Promise<SentryIssue[]> {
    const params = new URLSearchParams({ project });
    if (limit) params.set("limit", String(limit));
    return this.request("GET", `/sentry/issues?${params}`);
  }

  async getSentryIssue(issueId: string): Promise<SentryIssue> {
    return this.request("GET", `/sentry/issues/${encodeURIComponent(issueId)}`);
  }

  async getSentryEvent(issueId: string): Promise<unknown> {
    return this.request("GET", `/sentry/issues/${encodeURIComponent(issueId)}/event`);
  }

  // === Sentry Analysis ===

  async analyzeSentryIssue(
    issueId: string,
  ): Promise<{ id: number; result: SentryAnalysisResult }> {
    return this.request("POST", `/sentry/issues/${encodeURIComponent(issueId)}/analyze`);
  }

  async getSentryAnalyses(
    limit?: number,
    offset?: number,
  ): Promise<{ items: SentryAnalysisSummary[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    return this.request("GET", `/sentry/analyses?${params}`);
  }

  async getSentryAnalysis(id: number): Promise<SentryAnalysisDetail> {
    return this.request<SentryAnalysisDetail>("GET", `/sentry/analyses/${id}`);
  }

  async deleteSentryAnalysis(id: number): Promise<void> {
    return this.request("DELETE", `/sentry/analyses/${id}`);
  }

  // ── Release Notes AI Generation ─────────────────────────────────

  async getJiraFixVersions(project: string): Promise<JiraFixVersion[]> {
    return this.request("GET", `/jira/fix-versions/${encodeURIComponent(project)}`);
  }

  async previewReleaseNotesTickets(config: ReleaseNotesGenerateRequest): Promise<ReleaseNoteTicketPreview[]> {
    return this.request("POST", "/release-notes/preview-tickets", config);
  }

  async generateReleaseNotes(config: ReleaseNotesGenerateRequest): Promise<{ releaseNoteId: number; ticketCount: number; markdownContent: string }> {
    return this.request("POST", "/release-notes/generate", config);
  }

  async getStyleGuide(): Promise<StyleGuideResponse> {
    return this.request("GET", "/admin/style-guide");
  }

  async updateStyleGuide(content: string): Promise<void> {
    return this.request("PUT", "/admin/style-guide", { content });
  }

  async deleteStyleGuide(): Promise<void> {
    return this.request("DELETE", "/admin/style-guide");
  }

  // ── Release Notes Review & Compliance ───────────────────────────

  async updateReleaseNoteStatus(id: number, status: string): Promise<void> {
    return this.request("PUT", `/release-notes/${id}/status`, { status });
  }

  async getReleaseNoteChecklist(id: number): Promise<ChecklistResponse> {
    return this.request("GET", `/release-notes/${id}/checklist`);
  }

  async updateReleaseNoteChecklist(id: number, items: ChecklistItem[]): Promise<void> {
    return this.request("PUT", `/release-notes/${id}/checklist`, items);
  }

  async runComplianceCheck(id: number): Promise<ComplianceReport> {
    return this.request("POST", `/release-notes/${id}/compliance`);
  }

  async getChecklistConfig(): Promise<ChecklistConfigResponse> {
    return this.request("GET", "/admin/checklist-config");
  }

  async updateChecklistConfig(items: string[]): Promise<void> {
    return this.request("PUT", "/admin/checklist-config", { items });
  }

  async deleteChecklistConfig(): Promise<void> {
    return this.request("DELETE", "/admin/checklist-config");
  }

  // === Confluence Export / Publish ===

  async exportConfluence(id: number): Promise<string> {
    const headers = await this.headers();
    const response = await fetch(`${API_BASE}/release-notes/${id}/export/confluence`, {
      method: "POST",
      headers,
    });
    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        code: "UNKNOWN",
      }));
      throw new HadronApiError(response.status, error.error, error.code);
    }
    return response.text();
  }

  async publishToConfluence(id: number): Promise<ConfluencePageResult> {
    return this.request("POST", `/release-notes/${id}/publish/confluence`);
  }

  async getConfluenceConfig(): Promise<ConfluenceConfig> {
    return this.request("GET", "/admin/confluence");
  }

  async updateConfluenceConfig(config: { spaceKey?: string; parentPageId?: string }): Promise<void> {
    return this.request("PUT", "/admin/confluence", config);
  }

  // ── Performance Analyzer ────────────────────────────────────────

  async analyzePerformanceTrace(content: string, filename: string): Promise<PerformanceTraceResult> {
    return this.request("POST", "/performance/analyze", { content, filename });
  }

  async analyzePerformanceTraceEnriched(content: string, filename: string): Promise<PerformanceTraceResult> {
    return this.request("POST", "/performance/analyze/enrich", { content, filename });
  }

  async getPerformanceAnalyses(limit?: number, offset?: number): Promise<{ items: PerformanceAnalysisSummary[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    return this.request("GET", `/performance/analyses?${params}`);
  }

  async getPerformanceAnalysis(id: number): Promise<{ fullData: PerformanceTraceResult }> {
    return this.request("GET", `/performance/analyses/${id}`);
  }

  async deletePerformanceAnalysis(id: number): Promise<void> {
    return this.request("DELETE", `/performance/analyses/${id}`);
  }

  // === RAG / Search ===

  async searchHybrid(query: string, limit?: number): Promise<SearchHitResult[]> {
    return this.request("POST", "/search/hybrid", { query, limit });
  }

  async searchKnowledgeBase(query: string, customer?: string, limit?: number): Promise<SearchHitResult[]> {
    return this.request("POST", "/search/knowledge-base", { query, customer, limit });
  }

  async getEmbeddingStatus(): Promise<EmbeddingStatus> {
    return this.request("GET", "/admin/embeddings/status");
  }

  async backfillEmbeddings(): Promise<BackfillResult> {
    return this.request("POST", "/admin/embeddings/backfill");
  }
}

// ============================================================================
// Error class
// ============================================================================

export class HadronApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "HadronApiError";
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

// ============================================================================
// Singleton export
// ============================================================================

export const api = new ApiClient();
