/**
 * RAG (Retrieval-Augmented Generation) Service
 * Provides semantic search and context building for crash analysis
 */

import { invoke } from "@tauri-apps/api/core";
import { getApiKey } from "./secure-storage";

// ============================================================================
// Type Definitions
// ============================================================================

export interface RAGChunkMetadata {
  component?: string;
  severity?: string;
  error_type?: string;
  version?: string;
  source_type?: string;
  source_id?: number;
  is_gold: boolean;
}

export interface RAGQueryResult {
  id: string;
  content: string;
  score: number;
  metadata: RAGChunkMetadata;
}

export interface RAGQueryRequest {
  query: string;
  component?: string;
  severity?: string;
  top_k?: number;
  api_key: string;
}

export interface RAGIndexRequest {
  analysis: any;
  api_key: string;
}

export interface RAGIndexResponse {
  indexed: number;
  ids: string[];
}

export interface SimilarCase {
  analysis_id: number;
  similarity_score: number;
  root_cause: string;
  suggested_fixes: string[];
  is_gold: boolean;
  citation_id: string;
  component?: string;
  severity?: string;
}

export interface RAGContext {
  similar_analyses: SimilarCase[];
  gold_matches: SimilarCase[];
  confidence_boost: number;
  retrieval_time_ms?: number;
}

export interface RAGContextRequest {
  query: string;
  component?: string;
  severity?: string;
  top_k?: number;
  api_key: string;
}

export interface RAGStatsResponse {
  total_chunks: number;
  total_analyses: number;
  gold_analyses: number;
  storage_path: string;
}

// ============================================================================
// RAG Query Operations
// ============================================================================

/**
 * Query the RAG vector store for similar analyses
 *
 * @param query - Natural language query describing the crash/error
 * @param filters - Optional filters for component, severity, etc.
 * @param topK - Number of results to return (default: 5)
 * @returns Similar crash analyses ranked by relevance
 */
export async function ragQuery(
  query: string,
  filters?: {
    component?: string;
    severity?: string;
  },
  topK: number = 5
): Promise<RAGQueryResult[]> {
  const apiKey = await getApiKey("openai");
  if (!apiKey) {
    throw new Error("API key not configured. Please set up your OpenAI API key in settings.");
  }

  const request: RAGQueryRequest = {
    query,
    component: filters?.component,
    severity: filters?.severity,
    top_k: topK,
    api_key: apiKey,
  };

  try {
    const results = await invoke<RAGQueryResult[]>("rag_query", { request });
    return results;
  } catch (error) {
    console.error("RAG query failed:", error);
    throw new Error(`RAG query failed: ${error}`);
  }
}

/**
 * Build RAG context for enhanced analysis
 *
 * This retrieves similar historical cases and gold-standard analyses
 * to provide context for AI-powered crash analysis.
 *
 * @param query - Natural language query describing the crash/error
 * @param filters - Optional filters for component, severity, etc.
 * @param topK - Number of results to return (default: 5)
 * @returns RAG context with similar cases and gold matches
 */
export async function ragBuildContext(
  query: string,
  filters?: {
    component?: string;
    severity?: string;
  },
  topK: number = 5
): Promise<RAGContext> {
  const apiKey = await getApiKey("openai");
  if (!apiKey) {
    throw new Error("API key not configured. Please set up your OpenAI API key in settings.");
  }

  const request: RAGContextRequest = {
    query,
    component: filters?.component,
    severity: filters?.severity,
    top_k: topK,
    api_key: apiKey,
  };

  try {
    const context = await invoke<RAGContext>("rag_build_context", { request });
    return context;
  } catch (error) {
    console.error("RAG context build failed:", error);
    throw new Error(`RAG context build failed: ${error}`);
  }
}

// ============================================================================
// RAG Indexing Operations
// ============================================================================

/**
 * Index an analysis into the RAG vector store
 *
 * This is typically called automatically after analysis completion,
 * but can also be manually triggered.
 *
 * @param analysis - Analysis object to index
 * @returns Index response with number of chunks indexed
 */
export async function ragIndexAnalysis(
  analysis: any
): Promise<RAGIndexResponse> {
  const apiKey = await getApiKey("openai");
  if (!apiKey) {
    throw new Error("API key not configured. Please set up your OpenAI API key in settings.");
  }

  const request: RAGIndexRequest = {
    analysis,
    api_key: apiKey,
  };

  try {
    const response = await invoke<RAGIndexResponse>("rag_index_analysis", { request });
    return response;
  } catch (error) {
    console.error("RAG indexing failed:", error);
    throw new Error(`RAG indexing failed: ${error}`);
  }
}

/**
 * Re-index an existing analysis (e.g., after promotion to gold status)
 *
 * @param analysisId - ID of the analysis to re-index
 * @param analysis - Full analysis object
 * @returns Index response
 */
export async function ragReindexAnalysis(
  analysisId: number,
  analysis: any
): Promise<RAGIndexResponse> {
  console.log(`Re-indexing analysis ${analysisId} into RAG store`);
  return ragIndexAnalysis(analysis);
}

// ============================================================================
// RAG Statistics
// ============================================================================

/**
 * Get RAG store statistics
 *
 * @returns Statistics about the RAG vector store
 */
export async function ragGetStats(): Promise<RAGStatsResponse> {
  try {
    const stats = await invoke<RAGStatsResponse>("rag_get_stats");
    return stats;
  } catch (error) {
    console.error("Failed to get RAG stats:", error);
    throw new Error(`Failed to get RAG stats: ${error}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if RAG is available (API key configured)
 *
 * @returns True if RAG can be used
 */
export async function isRagAvailable(): Promise<boolean> {
  try {
    const apiKey = await getApiKey("openai");
    return !!apiKey;
  } catch {
    return false;
  }
}

/**
 * Format similar cases for display
 *
 * @param cases - Similar cases from RAG
 * @returns Formatted string for display
 */
export function formatSimilarCases(cases: SimilarCase[]): string {
  if (cases.length === 0) {
    return "No similar cases found";
  }

  return cases
    .map((c, idx) => {
      const goldBadge = c.is_gold ? " 🏆" : "";
      const score = (c.similarity_score * 100).toFixed(1);
      return `${idx + 1}. [${score}% match${goldBadge}] ${c.root_cause}`;
    })
    .join("\n");
}

/**
 * Extract query from crash analysis for RAG search
 *
 * @param analysis - Analysis object
 * @returns Query string optimized for RAG search
 */
export function extractQueryFromAnalysis(analysis: any): string {
  const parts: string[] = [];

  if (analysis.error_type) {
    parts.push(analysis.error_type);
  }

  if (analysis.error_message) {
    parts.push(analysis.error_message);
  }

  if (analysis.component) {
    parts.push(`component: ${analysis.component}`);
  }

  // If we have stack trace, extract the first few frames
  if (analysis.stack_trace) {
    const firstFrames = analysis.stack_trace
      .split("\n")
      .slice(0, 3)
      .join(" ");
    parts.push(firstFrames);
  }

  return parts.join(" ").slice(0, 500); // Limit query length
}

/**
 * Build RAG context from crash log content
 *
 * This is a convenience function that extracts a query from raw crash log
 * content and retrieves similar cases.
 *
 * @param crashLogContent - Raw crash log content
 * @param filters - Optional filters
 * @returns RAG context
 */
export async function buildContextFromCrashLog(
  crashLogContent: string,
  filters?: {
    component?: string;
    severity?: string;
  }
): Promise<RAGContext> {
  // Extract a meaningful query from crash log
  // This is a simple heuristic - could be enhanced
  const lines = crashLogContent.split("\n").slice(0, 10); // First 10 lines
  const query = lines.join(" ").slice(0, 500);

  return ragBuildContext(query, filters);
}
