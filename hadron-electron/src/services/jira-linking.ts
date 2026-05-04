/**
 * JIRA Ticket Linking Service
 * Phase 3: Links JIRA tickets to crash analyses for bidirectional correlation
 *
 * This service provides the TypeScript API for:
 * - Linking/unlinking JIRA tickets to analyses
 * - Retrieving linked tickets for an analysis
 * - Retrieving linked analyses for a ticket
 * - Updating ticket metadata when status changes
 */

import { invoke } from "@tauri-apps/api/core";
import logger from "./logger";

// ============================================================================
// Types
// ============================================================================

/**
 * A link between a JIRA ticket and a crash analysis
 */
export interface JiraLink {
  id: number;
  analysisId: number;
  jiraKey: string;
  jiraUrl?: string;
  jiraSummary?: string;
  jiraStatus?: string;
  jiraPriority?: string;
  linkType: string;
  linkedAt: string;
  linkedBy?: string;
  notes?: string;
}

/**
 * Request to link a JIRA ticket to an analysis
 */
export interface LinkJiraTicketRequest {
  analysisId: number;
  jiraKey: string;
  jiraUrl?: string;
  jiraSummary?: string;
  jiraStatus?: string;
  jiraPriority?: string;
  linkType?: "related" | "causes" | "caused_by" | "duplicates" | "blocks";
  notes?: string;
}

/**
 * Analysis data returned when querying by JIRA ticket
 */
export interface LinkedAnalysis {
  analysis: {
    id: number;
    filename: string;
    fileSizeKb: number;
    errorType: string;
    errorMessage?: string;
    severity: string;
    component?: string;
    rootCause: string;
    analyzedAt: string;
    aiModel: string;
  };
  link: JiraLink;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Link a JIRA ticket to an analysis
 */
export async function linkJiraToAnalysis(
  request: LinkJiraTicketRequest
): Promise<JiraLink> {
  logger.info("Linking JIRA ticket to analysis", {
    analysisId: request.analysisId,
    jiraKey: request.jiraKey,
  });

  try {
    const link = await invoke<JiraLink>("link_jira_to_analysis", { request });
    logger.info("Successfully linked JIRA ticket", {
      linkId: link.id,
      jiraKey: link.jiraKey,
    });
    return link;
  } catch (error) {
    logger.error("Failed to link JIRA ticket", { error, request });
    throw error;
  }
}

/**
 * Unlink a JIRA ticket from an analysis
 */
export async function unlinkJiraFromAnalysis(
  analysisId: number,
  jiraKey: string
): Promise<boolean> {
  logger.info("Unlinking JIRA ticket from analysis", { analysisId, jiraKey });

  try {
    const result = await invoke<boolean>("unlink_jira_from_analysis", {
      analysisId,
      jiraKey,
    });
    logger.info("Successfully unlinked JIRA ticket", { analysisId, jiraKey });
    return result;
  } catch (error) {
    logger.error("Failed to unlink JIRA ticket", { error, analysisId, jiraKey });
    throw error;
  }
}

/**
 * Get all JIRA links for a specific analysis
 */
export async function getJiraLinksForAnalysis(
  analysisId: number
): Promise<JiraLink[]> {
  logger.debug("Getting JIRA links for analysis", { analysisId });

  try {
    const links = await invoke<JiraLink[]>("get_jira_links_for_analysis", {
      analysisId,
    });
    return links;
  } catch (error) {
    logger.error("Failed to get JIRA links", { error, analysisId });
    throw error;
  }
}

/**
 * Get all analyses linked to a specific JIRA ticket
 */
export async function getAnalysesForJiraTicket(
  jiraKey: string
): Promise<LinkedAnalysis[]> {
  logger.debug("Getting analyses for JIRA ticket", { jiraKey });

  try {
    // The backend returns tuples [Analysis, JiraLink]
    const results = await invoke<Array<[any, JiraLink]>>(
      "get_analyses_for_jira_ticket",
      { jiraKey }
    );

    // Transform to LinkedAnalysis format
    return results.map(([analysis, link]) => ({
      analysis: {
        id: analysis.id,
        filename: analysis.filename,
        fileSizeKb: analysis.file_size_kb,
        errorType: analysis.error_type,
        errorMessage: analysis.error_message,
        severity: analysis.severity,
        component: analysis.component,
        rootCause: analysis.root_cause,
        analyzedAt: analysis.analyzed_at,
        aiModel: analysis.ai_model,
      },
      link,
    }));
  } catch (error) {
    logger.error("Failed to get analyses for JIRA ticket", { error, jiraKey });
    throw error;
  }
}

/**
 * Update JIRA ticket metadata in all links
 * Useful when a ticket's status, priority, or summary changes
 */
export async function updateJiraLinkMetadata(
  jiraKey: string,
  updates: {
    jiraSummary?: string;
    jiraStatus?: string;
    jiraPriority?: string;
  }
): Promise<number> {
  logger.info("Updating JIRA link metadata", { jiraKey, updates });

  try {
    const updatedCount = await invoke<number>("update_jira_link_metadata", {
      jiraKey,
      jiraSummary: updates.jiraSummary,
      jiraStatus: updates.jiraStatus,
      jiraPriority: updates.jiraPriority,
    });
    logger.info("Updated JIRA link metadata", { jiraKey, updatedCount });
    return updatedCount;
  } catch (error) {
    logger.error("Failed to update JIRA link metadata", { error, jiraKey });
    throw error;
  }
}

/**
 * Count JIRA links for an analysis
 */
export async function countJiraLinksForAnalysis(
  analysisId: number
): Promise<number> {
  try {
    return await invoke<number>("count_jira_links_for_analysis", { analysisId });
  } catch (error) {
    logger.error("Failed to count JIRA links", { error, analysisId });
    throw error;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the link type display name
 */
export function getLinkTypeDisplayName(
  linkType: string
): { label: string; description: string } {
  const types: Record<string, { label: string; description: string }> = {
    related: {
      label: "Related",
      description: "This analysis is related to the ticket",
    },
    causes: {
      label: "Causes",
      description: "This crash analysis describes the cause of the ticket",
    },
    caused_by: {
      label: "Caused By",
      description: "This crash is caused by the issue in the ticket",
    },
    duplicates: {
      label: "Duplicates",
      description: "This analysis duplicates another ticket",
    },
    blocks: {
      label: "Blocks",
      description: "This crash blocks the ticket from being resolved",
    },
  };

  return types[linkType] || { label: linkType, description: "" };
}

/**
 * Get available link types for UI selection
 */
export function getAvailableLinkTypes(): Array<{
  value: string;
  label: string;
  description: string;
}> {
  return [
    {
      value: "related",
      label: "Related",
      description: "This analysis is related to the ticket",
    },
    {
      value: "causes",
      label: "Causes",
      description: "This crash analysis describes the cause of the ticket",
    },
    {
      value: "caused_by",
      label: "Caused By",
      description: "This crash is caused by the issue in the ticket",
    },
    {
      value: "duplicates",
      label: "Duplicates",
      description: "This analysis duplicates another ticket",
    },
    {
      value: "blocks",
      label: "Blocks",
      description: "This crash blocks the ticket from being resolved",
    },
  ];
}

/**
 * Format a JIRA status for display with appropriate styling
 */
export function getStatusStyle(status?: string): {
  bgColor: string;
  textColor: string;
  borderColor: string;
} {
  if (!status) {
    return {
      bgColor: "bg-gray-500/20",
      textColor: "text-gray-400",
      borderColor: "border-gray-500/30",
    };
  }

  const statusLower = status.toLowerCase();

  // Green statuses (done, resolved, closed)
  if (
    statusLower.includes("done") ||
    statusLower.includes("resolved") ||
    statusLower.includes("closed")
  ) {
    return {
      bgColor: "bg-green-500/20",
      textColor: "text-green-400",
      borderColor: "border-green-500/30",
    };
  }

  // Blue statuses (in progress, in review)
  if (
    statusLower.includes("progress") ||
    statusLower.includes("review") ||
    statusLower.includes("testing")
  ) {
    return {
      bgColor: "bg-blue-500/20",
      textColor: "text-blue-400",
      borderColor: "border-blue-500/30",
    };
  }

  // Yellow statuses (open, todo, backlog)
  if (
    statusLower.includes("open") ||
    statusLower.includes("todo") ||
    statusLower.includes("backlog") ||
    statusLower.includes("new")
  ) {
    return {
      bgColor: "bg-yellow-500/20",
      textColor: "text-yellow-400",
      borderColor: "border-yellow-500/30",
    };
  }

  // Red statuses (blocked, rejected)
  if (statusLower.includes("blocked") || statusLower.includes("rejected")) {
    return {
      bgColor: "bg-red-500/20",
      textColor: "text-red-400",
      borderColor: "border-red-500/30",
    };
  }

  // Default gray
  return {
    bgColor: "bg-gray-500/20",
    textColor: "text-gray-400",
    borderColor: "border-gray-500/30",
  };
}

/**
 * Format a JIRA priority for display
 */
export function getPriorityStyle(priority?: string): {
  bgColor: string;
  textColor: string;
  icon: string;
} {
  if (!priority) {
    return { bgColor: "bg-gray-500/20", textColor: "text-gray-400", icon: "−" };
  }

  const priorityLower = priority.toLowerCase();

  if (priorityLower.includes("highest") || priorityLower.includes("blocker")) {
    return { bgColor: "bg-red-500/20", textColor: "text-red-400", icon: "⬆⬆" };
  }

  if (priorityLower.includes("high") || priorityLower.includes("critical")) {
    return { bgColor: "bg-orange-500/20", textColor: "text-orange-400", icon: "⬆" };
  }

  if (priorityLower.includes("medium") || priorityLower.includes("major")) {
    return { bgColor: "bg-yellow-500/20", textColor: "text-yellow-400", icon: "−" };
  }

  if (priorityLower.includes("low") || priorityLower.includes("minor")) {
    return { bgColor: "bg-blue-500/20", textColor: "text-blue-400", icon: "⬇" };
  }

  if (priorityLower.includes("lowest") || priorityLower.includes("trivial")) {
    return { bgColor: "bg-gray-500/20", textColor: "text-gray-400", icon: "⬇⬇" };
  }

  return { bgColor: "bg-gray-500/20", textColor: "text-gray-400", icon: "−" };
}
