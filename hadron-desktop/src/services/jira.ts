/**
 * JIRA Integration Service
 * Handles JIRA ticket creation from crash analysis results
 */

import { invoke } from "@tauri-apps/api/core";
import { getSetting, storeSetting, getApiKey } from "./secure-storage";
import logger from "./logger";

// JIRA Configuration
export interface JiraConfig {
  enabled: boolean;
  baseUrl: string;        // e.g., https://company.atlassian.net
  projectKey: string;     // e.g., CRASH, BUG
  email: string;          // JIRA account email
  issueType: string;      // Bug, Task, Story, etc.
  defaultLabels: string[];
}

// JIRA Ticket data structure
export interface JiraTicket {
  projectKey: string;
  summary: string;
  description: string;
  priority: JiraPriority;
  labels: string[];
  components?: string[];
}

// JIRA Priority mapping from severity
export type JiraPriority = "Highest" | "High" | "Medium" | "Low" | "Lowest";

// JIRA API response
export interface JiraCreateResponse {
  success: boolean;
  ticketKey?: string;     // e.g., CRASH-123
  ticketUrl?: string;     // Full URL to ticket
  error?: string;
}

// Available issue types (fetched from JIRA)
export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
}

// JIRA Project info
export interface JiraProject {
  key: string;
  name: string;
  issueTypes?: JiraIssueType[];
}

export interface JiraProjectInfo {
  key: string;
  name: string;
}

const PROJECTS_CACHE_KEY = "jira_projects_cache";
const PROJECTS_CACHE_TS_KEY = "jira_projects_cache_ts";

// Default configuration
const DEFAULT_JIRA_CONFIG: JiraConfig = {
  enabled: false,
  baseUrl: "",
  projectKey: "",
  email: "",
  issueType: "Bug",
  defaultLabels: ["crash-analysis", "hadron"],
};

// Config cache
let configCache: JiraConfig | null = null;

/**
 * Get JIRA configuration
 */
export async function getJiraConfig(): Promise<JiraConfig> {
  if (configCache) {
    return configCache;
  }

  try {
    const enabled = await getSetting<boolean>("jira_enabled", false);
    const baseUrl = await getSetting<string>("jira_base_url", "");
    const projectKey = await getSetting<string>("jira_project_key", "");
    const email = await getSetting<string>("jira_email", "");
    const issueType = await getSetting<string>("jira_issue_type", "Bug");
    const labelsJson = await getSetting<string>("jira_labels", "[]");

    let defaultLabels = DEFAULT_JIRA_CONFIG.defaultLabels;
    try {
      defaultLabels = JSON.parse(labelsJson || "[]");
    } catch {
      // Use defaults if parse fails
    }

    configCache = {
      enabled: enabled || false,
      baseUrl: baseUrl || "",
      projectKey: projectKey || "",
      email: email || "",
      issueType: issueType || "Bug",
      defaultLabels,
    };

    return configCache;
  } catch (error) {
    logger.error("Failed to load JIRA config", { error });
    return DEFAULT_JIRA_CONFIG;
  }
}

/**
 * Save JIRA configuration
 */
export async function saveJiraConfig(config: JiraConfig): Promise<void> {
  try {
    await storeSetting("jira_enabled", config.enabled);
    await storeSetting("jira_base_url", config.baseUrl);
    await storeSetting("jira_project_key", config.projectKey);
    await storeSetting("jira_email", config.email);
    await storeSetting("jira_issue_type", config.issueType);
    await storeSetting("jira_labels", JSON.stringify(config.defaultLabels));

    configCache = config;
    logger.info("JIRA config saved", { projectKey: config.projectKey });
  } catch (error) {
    logger.error("Failed to save JIRA config", { error });
    throw error;
  }
}

/**
 * Clear config cache (useful after settings change)
 */
export function clearJiraConfigCache(): void {
  configCache = null;
}

/**
 * Map crash severity to JIRA priority
 */
export function severityToJiraPriority(severity: string): JiraPriority {
  switch (severity.toLowerCase()) {
    case "critical":
      return "Highest";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "Medium";
  }
}

/**
 * Format analysis data as JIRA description (Atlassian Document Format markdown)
 */
export function formatAnalysisForJira(analysis: {
  filename: string;
  error_type: string;
  error_message?: string;
  severity: string;
  component?: string;
  root_cause: string;
  suggested_fixes: string;
  stack_trace?: string;
  ai_model: string;
  analyzed_at: string;
  analysis_type?: string;
  full_data?: string;
}): string {
  const sections: string[] = [];

  // Header
  sections.push(`h2. Crash Analysis Report`);
  sections.push(`*File:* ${analysis.filename}`);
  sections.push(`*Analyzed:* ${new Date(analysis.analyzed_at).toLocaleString()}`);
  sections.push(`*AI Model:* ${analysis.ai_model}`);
  sections.push("");

  // Error Information
  sections.push(`h3. Error Information`);
  sections.push(`*Error Type:* ${analysis.error_type}`);
  sections.push(`*Severity:* {color:${getSeverityColor(analysis.severity)}}${analysis.severity.toUpperCase()}{color}`);

  if (analysis.error_message) {
    sections.push(`*Error Message:* ${analysis.error_message}`);
  }
  if (analysis.component) {
    sections.push(`*Component:* {{${analysis.component}}}`);
  }
  sections.push("");

  // Root Cause
  sections.push(`h3. Root Cause Analysis`);
  sections.push(analysis.root_cause);
  sections.push("");

  // Suggested Fixes
  sections.push(`h3. Suggested Fixes`);
  const fixes = analysis.suggested_fixes.split("\n").filter(f => f.trim());
  fixes.forEach((fix) => {
    sections.push(`# ${fix.replace(/^\d+\.\s*/, "")}`);
  });
  sections.push("");

  // Stack Trace (collapsible)
  if (analysis.stack_trace) {
    sections.push(`{expand:Stack Trace}`);
    sections.push(`{code:java}`);
    sections.push(analysis.stack_trace.substring(0, 5000)); // Limit stack trace
    sections.push(`{code}`);
    sections.push(`{expand}`);
    sections.push("");
  }

  // Sentry context (if this is a Sentry analysis)
  if (analysis.analysis_type === "sentry" && analysis.full_data) {
    try {
      const data = JSON.parse(analysis.full_data);
      if (data.sentry_permalink) {
        sections.push(`h3. Sentry Issue`);
        sections.push(`[View in Sentry|${data.sentry_permalink}]`);
        if (data.sentry_short_id) {
          sections.push(`*Issue:* ${data.sentry_short_id}`);
        }
        sections.push("");
      }
    } catch { /* ignore parse errors */ }
  }

  // Footer
  sections.push("----");
  sections.push(`_Generated by Hadron Crash Analyzer_`);

  return sections.join("\n");
}

/**
 * Get JIRA color for severity
 */
function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "red";
    case "high":
      return "orange";
    case "medium":
      return "yellow";
    case "low":
      return "blue";
    default:
      return "gray";
  }
}

/**
 * Generate ticket summary from analysis
 */
export function generateTicketSummary(analysis: {
  filename: string;
  error_type: string;
  severity: string;
}): string {
  const prefix = analysis.severity.toUpperCase() === "CRITICAL" ? "[CRITICAL] " : "";
  return `${prefix}${analysis.error_type} in ${analysis.filename}`;
}

/**
 * Test JIRA connection
 */
export async function testJiraConnection(): Promise<{ success: boolean; message: string; projects?: JiraProject[] }> {
  try {
    const config = await getJiraConfig();
    const apiToken = await getApiKey("jira");

    if (!config.baseUrl || !config.email || !apiToken) {
      return {
        success: false,
        message: "JIRA configuration is incomplete",
      };
    }

    const result = await invoke<{ success: boolean; message: string; projects?: JiraProject[] }>(
      "test_jira_connection",
      {
        baseUrl: config.baseUrl,
        email: config.email,
        apiToken: apiToken,
      }
    );
    return result;
  } catch (error) {
    logger.error("JIRA connection test failed", { error });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection test failed",
    };
  }
}

/**
 * List available JIRA projects (for autocomplete)
 */
export async function listJiraProjects(): Promise<JiraProjectInfo[]> {
  try {
    const config = await getJiraConfig();
    const apiToken = await getApiKey("jira");

    if (!config.baseUrl || !config.email || !apiToken) {
      return [];
    }

    const result = await invoke<JiraProjectInfo[]>("list_jira_projects", {
      baseUrl: config.baseUrl,
      email: config.email,
      apiToken,
    });

    const projects = result || [];
    cacheJiraProjects(projects);
    return projects;
  } catch (error) {
    logger.error("Failed to list JIRA projects", { error });
    return [];
  }
}

/**
 * Cache project list locally for reuse
 */
export function cacheJiraProjects(projects: JiraProjectInfo[]): void {
  try {
    localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
    localStorage.setItem(PROJECTS_CACHE_TS_KEY, new Date().toISOString());
  } catch (error) {
    logger.warn("Failed to cache JIRA projects", { error });
  }
}

/**
 * Get cached project list (if any)
 */
export function getCachedJiraProjects(): { projects: JiraProjectInfo[]; updatedAt: string | null } {
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
    const ts = localStorage.getItem(PROJECTS_CACHE_TS_KEY);
    if (!raw) {
      return { projects: [], updatedAt: ts };
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { projects: [], updatedAt: ts };
    }
    return { projects: parsed as JiraProjectInfo[], updatedAt: ts };
  } catch (error) {
    logger.warn("Failed to read cached JIRA projects", { error });
    return { projects: [], updatedAt: null };
  }
}

/**
 * Create JIRA ticket from analysis
 */
export async function createJiraTicket(ticket: JiraTicket): Promise<JiraCreateResponse> {
  try {
    const config = await getJiraConfig();
    const apiToken = await getApiKey("jira");

    if (!config.enabled) {
      return { success: false, error: "JIRA integration is not enabled" };
    }

    if (!config.baseUrl || !config.email || !apiToken) {
      return { success: false, error: "JIRA configuration is incomplete" };
    }

    if (!ticket.projectKey) {
      return { success: false, error: "Project key is required" };
    }

    const result = await invoke<JiraCreateResponse>("create_jira_ticket", {
      baseUrl: config.baseUrl,
      email: config.email,
      apiToken: apiToken,
      projectKey: ticket.projectKey,
      issueType: config.issueType,
      ticket: {
        summary: ticket.summary,
        description: ticket.description,
        priority: ticket.priority,
        labels: ticket.labels,
        components: ticket.components,
      },
    });

    if (result.success) {
      logger.info("JIRA ticket created", { ticketKey: result.ticketKey });
    } else {
      logger.error("Failed to create JIRA ticket", { error: result.error });
    }

    return result;
  } catch (error) {
    logger.error("JIRA ticket creation failed", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create ticket",
    };
  }
}

/**
 * Check if JIRA is configured and enabled
 */
export async function isJiraEnabled(): Promise<boolean> {
  const config = await getJiraConfig();
  return config.enabled && !!config.baseUrl && !!config.email;
}
