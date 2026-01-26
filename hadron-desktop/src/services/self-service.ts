/**
 * Self-Service Portal Service
 * Phase 5: Customer self-service issue resolution
 *
 * Provides AI-powered suggestions before ticket creation,
 * tracks deflection rate, and manages customer interactions.
 */

import { invoke } from "@tauri-apps/api/core";
import logger from "./logger";

// ============================================================================
// Types
// ============================================================================

export interface IssueDescription {
  description: string;
  component?: string;
  urgency?: "low" | "normal" | "high" | "critical";
  customerId?: string;
  environment?: string;
  version?: string;
}

export interface SuggestedSolution {
  id: string;
  title: string;
  description: string;
  steps: string[];
  confidence: number;
  source: "gold" | "documentation" | "similar_ticket" | "ai";
  sourceId?: number;
  relevanceScore: number;
}

export interface SelfServiceResult {
  suggestions: SuggestedSolution[];
  relatedTickets: RelatedTicket[];
  documentation: DocumentationLink[];
  searchTime: number;
  sessionId: string;
}

export interface RelatedTicket {
  jiraKey: string;
  summary: string;
  status: string;
  resolution?: string;
  similarity: number;
}

export interface DocumentationLink {
  title: string;
  url?: string;
  excerpt: string;
  component?: string;
}

export interface DeflectionEvent {
  sessionId: string;
  customerId?: string;
  issueDescription: string;
  suggestionsShown: string[];
  solutionUsed?: string;
  wasHelpful: boolean;
  ticketCreated: boolean;
  timestamp: string;
  feedbackNotes?: string;
}

export interface DeflectionStats {
  totalSessions: number;
  deflectedSessions: number;
  deflectionRate: number;
  avgSuggestionsShown: number;
  topHelpfulSolutions: Array<{ solutionId: string; helpfulCount: number }>;
  byComponent: Record<string, { total: number; deflected: number }>;
  periodStart: string;
  periodEnd: string;
}

// ============================================================================
// Session Management
// ============================================================================

let currentSessionId: string | null = null;
const sessionHistory: Map<string, DeflectionEvent[]> = new Map();

function generateSessionId(): string {
  return `ss_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Start a new self-service session
 */
export function startSession(customerId?: string): string {
  currentSessionId = generateSessionId();
  sessionHistory.set(currentSessionId, []);
  logger.info("Self-service session started", { sessionId: currentSessionId, customerId });
  return currentSessionId;
}

/**
 * Get current session ID
 */
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

// ============================================================================
// Suggestion Generation
// ============================================================================

/**
 * Get AI-powered suggestions for an issue description
 */
export async function getSuggestions(
  issue: IssueDescription
): Promise<SelfServiceResult> {
  const startTime = Date.now();
  const sessionId = currentSessionId || startSession(issue.customerId);

  logger.info("Getting self-service suggestions", {
    sessionId,
    descriptionLength: issue.description.length,
    component: issue.component,
  });

  const suggestions: SuggestedSolution[] = [];
  const relatedTickets: RelatedTicket[] = [];
  const documentation: DocumentationLink[] = [];

  try {
    // 1. Search gold analyses for similar issues
    const goldMatches = await searchGoldAnalyses(issue.description, issue.component);
    suggestions.push(...goldMatches);

    // 2. Search for similar historical tickets (if JIRA is configured)
    try {
      const ticketMatches = await searchSimilarTickets(issue.description);
      relatedTickets.push(...ticketMatches);
    } catch {
      logger.debug("JIRA search not available");
    }

    // 3. Search documentation/runbooks
    const docMatches = await searchDocumentation(issue.description, issue.component);
    documentation.push(...docMatches);

    // 4. Generate AI suggestions if not enough matches
    if (suggestions.length < 3) {
      const aiSuggestions = await generateAISuggestions(issue, suggestions);
      suggestions.push(...aiSuggestions);
    }

    // Sort by confidence/relevance
    suggestions.sort((a, b) => b.confidence * b.relevanceScore - a.confidence * a.relevanceScore);

  } catch (e) {
    logger.error("Failed to get suggestions", { error: e });
  }

  const searchTime = Date.now() - startTime;

  return {
    suggestions: suggestions.slice(0, 5), // Top 5 suggestions
    relatedTickets: relatedTickets.slice(0, 3),
    documentation: documentation.slice(0, 3),
    searchTime,
    sessionId,
  };
}

/**
 * Search gold analyses for matching solutions
 */
async function searchGoldAnalyses(
  description: string,
  component?: string
): Promise<SuggestedSolution[]> {
  const suggestions: SuggestedSolution[] = [];

  try {
    // Use the search_analyses command with component filter
    interface SearchResult {
      id: number;
      error_type: string;
      root_cause: string;
      suggested_fixes: string;
      severity: string;
      component?: string;
    }

    const results = await invoke<SearchResult[]>("search_analyses", {
      query: description.substring(0, 200),
      limit: 10,
      component: component || null,
    });

    for (const result of results) {
      // Parse suggested fixes
      let fixes: string[] = [];
      try {
        fixes = JSON.parse(result.suggested_fixes);
      } catch {
        fixes = [result.suggested_fixes];
      }

      suggestions.push({
        id: `gold_${result.id}`,
        title: `Solution for ${result.error_type}`,
        description: result.root_cause,
        steps: fixes.slice(0, 5),
        confidence: 0.85,
        source: "gold",
        sourceId: result.id,
        relevanceScore: 0.9 - (suggestions.length * 0.1),
      });
    }
  } catch (e) {
    logger.debug("Gold analysis search failed", { error: e });
  }

  return suggestions;
}

/**
 * Search for similar resolved tickets
 */
async function searchSimilarTickets(description: string): Promise<RelatedTicket[]> {
  const tickets: RelatedTicket[] = [];

  try {
    // Search JIRA for similar resolved tickets
    interface JiraResult {
      key: string;
      fields: {
        summary: string;
        status: { name: string };
        resolution?: { name: string };
      };
    }

    const jql = `text ~ "${description.substring(0, 100).replace(/"/g, '\\"')}" AND status = Resolved ORDER BY resolved DESC`;

    const results = await invoke<{ issues: JiraResult[] }>("search_jira_issues", {
      jql,
      maxResults: 5,
    });

    for (let i = 0; i < results.issues.length; i++) {
      const issue = results.issues[i];
      tickets.push({
        jiraKey: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        resolution: issue.fields.resolution?.name,
        similarity: 0.8 - (i * 0.1),
      });
    }
  } catch (e) {
    logger.debug("JIRA ticket search failed", { error: e });
  }

  return tickets;
}

/**
 * Search documentation for relevant articles
 */
async function searchDocumentation(
  description: string,
  component?: string
): Promise<DocumentationLink[]> {
  const docs: DocumentationLink[] = [];

  // Common WHATS'ON documentation topics based on keywords
  const keywords = description.toLowerCase();
  const docTopics: Array<{ keywords: string[]; doc: DocumentationLink }> = [
    {
      keywords: ["epg", "schedule", "program guide"],
      doc: {
        title: "EPG Management Guide",
        excerpt: "Learn how to configure EPG feeds, schedule imports, and troubleshoot common EPG issues.",
        component: "EPG",
      },
    },
    {
      keywords: ["rights", "license", "contract"],
      doc: {
        title: "Rights & Contracts Configuration",
        excerpt: "Guide to setting up rights management, license validation, and contract workflows.",
        component: "Rights",
      },
    },
    {
      keywords: ["schedule", "planner", "conflict"],
      doc: {
        title: "Scheduling Best Practices",
        excerpt: "Optimize your scheduling workflows and resolve common conflicts.",
        component: "Scheduling",
      },
    },
    {
      keywords: ["performance", "slow", "timeout"],
      doc: {
        title: "Performance Troubleshooting",
        excerpt: "Diagnose and resolve performance issues, timeouts, and database bottlenecks.",
        component: "Database",
      },
    },
    {
      keywords: ["api", "integration", "rest"],
      doc: {
        title: "API Integration Guide",
        excerpt: "Complete guide to WHATS'ON REST API endpoints and integration patterns.",
        component: "API",
      },
    },
    {
      keywords: ["workflow", "automation", "rule"],
      doc: {
        title: "Workflow Engine Documentation",
        excerpt: "Configure automated workflows, business rules, and event triggers.",
        component: "Workflow",
      },
    },
  ];

  for (const topic of docTopics) {
    if (topic.keywords.some(kw => keywords.includes(kw))) {
      docs.push(topic.doc);
    }
    // Also match by component
    if (component && topic.doc.component?.toLowerCase() === component.toLowerCase()) {
      if (!docs.find(d => d.title === topic.doc.title)) {
        docs.push(topic.doc);
      }
    }
  }

  return docs;
}

/**
 * Generate AI-powered suggestions when not enough matches found
 */
async function generateAISuggestions(
  issue: IssueDescription,
  _existingSuggestions: SuggestedSolution[]
): Promise<SuggestedSolution[]> {
  const suggestions: SuggestedSolution[] = [];

  try {
    // Use the analyze endpoint for AI suggestions
    interface AnalysisResult {
      root_cause: string;
      suggested_fixes: string[];
      severity: string;
      component?: string;
    }

    const result = await invoke<AnalysisResult>("analyze_crash_log", {
      content: issue.description,
      filename: "self_service_query",
      analysisType: "quick",
    });

    if (result.suggested_fixes && result.suggested_fixes.length > 0) {
      suggestions.push({
        id: `ai_${Date.now()}`,
        title: "AI-Generated Solution",
        description: result.root_cause || "Based on your description, try these steps:",
        steps: result.suggested_fixes,
        confidence: 0.7,
        source: "ai",
        relevanceScore: 0.75,
      });
    }
  } catch (e) {
    logger.debug("AI suggestion generation failed", { error: e });
  }

  return suggestions;
}

// ============================================================================
// Deflection Tracking
// ============================================================================

/**
 * Record that a solution was helpful (deflection)
 */
export async function recordSolutionHelpful(
  solutionId: string,
  feedbackNotes?: string
): Promise<void> {
  if (!currentSessionId) return;

  const event: DeflectionEvent = {
    sessionId: currentSessionId,
    issueDescription: "", // Would be set from session context
    suggestionsShown: [],
    solutionUsed: solutionId,
    wasHelpful: true,
    ticketCreated: false,
    timestamp: new Date().toISOString(),
    feedbackNotes,
  };

  // Store in session history
  const history = sessionHistory.get(currentSessionId) || [];
  history.push(event);
  sessionHistory.set(currentSessionId, history);

  // Persist to database
  try {
    await invoke("record_deflection_event", { event });
    logger.info("Deflection recorded", { sessionId: currentSessionId, solutionId });
  } catch (e) {
    // Command might not exist yet, store locally
    storeLocalDeflection(event);
  }
}

/**
 * Record that user is creating a ticket (not deflected)
 */
export async function recordTicketCreation(
  suggestionsShown: string[]
): Promise<void> {
  if (!currentSessionId) return;

  const event: DeflectionEvent = {
    sessionId: currentSessionId,
    issueDescription: "",
    suggestionsShown,
    wasHelpful: false,
    ticketCreated: true,
    timestamp: new Date().toISOString(),
  };

  const history = sessionHistory.get(currentSessionId) || [];
  history.push(event);
  sessionHistory.set(currentSessionId, history);

  try {
    await invoke("record_deflection_event", { event });
  } catch {
    storeLocalDeflection(event);
  }
}

// Local storage fallback for deflection events
const LOCAL_DEFLECTION_KEY = "hadron_deflection_events";

function storeLocalDeflection(event: DeflectionEvent): void {
  try {
    const existing = localStorage.getItem(LOCAL_DEFLECTION_KEY);
    const events: DeflectionEvent[] = existing ? JSON.parse(existing) : [];
    events.push(event);
    // Keep last 1000 events
    if (events.length > 1000) {
      events.splice(0, events.length - 1000);
    }
    localStorage.setItem(LOCAL_DEFLECTION_KEY, JSON.stringify(events));
  } catch (e) {
    logger.warn("Failed to store deflection locally", { error: e });
  }
}

/**
 * Get local deflection events (for sync)
 */
export function getLocalDeflections(): DeflectionEvent[] {
  try {
    const stored = localStorage.getItem(LOCAL_DEFLECTION_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Calculate deflection statistics
 */
export async function getDeflectionStats(
  startDate?: string,
  endDate?: string
): Promise<DeflectionStats> {
  // Get local events
  const events = getLocalDeflections();

  // Filter by date if provided
  let filtered = events;
  if (startDate) {
    filtered = filtered.filter(e => e.timestamp >= startDate);
  }
  if (endDate) {
    filtered = filtered.filter(e => e.timestamp <= endDate);
  }

  // Calculate stats
  const totalSessions = new Set(filtered.map(e => e.sessionId)).size;
  const deflectedSessions = new Set(
    filtered.filter(e => e.wasHelpful && !e.ticketCreated).map(e => e.sessionId)
  ).size;

  const solutionCounts: Record<string, number> = {};
  for (const event of filtered) {
    if (event.wasHelpful && event.solutionUsed) {
      solutionCounts[event.solutionUsed] = (solutionCounts[event.solutionUsed] || 0) + 1;
    }
  }

  const topHelpfulSolutions = Object.entries(solutionCounts)
    .map(([solutionId, helpfulCount]) => ({ solutionId, helpfulCount }))
    .sort((a, b) => b.helpfulCount - a.helpfulCount)
    .slice(0, 10);

  return {
    totalSessions,
    deflectedSessions,
    deflectionRate: totalSessions > 0 ? deflectedSessions / totalSessions : 0,
    avgSuggestionsShown: filtered.reduce((sum, e) => sum + e.suggestionsShown.length, 0) / (filtered.length || 1),
    topHelpfulSolutions,
    byComponent: {}, // TODO: Track by component
    periodStart: startDate || filtered[0]?.timestamp || new Date().toISOString(),
    periodEnd: endDate || new Date().toISOString(),
  };
}

// ============================================================================
// Export
// ============================================================================

export default {
  startSession,
  getCurrentSessionId,
  getSuggestions,
  recordSolutionHelpful,
  recordTicketCreation,
  getDeflectionStats,
  getLocalDeflections,
};
