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
    credentials: {
      baseUrl: string;
      email: string;
      apiToken: string;
      projectKey: string;
    },
    options?: {
      jql?: string;
      text?: string;
      maxResults?: number;
    },
  ): Promise<{ issues: JiraIssue[]; total: number }> {
    return this.request("POST", "/jira/search", {
      credentials,
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
