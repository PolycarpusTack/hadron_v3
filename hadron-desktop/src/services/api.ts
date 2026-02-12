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
import logger from "./logger";
import type { AnalysisNote, TrendDataPoint, ErrorPatternCount, GoldAnalysis } from "../types";

export interface AnalysisRequest {
  file_path: string;
  api_key: string;
  model: string;
  provider: string;
  analysis_type: string; // "comprehensive" | "quick" (or legacy: "complete" | "specialized" | "whatson")
  redact_pii?: boolean;
  // Token-safe analysis mode
  analysis_mode?: AnalysisMode;
  // RAG-enhanced analysis (Phase 2.3)
  // When true, retrieves similar historical cases to improve analysis quality
  use_rag?: boolean;
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
  // Token-safe analysis metadata
  analysis_mode?: string; // "Quick", "Quick (Extracted)", "Deep Scan"
  coverage_summary?: string;
  token_utilization?: number;
}

// Analysis modes for token-safe processing
export type AnalysisMode = "quick" | "deep_scan" | "auto";

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
  analysis_type: string; // "comprehensive" | "quick" (or legacy: "complete" | "specialized" | "whatson")
  analysis_duration_ms?: number;
  // Enhanced analysis fields
  full_data?: string; // JSON string containing structured analysis (Comprehensive or Quick)
  // Token-safe analysis metadata
  analysis_mode?: string; // "Quick", "Quick (Extracted)", "Deep Scan"
  coverage_summary?: string;
  token_utilization?: number;
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
  analysisType: string = "complete",
  analysisMode: AnalysisMode = "auto",
  useRag: boolean = false
): Promise<AnalysisResponse> {
  // Use circuit breaker with automatic failover and token-safe analysis
  return await analyzeWithResilience(filePath, apiKey, model, provider, analysisType, analysisMode, useRag);
}

/**
 * Analyze a JIRA ticket through the WhatsOn AI analysis pipeline.
 * Composes ticket fields into a structured document and runs the same
 * analysis as crash logs, storing results in the analyses table.
 */
export async function analyzeJiraTicket(
  jiraKey: string,
  summary: string,
  description: string,
  comments: string[],
  priority: string | undefined,
  status: string | undefined,
  components: string[],
  labels: string[],
  apiKey: string,
  model?: string,
  provider?: string,
  useRag?: boolean,
): Promise<AnalysisResponse> {
  return invoke<AnalysisResponse>("analyze_jira_ticket", {
    request: {
      jiraKey,
      summary,
      description,
      comments,
      priority,
      status,
      components,
      labels,
      apiKey,
      model: model || getStoredModel(),
      provider: provider || getStoredProvider(),
      useRag: useRag ?? false,
    },
  });
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

export interface ExternalAnalysisRequest {
  filename: string;
  file_size_kb?: number;
  summary: string;
  severity?: string;
  analysis_type: string;
  suggested_fixes?: string[];
  ai_model?: string;
  ai_provider?: string;
  full_data?: Record<string, unknown>;
  component?: string;
  error_type?: string;
}

/**
 * Save an external analysis result to history (e.g., code analysis)
 */
export async function saveExternalAnalysis(
  request: ExternalAnalysisRequest
): Promise<number> {
  const id = await invoke<number>("save_external_analysis", { request });
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);
  return id;
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
    logger.error("Failed to get analyses count", { error });
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
    logger.error(`Failed to get analysis ${id}`, { error });
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
    logger.error(`Failed to export analysis ${id}`, { error });
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
    logger.error("Search failed", { error });
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
 * Advanced filtering for analyses with pagination
 * Supports filtering by severity, type, date range, tags, cost, etc.
 * @param options - Filter options
 * @returns Filtered results with pagination metadata
 */
export async function getAnalysesFiltered(
  options: AdvancedFilterOptions
): Promise<FilteredResults<Analysis>> {
  return await invoke<FilteredResults<Analysis>>("get_analyses_filtered", { options });
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
  const defaultModel =
    provider === "zai" ? "glm-4" :
    provider === "anthropic" ? "claude-sonnet-4-20250514" :
    provider === "ollama" ? "llama3.2:3b" :
    "gpt-4o";
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

// ============================================================================
// Sensitive Content Detection
// ============================================================================

import type {
  SensitiveContentResult,
  ReportAudience,
  MultiExportRequest,
  ExportResponse,
  PatternSummary,
  DatabaseInfo,
  ExportFormatOption,
  AudienceOption,
  AdvancedFilterOptions,
  FilteredResults,
} from "../types";

/**
 * Check content for sensitive data before sending to AI
 * @param content - The content to check
 * @returns Result with warnings and detected types
 */
export async function checkSensitiveContent(content: string): Promise<SensitiveContentResult> {
  return await invoke<SensitiveContentResult>("check_sensitive_content", { content });
}

/**
 * Sanitize content for a specific audience
 * @param content - The content to sanitize
 * @param audience - Target audience (technical, support, customer, executive)
 * @returns Sanitized content
 */
export async function sanitizeContent(content: string, audience: ReportAudience): Promise<string> {
  return await invoke<string>("sanitize_content", { content, audience });
}

// ============================================================================
// Pattern Filtering
// ============================================================================

/**
 * Get patterns filtered by category
 * @param category - Category name (e.g., "DatabaseError", "CollectionError")
 * @returns List of patterns in that category
 */
export async function getPatternsByCategory(category: string): Promise<PatternSummary[]> {
  return await invoke<PatternSummary[]>("get_patterns_by_category", { category });
}

/**
 * Get patterns filtered by tag
 * @param tag - Tag name
 * @returns List of patterns with that tag
 */
export async function getPatternsByTag(tag: string): Promise<PatternSummary[]> {
  return await invoke<PatternSummary[]>("get_patterns_by_tag", { tag });
}

/**
 * Get all unique tags from patterns
 * @returns List of unique tag names
 */
export async function getPatternTags(): Promise<string[]> {
  return await invoke<string[]>("get_pattern_tags");
}

/**
 * Get all unique categories from patterns
 * @returns List of unique category names
 */
export async function getPatternCategories(): Promise<string[]> {
  return await invoke<string[]>("get_pattern_categories");
}

/**
 * Get all patterns
 * @returns List of all pattern summaries
 */
export async function listPatterns(): Promise<PatternSummary[]> {
  return await invoke<PatternSummary[]>("list_patterns");
}

// ============================================================================
// Multi-Format Export
// ============================================================================

/**
 * Generate reports in multiple formats at once
 * @param request - Export request with formats array
 * @returns Array of export responses
 */
export async function generateReportMulti(request: MultiExportRequest): Promise<ExportResponse[]> {
  return await invoke<ExportResponse[]>("generate_report_multi", { request });
}

/**
 * Get available export formats
 * @returns List of supported export formats
 */
export async function getExportFormats(): Promise<ExportFormatOption[]> {
  return await invoke<ExportFormatOption[]>("get_export_formats");
}

/**
 * Get available audience options
 * @returns List of supported audience options
 */
export async function getAudienceOptions(): Promise<AudienceOption[]> {
  return await invoke<AudienceOption[]>("get_audience_options");
}

/**
 * Preview a report without saving
 * @param crashContent - Crash log content
 * @param fileName - Original file name
 * @param format - Export format (markdown, html, json)
 * @param audience - Target audience
 * @returns Preview content as string
 */
export async function previewReport(
  crashContent: string,
  fileName: string,
  format: string,
  audience: ReportAudience
): Promise<string> {
  return await invoke<string>("preview_report", {
    crashContent,
    fileName,
    format,
    audience,
  });
}

// ============================================================================
// Database Admin
// ============================================================================

/**
 * Get database admin information
 * @returns Database info including schema version, counts, migration status
 */
export async function getDatabaseInfo(): Promise<DatabaseInfo> {
  return await invoke<DatabaseInfo>("get_database_info");
}

// ============================================================================
// Tag Management
// ============================================================================

import type { Tag } from "../types";

/**
 * Create a new tag
 * @param name - Tag name (must be unique)
 * @param color - Tag color (hex format, e.g., "#EF4444")
 * @returns Created tag
 */
export async function createTag(name: string, color: string): Promise<Tag> {
  const tag = await invoke<Tag>("create_tag", { name, color });
  // Invalidate tag cache
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  return tag;
}

/**
 * Update an existing tag
 * @param id - Tag ID
 * @param updates - Fields to update (name and/or color)
 * @returns Updated tag
 */
export async function updateTag(
  id: number,
  updates: { name?: string; color?: string }
): Promise<Tag> {
  const tag = await invoke<Tag>("update_tag", {
    id,
    name: updates.name,
    color: updates.color,
  });
  // Invalidate tag cache
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  return tag;
}

/**
 * Delete a tag (cascades to remove from all analyses and translations)
 * @param id - Tag ID to delete
 */
export async function deleteTag(id: number): Promise<void> {
  await invoke<void>("delete_tag", { id });
  // Invalidate tag cache
  apiCache.invalidate(CacheKeys.ALL_TAGS);
}

/**
 * Get all tags ordered by usage count
 * @returns List of all tags
 */
export async function getAllTags(): Promise<Tag[]> {
  return apiCache.fetch(
    CacheKeys.ALL_TAGS,
    () => invoke<Tag[]>("get_all_tags"),
    { ttlMs: CacheTTL.DEFAULT }
  );
}

export interface AutoTagSummary {
  scanned: number;
  tagged: number;
  skipped: number;
  failed: number;
}

/**
 * Count analyses without any tags (for auto-tag preview)
 */
export async function countAnalysesWithoutTags(): Promise<number> {
  return invoke<number>("count_analyses_without_tags");
}

/**
 * Auto-tag analyses using deterministic rules
 * @param limit - Optional max number of analyses to process
 */
export async function autoTagAnalyses(limit?: number | null): Promise<AutoTagSummary> {
  const result = await invoke<AutoTagSummary>("auto_tag_analyses", { limit: limit ?? null });
  // Invalidate tag and analyses caches to reflect new tags
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  return result;
}

/**
 * Add a tag to an analysis
 * @param analysisId - Analysis ID
 * @param tagId - Tag ID to add
 */
export async function addTagToAnalysis(analysisId: number, tagId: number): Promise<void> {
  await invoke<void>("add_tag_to_analysis", { analysisId, tagId });
  // Invalidate relevant caches
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
}

/**
 * Remove a tag from an analysis
 * @param analysisId - Analysis ID
 * @param tagId - Tag ID to remove
 */
export async function removeTagFromAnalysis(analysisId: number, tagId: number): Promise<void> {
  await invoke<void>("remove_tag_from_analysis", { analysisId, tagId });
  // Invalidate relevant caches
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
}

/**
 * Get all tags for a specific analysis
 * @param analysisId - Analysis ID
 * @returns Tags associated with the analysis
 */
export async function getTagsForAnalysis(analysisId: number): Promise<Tag[]> {
  return invoke<Tag[]>("get_tags_for_analysis", { analysisId });
}

/**
 * Add a tag to a translation
 * @param translationId - Translation ID
 * @param tagId - Tag ID to add
 */
export async function addTagToTranslation(translationId: number, tagId: number): Promise<void> {
  await invoke<void>("add_tag_to_translation", { translationId, tagId });
  // Invalidate relevant caches
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
}

/**
 * Remove a tag from a translation
 * @param translationId - Translation ID
 * @param tagId - Tag ID to remove
 */
export async function removeTagFromTranslation(translationId: number, tagId: number): Promise<void> {
  await invoke<void>("remove_tag_from_translation", { translationId, tagId });
  // Invalidate relevant caches
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
}

/**
 * Get all tags for a specific translation
 * @param translationId - Translation ID
 * @returns Tags associated with the translation
 */
export async function getTagsForTranslation(translationId: number): Promise<Tag[]> {
  return invoke<Tag[]>("get_tags_for_translation", { translationId });
}

// ============================================================================
// Bulk Operations
// ============================================================================

import type { BulkOperationResult } from "../types";

/**
 * Delete multiple analyses in a single operation
 * @param ids - Array of analysis IDs to delete
 * @returns Result with success count
 */
export async function bulkDeleteAnalyses(ids: number[]): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_delete_analyses", { ids });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  return result;
}

/**
 * Delete multiple translations in a single operation
 * @param ids - Array of translation IDs to delete
 * @returns Result with success count
 */
export async function bulkDeleteTranslations(ids: number[]): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_delete_translations", { ids });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  return result;
}

/**
 * Add a tag to multiple analyses
 * @param analysisIds - Array of analysis IDs
 * @param tagId - Tag ID to add
 * @returns Result with success count
 */
export async function bulkAddTagToAnalyses(analysisIds: number[], tagId: number): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_add_tag_to_analyses", { analysisIds, tagId });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  return result;
}

/**
 * Remove a tag from multiple analyses
 * @param analysisIds - Array of analysis IDs
 * @param tagId - Tag ID to remove
 * @returns Result with success count
 */
export async function bulkRemoveTagFromAnalyses(analysisIds: number[], tagId: number): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_remove_tag_from_analyses", { analysisIds, tagId });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidate(CacheKeys.ALL_TAGS);
  return result;
}

/**
 * Set favorite status for multiple analyses
 * @param analysisIds - Array of analysis IDs
 * @param favorite - Whether to favorite or unfavorite
 * @returns Result with success count
 */
export async function bulkSetFavoriteAnalyses(analysisIds: number[], favorite: boolean): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_set_favorite_analyses", { analysisIds, favorite });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_STATS);
  return result;
}

/**
 * Set favorite status for multiple translations
 * @param translationIds - Array of translation IDs
 * @param favorite - Whether to favorite or unfavorite
 * @returns Result with success count
 */
export async function bulkSetFavoriteTranslations(translationIds: number[], favorite: boolean): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_set_favorite_translations", { translationIds, favorite });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_TRANSLATIONS);
  return result;
}

// ============================================================================
// Archive System
// ============================================================================

/**
 * Archive an analysis (soft delete)
 * @param id - Analysis ID to archive
 */
export async function archiveAnalysis(id: number): Promise<void> {
  await invoke("archive_analysis", { id });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
}

/**
 * Restore an archived analysis
 * @param id - Analysis ID to restore
 */
export async function restoreAnalysis(id: number): Promise<void> {
  await invoke("restore_analysis", { id });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
}

/**
 * Get all archived analyses
 * @returns Array of archived analyses
 */
export async function getArchivedAnalyses(): Promise<Analysis[]> {
  return await invoke<Analysis[]>("get_archived_analyses");
}

/**
 * Permanently delete an analysis
 * @param id - Analysis ID to permanently delete
 */
export async function permanentlyDeleteAnalysis(id: number): Promise<void> {
  await invoke("permanently_delete_analysis", { id });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
}

/**
 * Bulk archive analyses
 * @param ids - Array of analysis IDs to archive
 * @returns Result with success count
 */
export async function bulkArchiveAnalyses(ids: number[]): Promise<BulkOperationResult> {
  const result = await invoke<BulkOperationResult>("bulk_archive_analyses", { ids });
  // Invalidate caches
  apiCache.invalidateByPrefix(CacheKeys.PREFIX_ANALYSES);
  return result;
}

// ============================================================================
// Notes System
// ============================================================================

/**
 * Add a note to an analysis
 * @param analysisId - Analysis ID
 * @param content - Note content
 * @returns Created note
 */
export async function addNoteToAnalysis(analysisId: number, content: string): Promise<AnalysisNote> {
  return await invoke<AnalysisNote>("add_note_to_analysis", { analysisId, content });
}

/**
 * Update a note
 * @param id - Note ID
 * @param content - New content
 * @returns Updated note
 */
export async function updateNote(id: number, content: string): Promise<AnalysisNote> {
  return await invoke<AnalysisNote>("update_note", { id, content });
}

/**
 * Delete a note
 * @param id - Note ID to delete
 */
export async function deleteNote(id: number): Promise<void> {
  await invoke("delete_note", { id });
}

/**
 * Get all notes for an analysis
 * @param analysisId - Analysis ID
 * @returns Array of notes
 */
export async function getNotesForAnalysis(analysisId: number): Promise<AnalysisNote[]> {
  return await invoke<AnalysisNote[]>("get_notes_for_analysis", { analysisId });
}

/**
 * Get note count for an analysis
 * @param analysisId - Analysis ID
 * @returns Note count
 */
export async function getNoteCount(analysisId: number): Promise<number> {
  return await invoke<number>("get_note_count", { analysisId });
}

/**
 * Check if an analysis has any notes
 * @param analysisId - Analysis ID
 * @returns True if the analysis has notes
 */
export async function analysisHasNotes(analysisId: number): Promise<boolean> {
  return await invoke<boolean>("analysis_has_notes", { analysisId });
}

// ============================================================================
// Translation Archive System
// ============================================================================

/**
 * Archive a translation (soft delete)
 * @param id - Translation ID to archive
 */
export async function archiveTranslation(id: number): Promise<void> {
  await invoke("archive_translation", { id });
}

/**
 * Restore an archived translation
 * @param id - Translation ID to restore
 */
export async function restoreTranslation(id: number): Promise<void> {
  await invoke("restore_translation", { id });
}

// ============================================================================
// Similar Crash Detection & Analytics
// ============================================================================

/**
 * Get similar analyses based on error signature
 * @param analysisId - Analysis ID to find similar crashes for
 * @param limit - Max number of results (default 10)
 * @returns Array of similar analyses
 */
export async function getSimilarAnalyses(analysisId: number, limit?: number): Promise<Analysis[]> {
  return await invoke<Analysis[]>("get_similar_analyses", { analysisId, limit });
}

/**
 * Count similar analyses for an analysis
 * @param analysisId - Analysis ID
 * @returns Number of similar analyses
 */
export async function countSimilarAnalyses(analysisId: number): Promise<number> {
  return await invoke<number>("count_similar_analyses", { analysisId });
}

/**
 * Get trend data for analytics
 * @param period - Period type: "day", "week", or "month"
 * @param rangeDays - Number of days to include
 * @returns Array of trend data points
 */
export async function getTrendData(period: string, rangeDays: number): Promise<TrendDataPoint[]> {
  return await invoke<TrendDataPoint[]>("get_trend_data", { period, rangeDays });
}

/**
 * Get top error patterns
 * @param limit - Max number of patterns (default 10)
 * @returns Array of error pattern counts
 */
export async function getTopErrorPatterns(limit?: number): Promise<ErrorPatternCount[]> {
  return await invoke<ErrorPatternCount[]>("get_top_error_patterns", { limit });
}

// ============================================================================
// Fine-Tuning Export (Phase 1.4)
// ============================================================================

/**
 * Result of fine-tuning export operation
 */
export interface FineTuneExportResult {
  totalExported: number;
  jsonlContent: string;
  format: string;
}

/**
 * Export verified gold analyses as JSONL for OpenAI fine-tuning
 * @returns Export result with JSONL content
 */
export async function exportGoldJsonl(): Promise<FineTuneExportResult> {
  return await invoke<FineTuneExportResult>("export_gold_jsonl");
}

/**
 * Count verified gold analyses available for export
 * @returns Number of verified gold analyses
 */
export async function countGoldForExport(): Promise<number> {
  return await invoke<number>("count_gold_for_export");
}

/**
 * Get all gold analyses (any status)
 */
export async function getGoldAnalyses(): Promise<GoldAnalysis[]> {
  return invoke<GoldAnalysis[]>("get_gold_analyses");
}
