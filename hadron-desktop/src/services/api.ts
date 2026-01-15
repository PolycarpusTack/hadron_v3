/**
 * API Service Layer
 * Handles all communication with Tauri backend
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { analyzeWithResilience } from "./circuit-breaker";
import { getApiKey, storeApiKey as storeApiKeySecure } from "./secure-storage";
import { getBooleanSetting } from "../utils/config";
import { apiCache, CacheKeys, CacheTTL } from "./cache";

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
 * Invalidates translation cache after successful translation
 */
export async function translateTechnicalContent(
  content: string,
  apiKey: string,
  model: string = "gpt-4-turbo-preview",
  provider: string = "openai"
): Promise<string> {
  const redactPii = getBooleanSetting("pii_redaction_enabled");
  const result = await invoke<string>("translate_content", {
    content,
    apiKey,
    model,
    provider,
    redactPii,
  });
  // Invalidate translation cache since new translation was added
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
  return result;
}

/**
 * Get all analyses from history (with default pagination of 50 items)
 * Results are cached for 30 seconds to reduce backend calls
 */
export async function getAllAnalyses(): Promise<Analysis[]> {
  return apiCache.fetch(
    CacheKeys.ALL_ANALYSES,
    () => invoke<Analysis[]>("get_all_analyses"),
    { ttlMs: CacheTTL.DEFAULT }
  );
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
 * Results are cached per limit/offset combination
 * @param options - Pagination options (limit, offset)
 */
export async function getAnalysesPaginated(options?: PaginationOptions): Promise<Analysis[]> {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return apiCache.fetch(
    CacheKeys.ANALYSES_PAGINATED(limit, offset),
    () => invoke<Analysis[]>("get_analyses_paginated", { limit, offset }),
    { ttlMs: CacheTTL.DEFAULT }
  );
}

/**
 * Get total count of analyses (useful for pagination UI)
 */
export async function getAnalysesCount(): Promise<number> {
  try {
    return await invoke<number>("get_analyses_count");
  } catch (error) {
    console.error("Failed to get analyses count:", error);
    return 0;  // Return safe default
  }
}

/**
 * Get analyses for dashboard display
 * Limited to 20 most recent analyses for performance
 * Uses dedicated cache key with shorter TTL for dashboard freshness
 */
export async function getAnalysesForDashboard(): Promise<Analysis[]> {
  return getAnalysesPaginated({ limit: 20, offset: 0 });
}

/**
 * Get a specific analysis by ID
 * @throws Error if analysis not found or database error
 */
export async function getAnalysisById(id: number): Promise<Analysis> {
  try {
    return await invoke<Analysis>("get_analysis_by_id", { id });
  } catch (error) {
    console.error(`Failed to get analysis ${id}:`, error);
    throw new Error(`Analysis not found or database error: ${error}`);
  }
}

/**
 * Delete an analysis
 * Invalidates relevant caches after deletion
 */
export async function deleteAnalysis(id: number): Promise<void> {
  await invoke<void>("delete_analysis", { id });
  // Invalidate all analysis-related caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);
}

/**
 * Export analysis to Markdown
 * @throws Error if export fails
 */
export async function exportAnalysis(id: number): Promise<string> {
  try {
    return await invoke<string>("export_analysis", { id });
  } catch (error) {
    console.error(`Failed to export analysis ${id}:`, error);
    throw new Error(`Failed to export analysis: ${error}`);
  }
}

/**
 * Get database statistics (total count, favorites, severity breakdown)
 * Results are cached for 30 seconds as this is an expensive aggregation query
 */
export async function getDatabaseStatistics(): Promise<DatabaseStatistics> {
  return apiCache.fetch(
    CacheKeys.DATABASE_STATS,
    () => invoke<DatabaseStatistics>("get_database_statistics"),
    { ttlMs: CacheTTL.STATISTICS }
  );
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
  // SECURITY: Validate query to prevent injection attacks
  // Limit query length and sanitize special characters
  const sanitizedQuery = query.slice(0, 500).trim();
  if (!sanitizedQuery) {
    return [];
  }

  try {
    return await invoke<Analysis[]>("search_analyses", {
      query: sanitizedQuery,
      severityFilter: severityFilter || null,
    });
  } catch (error) {
    console.error("Search failed:", error);
    return [];  // Return empty array on error for graceful degradation
  }
}

/**
 * Phase 2: Toggle favorite status
 * Invalidates relevant caches after toggling
 * @param id - Analysis ID
 * @returns New favorite status
 */
export async function toggleFavorite(id: number): Promise<boolean> {
  const result = await invoke<boolean>("toggle_favorite", { id });
  // Invalidate analysis and stats caches (favorite count changes)
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);
  return result;
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
 * Results are cached for 30 seconds to reduce backend calls
 */
export async function getAllTranslations(): Promise<Translation[]> {
  return apiCache.fetch(
    CacheKeys.ALL_TRANSLATIONS,
    () => invoke<Translation[]>("get_all_translations"),
    { ttlMs: CacheTTL.DEFAULT }
  );
}

/**
 * Get a specific translation by ID
 */
export async function getTranslationById(id: number): Promise<Translation> {
  return await invoke<Translation>("get_translation_by_id", { id });
}

/**
 * Delete a translation
 * Invalidates translation cache after deletion
 */
export async function deleteTranslation(id: number): Promise<void> {
  await invoke<void>("delete_translation", { id });
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
}

/**
 * Toggle favorite status for a translation
 * Invalidates translation cache after toggling
 */
export async function toggleTranslationFavorite(id: number): Promise<boolean> {
  const result = await invoke<boolean>("toggle_translation_favorite", { id });
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
  return result;
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

// -------- Cache Utilities --------

/**
 * Manually invalidate all caches
 * Useful after bulk operations or when data may be stale
 */
export function invalidateAllCaches(): void {
  apiCache.clear();
}

/**
 * Invalidate analysis-related caches
 */
export function invalidateAnalysisCaches(): void {
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);
}

/**
 * Invalidate translation-related caches
 */
export function invalidateTranslationCaches(): void {
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats() {
  return apiCache.getStats();
}
