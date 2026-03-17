/**
 * Ask Hadron — Chat Service
 *
 * Tauri invoke wrappers, event listeners, and session management for the chat feature.
 */

import { invoke } from "@tauri-apps/api/core";
import { getApiKey } from "./secure-storage";
import { getOpenSearchConfig, getOpenSearchPassword } from "./opensearch";
import { getStoredModel, getStoredProvider, getStoredAuxiliaryModel } from "./api";
import { getJiraConfig } from "./jira";
import { getKeeperSecretForProvider } from "./keeper";
import logger from "./logger";
import { STORAGE_KEYS } from "../utils/config";

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  sources?: ChatSources;
  isStreaming?: boolean;
}

export interface ChatSources {
  ragResults: number;
  kbResults: number;
  goldMatches: number;
  ftsResults: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  isStarred?: boolean;
  tags?: string;
  customer?: string;
  wonVersion?: string;
  hasSummary?: boolean;      // derived client-side, not from DB
  hasGoldAnswers?: boolean;  // derived client-side, not from DB
}

export interface ChatStreamEvent {
  token: string;
  done: boolean;
  error: string | null;
  request_id?: string;
}

export interface ChatToolUseEvent {
  tool_name: string;
  tool_args: Record<string, unknown>;
  iteration: number;
  request_id?: string;
}

export interface ChatDiagnosticsEvent {
  tools_used: string[];
  total_tool_calls: number;
  retrieval_latency_ms: number;
  evidence_sufficient: boolean;
  evidence_confidence: number;
  evidence_reason: string;
  rewritten_query: string | null;
  request_id?: string;
}

export interface ChatFinalContentEvent {
  content: string;
  references: Array<{ index: number; url: string; title: string }>;
  request_id?: string;
}

export interface ChatResponse {
  content: string;
  tokens_used: number;
  cost: number;
}

// ============================================================================
// Chat API
// ============================================================================

export async function sendChatMessage(
  messages: ChatMessage[],
  options: {
    useRag?: boolean;
    useKb?: boolean;
    wonVersion?: string;
    customer?: string;
    analysisId?: number | null;
    requestId?: string;
    // Retrieval filters (PR1)
    dateFrom?: string;
    dateTo?: string;
    analysisTypes?: string[];
    // Verbosity control (Phase 5)
    verbosity?: "concise" | "detailed" | null;
  } = {}
): Promise<ChatResponse> {
  const provider = getStoredProvider();
  const model = getStoredModel();
  const auxiliaryModel = getStoredAuxiliaryModel();

  // Check if Keeper has a secret mapped for this provider
  const keeperSecretUid = await getKeeperSecretForProvider(provider);

  // Only fetch manual key if Keeper is not handling this provider
  let apiKey = "";
  if (!keeperSecretUid) {
    apiKey = (await getApiKey(provider)) || "";
    if (!apiKey && provider !== "llamacpp") {
      throw new Error("No API key configured. Please set your API key in Settings or map a Keeper secret.");
    }
  }

  // Build OpenSearch config if KB is enabled
  let opensearchConfig = null;
  if (options.useKb) {
    try {
      const osConfig = await getOpenSearchConfig();
      if (osConfig.enabled && osConfig.host) {
        const password = await getOpenSearchPassword();
        opensearchConfig = {
          host: osConfig.host,
          port: osConfig.port,
          username: osConfig.username,
          password: password || "",
          use_ssl: osConfig.useSsl,
          verify_certs: osConfig.verifyCerts,
        };
      }
    } catch (e) {
      logger.warn("Failed to load OpenSearch config for chat", { error: String(e) });
    }
  }

  // Build JIRA config if enabled
  let jiraBaseUrl: string | null = null;
  let jiraEmail: string | null = null;
  let jiraApiToken: string | null = null;
  let jiraProjectKey: string | null = null;
  try {
    const jiraConfig = await getJiraConfig();
    if (jiraConfig.enabled && jiraConfig.baseUrl) {
      const jiraToken = await getApiKey("jira");
      if (jiraToken) {
        jiraBaseUrl = jiraConfig.baseUrl;
        jiraEmail = jiraConfig.email;
        jiraApiToken = jiraToken;
        jiraProjectKey = jiraConfig.projectKey || null;
      }
    }
  } catch (e) {
    logger.warn("Failed to load JIRA config for chat", { error: String(e) });
  }

  // Convert to backend format (only user/assistant messages)
  const backendMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  const kbConfig = await getOpenSearchConfig().catch(() => null);

  return invoke<ChatResponse>("chat_send", {
    request: {
      messages: backendMessages,
      api_key: apiKey,
      keeper_secret_uid: keeperSecretUid || null,
      model,
      provider,
      use_rag: options.useRag ?? true,
      use_kb: options.useKb ?? false,
      won_version: options.wonVersion || kbConfig?.defaultVersion || null,
      customer: options.customer || kbConfig?.defaultCustomer || null,
      kb_mode: kbConfig?.mode || "remote",
      opensearch_config: opensearchConfig,
      jira_base_url: jiraBaseUrl,
      jira_email: jiraEmail,
      jira_api_token: jiraApiToken,
      jira_project_key: jiraProjectKey,
      auxiliary_model: auxiliaryModel,
      analysis_id: options.analysisId ?? null,
      request_id: options.requestId ?? null,
      date_from: options.dateFrom ?? null,
      date_to: options.dateTo ?? null,
      analysis_types: options.analysisTypes ?? null,
      verbosity: options.verbosity ?? null,
    },
  });
}

// ============================================================================
// Chat Cancellation
// ============================================================================

export async function cancelChat(requestId: string): Promise<void> {
  const { emit } = await import("@tauri-apps/api/event");
  await emit("chat-cancel", { request_id: requestId });
}

// ============================================================================
// Event Listeners
// ============================================================================

export async function subscribeToChatStream(
  callback: (event: ChatStreamEvent) => void,
  requestId?: string
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ChatStreamEvent>("chat-stream", (event) => {
    if (requestId && event.payload.request_id && event.payload.request_id !== requestId) return;
    callback(event.payload);
  });
}

export async function subscribeToChatContext(
  callback: (sources: ChatSources) => void,
  requestId?: string
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ChatSources & { request_id?: string }>("chat-context", (event) => {
    if (requestId && event.payload.request_id && event.payload.request_id !== requestId) return;
    callback(event.payload);
  });
}

export async function subscribeToChatToolUse(
  callback: (event: ChatToolUseEvent) => void,
  requestId?: string
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ChatToolUseEvent>("chat-tool-use", (event) => {
    if (requestId && event.payload.request_id && event.payload.request_id !== requestId) return;
    callback(event.payload);
  });
}

export async function subscribeToChatDiagnostics(
  callback: (event: ChatDiagnosticsEvent) => void,
  requestId?: string
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ChatDiagnosticsEvent & { request_id?: string }>(
    "chat-diagnostics",
    (event) => {
      if (
        requestId &&
        event.payload.request_id &&
        event.payload.request_id !== requestId
      )
        return;
      callback(event.payload);
    }
  );
}

export async function subscribeToChatFinalContent(
  callback: (event: ChatFinalContentEvent) => void,
  requestId?: string
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ChatFinalContentEvent>("chat-final-content", (event) => {
    if (requestId && event.payload.request_id && event.payload.request_id !== requestId) return;
    callback(event.payload);
  });
}

// ============================================================================
// Response Feedback
// ============================================================================

const FEEDBACK_KEY = STORAGE_KEYS.CHAT_FEEDBACK;

export interface ChatFeedback {
  sessionId: string;
  messageId: string;
  rating: "positive" | "negative";
  comment?: string;
  reason?: string;
  timestamp: number;
}

export const FEEDBACK_REASONS = [
  { value: "wrong_answer", label: "Wrong answer" },
  { value: "irrelevant_sources", label: "Irrelevant sources" },
  { value: "missing_info", label: "Missing information" },
  { value: "hallucinated", label: "Hallucinated / made up" },
  { value: "too_vague", label: "Too vague" },
  { value: "other", label: "Other" },
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]["value"];

export function submitChatFeedback(
  sessionId: string,
  messageId: string,
  rating: "positive" | "negative",
  comment?: string,
  reason?: string
): void {
  try {
    // Store locally for immediate UI state
    const stored = localStorage.getItem(FEEDBACK_KEY);
    const feedback: ChatFeedback[] = stored ? JSON.parse(stored) : [];
    const idx = feedback.findIndex((f) => f.messageId === messageId);
    const entry: ChatFeedback = { sessionId, messageId, rating, comment, reason, timestamp: Date.now() };
    if (idx >= 0) {
      feedback[idx] = entry;
    } else {
      feedback.push(entry);
    }
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedback.slice(-500)));

    // Also persist to SQLite backend (fire-and-forget)
    invoke("chat_submit_feedback", {
      request: {
        session_id: sessionId,
        message_id: messageId,
        rating,
        comment: comment || null,
        reason: reason || null,
        tools_used: null,
        query: null,
      },
    }).catch((e) => {
      logger.warn("Backend feedback storage failed", { error: String(e) });
    });

    logger.info("Chat feedback submitted", { messageId, rating });
  } catch (e) {
    logger.warn("Failed to save chat feedback", { error: String(e) });
  }
}

export function removeChatFeedback(sessionId: string, messageId: string): void {
  try {
    // Remove from localStorage
    const stored = localStorage.getItem(FEEDBACK_KEY);
    if (stored) {
      const feedback: ChatFeedback[] = JSON.parse(stored);
      const filtered = feedback.filter((f) => f.messageId !== messageId);
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(filtered));
    }

    // Also delete from SQLite backend (fire-and-forget)
    invoke("chat_delete_feedback", {
      request: {
        session_id: sessionId,
        message_id: messageId,
      },
    }).catch((e) => {
      logger.warn("Backend feedback deletion failed", { error: String(e) });
    });

    logger.info("Chat feedback removed", { messageId });
  } catch (e) {
    logger.warn("Failed to remove chat feedback", { error: String(e) });
  }
}

export function getChatFeedback(messageId: string): ChatFeedback | null {
  try {
    const stored = localStorage.getItem(FEEDBACK_KEY);
    if (!stored) return null;
    const feedback: ChatFeedback[] = JSON.parse(stored);
    return feedback.find((f) => f.messageId === messageId) ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Session Persistence (SQLite via Tauri)
// ============================================================================

interface ChatSessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  sourcesJson: string | null;
  timestamp: number;
}

export async function getChatSessions(): Promise<ChatSession[]> {
  try {
    const records = await invoke<ChatSessionRecord[]>("chat_list_sessions");
    // Return sessions without messages (loaded on demand via selectSession)
    return records.map((r) => ({
      id: r.id,
      title: r.title,
      messages: [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  } catch (e) {
    logger.warn("Failed to load chat sessions from DB", { error: String(e) });
    return [];
  }
}

export async function getChatSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  try {
    const records = await invoke<ChatMessageRecord[]>("chat_get_messages", { sessionId });
    return records.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant" | "system",
      content: r.content,
      timestamp: r.timestamp,
      sources: r.sourcesJson ? JSON.parse(r.sourcesJson) : undefined,
    }));
  } catch (e) {
    logger.warn("Failed to load chat messages from DB", { error: String(e) });
    return [];
  }
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  await invoke("chat_save_session", {
    request: {
      id: session.id,
      title: session.title,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources_json: m.sources ? JSON.stringify(m.sources) : null,
        timestamp: m.timestamp,
      })),
    },
  });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  try {
    await invoke("chat_delete_session", { sessionId });
  } catch (e) {
    logger.warn("Failed to delete chat session from DB", { error: String(e) });
  }
}

export function generateSessionTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 40) return cleaned;
  return cleaned.substring(0, 37) + "...";
}

export function createRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function createSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// ============================================================================
// Session Metadata (Ask Hadron 2.0)
// ============================================================================

export async function starChatSession(sessionId: string, starred: boolean): Promise<void> {
  await invoke("chat_star_session", { sessionId, starred });
}

export async function tagChatSession(sessionId: string, tags: string): Promise<void> {
  await invoke("chat_tag_session", { sessionId, tags });
}

export async function updateSessionMetadata(
  sessionId: string,
  customer?: string,
  wonVersion?: string
): Promise<void> {
  await invoke("chat_update_session_metadata", { sessionId, customer, wonVersion });
}

// ============================================================================
// JIRA Comment Integration
// ============================================================================

export async function postJiraComment(
  baseUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
  commentBody: string
): Promise<void> {
  await invoke("post_jira_comment", { baseUrl, email, apiToken, issueKey, commentBody });
}
