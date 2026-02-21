/**
 * Release Notes Generator Service
 * Handles Tauri command invocations and config management for release notes.
 */

import { invoke } from "@tauri-apps/api/core";
import { getSetting, getApiKey } from "./secure-storage";
import { getStoredProvider, getStoredModel } from "./api";
import logger from "./logger";
import type {
  ReleaseNotesConfig,
  ReleaseNotesDraft,
  ReleaseNotesSummary,
  ReleaseNoteTicketPreview,
  JiraFixVersion,
  ReleaseNotesExportFormat,
  AiEnrichmentConfig,
  ReleaseNotesContentType,
  ComplianceReport,
} from "../types";

// ============================================================================
// JIRA Config Helpers
// ============================================================================

interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

async function getJiraCredentials(): Promise<JiraCredentials> {
  const baseUrl = (await getSetting<string>("jira_base_url", "")) || "";
  const email = (await getSetting<string>("jira_email", "")) || "";
  const apiToken = (await getApiKey("jira")) || "";
  const projectKey = (await getSetting<string>("jira_project_key", "")) || "";

  if (!baseUrl || !email || !apiToken) {
    throw new Error("JIRA is not configured. Please set up JIRA in Settings.");
  }

  return { baseUrl, email, apiToken, projectKey };
}

async function getAiCredentials(): Promise<{ apiKey: string; model: string; provider: string }> {
  const provider = getStoredProvider();
  const model = getStoredModel();
  const apiKey = await getApiKey(provider);

  if (!apiKey) {
    throw new Error("AI provider is not configured. Please set an API key in Settings.");
  }

  return { apiKey, model, provider };
}

// ============================================================================
// Fix Version Operations
// ============================================================================

export async function listFixVersions(projectKey?: string): Promise<JiraFixVersion[]> {
  try {
    const jira = await getJiraCredentials();
    const key = projectKey || jira.projectKey;

    if (!key) {
      throw new Error("No JIRA project key configured.");
    }

    const versions = await invoke<JiraFixVersion[]>("list_jira_fix_versions", {
      baseUrl: jira.baseUrl,
      email: jira.email,
      apiToken: jira.apiToken,
      projectKey: key,
    });

    logger.info("Listed fix versions", { count: versions.length, projectKey: key });
    return versions;
  } catch (error) {
    logger.error("Failed to list fix versions", { error });
    throw error;
  }
}

// ============================================================================
// Ticket Preview
// ============================================================================

export async function previewTickets(
  fixVersion: string,
  contentType: ReleaseNotesContentType = "both",
  jqlFilter?: string,
  moduleFilter?: string[],
): Promise<ReleaseNoteTicketPreview[]> {
  try {
    const jira = await getJiraCredentials();

    const config: ReleaseNotesConfig = {
      fixVersion,
      contentType,
      projectKey: jira.projectKey || undefined,
      jqlFilter,
      moduleFilter,
      aiEnrichment: {
        rewriteDescriptions: false,
        generateKeywords: false,
        classifyModules: false,
        detectBreakingChanges: false,
      },
    };

    const tickets = await invoke<ReleaseNoteTicketPreview[]>("preview_release_notes_tickets", {
      config,
      baseUrl: jira.baseUrl,
      email: jira.email,
      apiToken: jira.apiToken,
    });

    logger.info("Previewed tickets", { count: tickets.length, fixVersion });
    return tickets;
  } catch (error) {
    logger.error("Failed to preview tickets", { error });
    throw error;
  }
}

// ============================================================================
// Generation
// ============================================================================

export interface GenerateOptions {
  fixVersion: string;
  contentType: ReleaseNotesContentType;
  requestId?: string;
  jqlFilter?: string;
  moduleFilter?: string[];
  aiEnrichment?: Partial<AiEnrichmentConfig>;
}

export async function generateReleaseNotes(options: GenerateOptions) {
  try {
    const jira = await getJiraCredentials();
    const ai = await getAiCredentials();

    const config: ReleaseNotesConfig = {
      fixVersion: options.fixVersion,
      contentType: options.contentType,
      projectKey: jira.projectKey || undefined,
      jqlFilter: options.jqlFilter,
      moduleFilter: options.moduleFilter,
      aiEnrichment: {
        rewriteDescriptions: true,
        generateKeywords: true,
        classifyModules: true,
        detectBreakingChanges: true,
        ...options.aiEnrichment,
      },
    };

    const result = await invoke("generate_release_notes", {
      config,
      requestId: options.requestId || null,
      baseUrl: jira.baseUrl,
      email: jira.email,
      apiToken: jira.apiToken,
      apiKey: ai.apiKey,
      model: ai.model,
      provider: ai.provider,
    });

    logger.info("Generated release notes", { fixVersion: options.fixVersion });
    return result;
  } catch (error) {
    logger.error("Failed to generate release notes", { error });
    throw error;
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function getReleaseNotes(id: number): Promise<ReleaseNotesDraft | null> {
  try {
    return await invoke<ReleaseNotesDraft | null>("get_release_notes", { id });
  } catch (error) {
    logger.error("Failed to get release notes", { id, error });
    throw error;
  }
}

export async function listReleaseNotes(
  status?: string,
  limit = 50,
  offset = 0,
): Promise<ReleaseNotesSummary[]> {
  try {
    return await invoke<ReleaseNotesSummary[]>("list_release_notes", {
      status: status || null,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Failed to list release notes", { error });
    throw error;
  }
}

export async function updateContent(id: number, content: string): Promise<void> {
  try {
    await invoke("update_release_notes_content", { id, content });
    logger.info("Updated release notes content", { id });
  } catch (error) {
    logger.error("Failed to update content", { id, error });
    throw error;
  }
}

export async function updateStatus(
  id: number,
  status: string,
  reviewedBy?: string,
): Promise<void> {
  try {
    await invoke("update_release_notes_status", {
      id,
      status,
      reviewedBy: reviewedBy || null,
    });
    logger.info("Updated release notes status", { id, status });
  } catch (error) {
    logger.error("Failed to update status", { id, error });
    throw error;
  }
}

export async function updateChecklist(id: number, checklistJson: string): Promise<void> {
  try {
    await invoke("update_release_notes_checklist", { id, checklistJson });
  } catch (error) {
    logger.error("Failed to update checklist", { id, error });
    throw error;
  }
}

// ============================================================================
// Incremental Update
// ============================================================================

export async function appendToReleaseNotes(
  id: number,
  fixVersion: string,
  contentType: ReleaseNotesContentType = "both",
  jqlFilter?: string,
  requestId?: string,
) {
  try {
    const jira = await getJiraCredentials();
    const ai = await getAiCredentials();

    const config: ReleaseNotesConfig = {
      fixVersion,
      contentType,
      projectKey: jira.projectKey || undefined,
      jqlFilter,
      aiEnrichment: {
        rewriteDescriptions: true,
        generateKeywords: true,
        classifyModules: true,
        detectBreakingChanges: true,
      },
    };

    const result = await invoke("append_to_release_notes", {
      id,
      config,
      requestId: requestId || null,
      baseUrl: jira.baseUrl,
      email: jira.email,
      apiToken: jira.apiToken,
      apiKey: ai.apiKey,
      model: ai.model,
      provider: ai.provider,
    });

    logger.info("Appended to release notes", { id });
    return result;
  } catch (error) {
    logger.error("Failed to append to release notes", { id, error });
    throw error;
  }
}

// ============================================================================
// Export
// ============================================================================

export async function exportReleaseNotes(
  id: number,
  format: ReleaseNotesExportFormat,
): Promise<string> {
  try {
    const content = await invoke<string>("export_release_notes", { id, format });
    logger.info("Exported release notes", { id, format });
    return content;
  } catch (error) {
    logger.error("Failed to export release notes", { id, format, error });
    throw error;
  }
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteReleaseNotes(id: number): Promise<void> {
  try {
    await invoke("delete_release_notes", { id });
    logger.info("Deleted release notes", { id });
  } catch (error) {
    logger.error("Failed to delete release notes", { id, error });
    throw error;
  }
}

// ============================================================================
// Style Compliance
// ============================================================================

export async function checkCompliance(content: string): Promise<ComplianceReport> {
  try {
    const ai = await getAiCredentials();
    return await invoke<ComplianceReport>("check_release_notes_compliance", {
      content,
      apiKey: ai.apiKey,
      model: ai.model,
      provider: ai.provider,
    });
  } catch (error) {
    logger.error("Compliance check failed", { error });
    throw error;
  }
}
