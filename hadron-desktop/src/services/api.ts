/**
 * API Service Layer
 * Handles all communication with Tauri backend
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { analyzeWithResilience } from "./circuit-breaker";
import { getApiKey, storeApiKey as storeApiKeySecure } from "./secure-storage";
import { getBooleanSetting } from "../utils/config";

export interface AnalysisRequest {
  file_path: string;
  api_key: string;
  model: string;
  provider: string;
  analysis_type: string; // "complete" or "specialized"
  redact_pii?: boolean;
}

export interface AnalysisResponse {
  id: number;
  filename: string;
  error_type: string;
  severity: "critical" | "high" | "medium" | "low"; // Python returns lowercase
  root_cause: string;
  suggested_fixes: string[];
  analyzed_at: string;
  cost: number;
}

export interface Analysis {
  id: number;
  filename: string;
  file_size_kb: number;
  error_type: string;
  error_message?: string;
  severity: string;
  component?: string;
  stack_trace?: string;
  root_cause: string;
  suggested_fixes: string;
  confidence?: string;
  analyzed_at: string;
  ai_model: string;
  ai_provider?: string;
  tokens_used: number;
  cost: number;
  was_truncated: boolean;
  // Phase 2: Just the essentials
  is_favorite: boolean;
  view_count: number;
  analysis_type: string; // "complete" or "specialized"
  analysis_duration_ms?: number;
}

export interface Translation {
  id: number;
  input_content: string;
  translation: string;
  translated_at: string;
  ai_model: string;
  ai_provider: string;
  is_favorite: boolean;
  last_viewed_at?: string;
  view_count: number;
}

export interface DatabaseStatistics {
  total_count: number;
  favorite_count: number;
  severity_breakdown: [string, number][];
}

/**
 * Open file dialog to select a crash log
 */
export async function selectCrashLogFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Crash Logs",
        extensions: ["txt", "log"],
      },
    ],
  });

  if (Array.isArray(selected)) {
    return selected[0] || null;
  }

  return selected;
}

/**
 * Analyze a crash log file with automatic failover
 *
 * Now uses circuit breaker pattern for resilience:
 * - Tries preferred provider first
 * - Falls back to alternatives if it fails
 * - Skips providers with open circuit breakers
 */
export async function analyzeCrashLog(
  filePath: string,
  apiKey: string,
  model: string = "gpt-4-turbo-preview",
  provider: string = "openai",
  analysisType: string = "complete"
): Promise<AnalysisResponse> {
  // Use circuit breaker with automatic failover
  return await analyzeWithResilience(filePath, apiKey, model, provider, analysisType);
}

/**
 * Translate technical content to plain language
 */
export async function translateTechnicalContent(
  content: string,
  apiKey: string,
  model: string = "gpt-4-turbo-preview",
  provider: string = "openai"
): Promise<string> {
  const redactPii = getBooleanSetting("pii_redaction_enabled");
  return await invoke<string>("translate_content", {
    content,
    apiKey,
    model,
    provider,
    redactPii,
  });
}

/**
 * Get all analyses from history (with default pagination of 50 items)
 */
export async function getAllAnalyses(): Promise<Analysis[]> {
  return await invoke<Analysis[]>("get_all_analyses");
}

/**
 * Pagination options for list queries
 */
export interface PaginationOptions {
  limit?: number;  // Number of items to return (-1 for unlimited)
  offset?: number; // Number of items to skip
}

/**
 * Get analyses with pagination support
 * @param options - Pagination options (limit, offset)
 */
export async function getAnalysesPaginated(options?: PaginationOptions): Promise<Analysis[]> {
  return await invoke<Analysis[]>("get_analyses_paginated", {
    limit: options?.limit,
    offset: options?.offset,
  });
}

/**
 * Get total count of analyses (useful for pagination UI)
 */
export async function getAnalysesCount(): Promise<number> {
  return await invoke<number>("get_analyses_count");
}

/**
 * Get analyses ordered by recency (frontend can slice for "recent" views)
 * Uses the same data as getAllAnalyses, which is already ordered by analyzed_at DESC in the backend.
 */
export async function getAnalysesForDashboard(): Promise<Analysis[]> {
  return await getAllAnalyses();
}

/**
 * Get a specific analysis by ID
 */
export async function getAnalysisById(id: number): Promise<Analysis> {
  return await invoke<Analysis>("get_analysis_by_id", { id });
}

/**
 * Delete an analysis
 */
export async function deleteAnalysis(id: number): Promise<void> {
  return await invoke<void>("delete_analysis", { id });
}

/**
 * Export analysis to Markdown
 */
export async function exportAnalysis(id: number): Promise<string> {
  return await invoke<string>("export_analysis", { id });
}

/**
 * Get database statistics (total count, favorites, severity breakdown)
 */
export async function getDatabaseStatistics(): Promise<DatabaseStatistics> {
  return await invoke<DatabaseStatistics>("get_database_statistics");
}

/**
 * Phase 2: Search analyses using FTS5
 * @param query - Search query (supports FTS5 syntax)
 * @param severityFilter - Optional severity filter
 */
export async function searchAnalyses(
  query: string,
  severityFilter?: string
): Promise<Analysis[]> {
  return await invoke<Analysis[]>("search_analyses", {
    query,
    severityFilter: severityFilter || null,
  });
}

/**
 * Phase 2: Toggle favorite status
 * @param id - Analysis ID
 * @returns New favorite status
 */
export async function toggleFavorite(id: number): Promise<boolean> {
  return await invoke<boolean>("toggle_favorite", { id });
}

/**
 * Get AI provider from local storage
 */
export function getStoredProvider(): string {
  return localStorage.getItem("ai_provider") || "openai";
}

/**
 * Get API key from encrypted storage
 * @deprecated Use getApiKey from secure-storage directly for async access
 */
export async function getStoredApiKey(provider?: string): Promise<string | null> {
  const currentProvider = provider || getStoredProvider();
  return await getApiKey(currentProvider);
}

/**
 * Save API key to encrypted storage
 * @param apiKey - The API key to store
 * @param provider - Optional provider name (defaults to current provider)
 */
export async function saveApiKey(apiKey: string, provider?: string): Promise<void> {
  const currentProvider = provider || getStoredProvider();
  await storeApiKeySecure(currentProvider, apiKey);
}

/**
 * Get selected AI model from local storage
 */
export function getStoredModel(): string {
  const provider = getStoredProvider();
  const defaultModel = provider === "zai" ? "glm-4.6" : "gpt-4-turbo-preview";
  return localStorage.getItem("ai_model") || defaultModel;
}

/**
 * Save selected AI model to local storage
 */
export function saveModel(model: string): void {
  localStorage.setItem("ai_model", model);
}

/**
 * Save AI provider to local storage
 */
export function saveProvider(provider: string): void {
  localStorage.setItem("ai_provider", provider);
}

/**
 * Get all translations from history
 */
export async function getAllTranslations(): Promise<Translation[]> {
  return await invoke<Translation[]>("get_all_translations");
}

/**
 * Get a specific translation by ID
 */
export async function getTranslationById(id: number): Promise<Translation> {
  return await invoke<Translation>("get_translation_by_id", { id });
}

/**
 * Delete a translation
 */
export async function deleteTranslation(id: number): Promise<void> {
  return await invoke<void>("delete_translation", { id });
}

/**
 * Toggle favorite status for a translation
 */
export async function toggleTranslationFavorite(id: number): Promise<boolean> {
  return await invoke<boolean>("toggle_translation_favorite", { id });
}

// -------- Provider models (for Settings) --------

export interface ProviderModel {
  id: string;
  label: string;
  context?: number;
  category?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  models_count?: number;
}

export async function listModels(provider: string, apiKey: string): Promise<ProviderModel[]> {
  return await invoke<ProviderModel[]>("list_models", { provider, apiKey });
}

export async function testConnection(provider: string, apiKey: string): Promise<ConnectionTestResult> {
  return await invoke<ConnectionTestResult>("test_connection", { provider, apiKey });
}
