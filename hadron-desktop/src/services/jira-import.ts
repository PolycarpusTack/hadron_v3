/**
 * JIRA Import Service
 * Phase 3 - Imports JIRA tickets for RAG context and crash analysis correlation
 *
 * Refactored to address technical debt:
 * - TDR-001: Uses IndexedDB storage adapter instead of localStorage
 * - TDR-002: Uses rate limiter with circuit breaker
 * - TDR-003: Uses atomic transactions for sync operations
 * - Refactored god functions into smaller, focused functions
 */

import { invoke } from "@tauri-apps/api/core";
import { getJiraConfig, type JiraConfig } from "./jira";
import { getApiKey } from "./secure-storage";
import logger from "./logger";
import {
  JIRA_CONFIG,
  getStorageAdapter,
  type SyncState,
  type IssueStorageAdapter,
} from "./jira-storage";
import { executeWithResilience, getJiraApiHealth } from "./jira-rate-limiter";

// ============================================================================
// Normalized Issue Schema (Platform-Agnostic)
// ============================================================================

export interface NormalizedIssue {
  /** Unique identifier (platform:key format) */
  id: string;
  /** Source platform */
  platform: "jira" | "github" | "azure_devops";
  /** Issue key (e.g., CRASH-123) */
  key: string;
  /** Issue summary/title */
  summary: string;
  /** Plaintext description (converted from ADF/markdown) */
  descriptionPlaintext: string;
  /** Original description format */
  descriptionRaw?: string;
  /** Issue status */
  status: string;
  /** Priority level */
  priority: string;
  /** Issue type (Bug, Task, etc.) */
  issueType: string;
  /** Assignee information */
  assignee?: {
    displayName: string;
    email?: string;
  };
  /** Reporter information */
  reporter?: {
    displayName: string;
    email?: string;
  };
  /** Labels/tags */
  labels: string[];
  /** Component names */
  components: string[];
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Resolution timestamp */
  resolvedAt?: string;
  /** Resolution type */
  resolution?: string;
  /** Linked issues */
  linkedIssues: LinkedIssue[];
  /** Comments (plaintext converted) */
  comments: NormalizedComment[];
  /** Custom fields relevant to crash analysis */
  customFields: Record<string, unknown>;
  /** Original URL */
  url: string;
  /** Extracted error signatures from description/comments */
  extractedSignatures: string[];
  /** Confidence score for crash relevance (0-1) */
  crashRelevanceScore: number;
}

export interface LinkedIssue {
  key: string;
  type: "blocks" | "is_blocked_by" | "duplicates" | "is_duplicated_by" | "relates_to" | "causes" | "is_caused_by";
  summary?: string;
}

export interface NormalizedComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================================
// ADF (Atlassian Document Format) Types
// ============================================================================

interface ADFNode {
  type: string;
  text?: string;
  content?: ADFNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

interface ADFDocument {
  type: "doc";
  version: 1;
  content: ADFNode[];
}

// ============================================================================
// JIRA API Response Types
// ============================================================================

interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: ADFDocument | string | null;
    status: {
      name: string;
      statusCategory: { key: string };
    };
    priority?: {
      name: string;
    };
    issuetype: {
      name: string;
    };
    assignee?: {
      displayName: string;
      emailAddress?: string;
    };
    reporter?: {
      displayName: string;
      emailAddress?: string;
    };
    labels: string[];
    components: Array<{ name: string }>;
    created: string;
    updated: string;
    resolutiondate?: string;
    resolution?: {
      name: string;
    };
    issuelinks?: Array<{
      type: { name: string; inward: string; outward: string };
      inwardIssue?: { key: string; fields?: { summary?: string } };
      outwardIssue?: { key: string; fields?: { summary?: string } };
    }>;
    comment?: {
      comments: Array<{
        id: string;
        author: { displayName: string };
        body: ADFDocument | string;
        created: string;
        updated?: string;
      }>;
    };
    [key: string]: unknown;
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
  nextPageToken?: string;
}

// ============================================================================
// ADF to Plaintext Converter
// ============================================================================

/**
 * Convert Atlassian Document Format (ADF) to plaintext
 * Includes size limit to prevent DoS from malicious documents
 */
export function adfToPlaintext(adf: ADFDocument | string | null | undefined): string {
  if (!adf) return "";

  // If it's already a string, return it (with size limit)
  if (typeof adf === "string") {
    if (adf.length > JIRA_CONFIG.maxAdfSizeBytes) {
      logger.warn("ADF string exceeds size limit, truncating", {
        size: adf.length,
        limit: JIRA_CONFIG.maxAdfSizeBytes,
      });
      return adf.slice(0, JIRA_CONFIG.maxAdfSizeBytes) + "\n[Content truncated due to size]";
    }
    return adf;
  }

  // Check size of ADF object
  try {
    const adfString = JSON.stringify(adf);
    if (adfString.length > JIRA_CONFIG.maxAdfSizeBytes) {
      logger.warn("ADF document exceeds size limit", {
        size: adfString.length,
        limit: JIRA_CONFIG.maxAdfSizeBytes,
      });
      // Still process but limit depth/content
      return convertADFNodes(adf.content?.slice(0, 50) || []).trim() +
        "\n[Content truncated due to size]";
    }
  } catch {
    // If we can't stringify, proceed with caution
  }

  // If it's not a valid ADF document, try to stringify
  if (adf.type !== "doc" || !Array.isArray(adf.content)) {
    try {
      const str = JSON.stringify(adf);
      return str.slice(0, JIRA_CONFIG.maxAdfSizeBytes);
    } catch {
      return "";
    }
  }

  return convertADFNodes(adf.content).trim();
}

function convertADFNodes(nodes: ADFNode[]): string {
  if (!nodes || !Array.isArray(nodes)) return "";

  return nodes.map(node => convertADFNode(node)).join("");
}

function convertADFNode(node: ADFNode): string {
  if (!node) return "";

  switch (node.type) {
    case "text":
      return node.text || "";

    case "paragraph":
      return convertADFNodes(node.content || []) + "\n\n";

    case "heading": {
      const level = (node.attrs?.level as number) || 1;
      const prefix = "#".repeat(level) + " ";
      return prefix + convertADFNodes(node.content || []) + "\n\n";
    }

    case "bulletList":
      return convertListItems(node.content || [], "- ") + "\n";

    case "orderedList":
      return convertOrderedListItems(node.content || []) + "\n";

    case "listItem":
      return convertADFNodes(node.content || []);

    case "codeBlock": {
      const code = convertADFNodes(node.content || []);
      const language = (node.attrs?.language as string) || "";
      return `\n\`\`\`${language}\n${code}\`\`\`\n\n`;
    }

    case "blockquote":
      return convertADFNodes(node.content || [])
        .split("\n")
        .map(line => `> ${line}`)
        .join("\n") + "\n\n";

    case "rule":
      return "\n---\n\n";

    case "hardBreak":
      return "\n";

    case "inlineCard":
    case "blockCard": {
      const url = (node.attrs?.url as string) || "";
      return url ? `[${url}](${url})` : "";
    }

    case "mention": {
      const text = (node.attrs?.text as string) || "";
      return text ? `@${text}` : "";
    }

    case "emoji": {
      const shortName = (node.attrs?.shortName as string) || "";
      return shortName || "";
    }

    case "table":
      return convertTable(node) + "\n\n";

    case "tableRow":
    case "tableCell":
    case "tableHeader":
      return convertADFNodes(node.content || []);

    case "panel": {
      const panelType = (node.attrs?.panelType as string) || "info";
      const content = convertADFNodes(node.content || []);
      return `[${panelType.toUpperCase()}]\n${content}\n`;
    }

    case "expand": {
      const title = (node.attrs?.title as string) || "Details";
      const content = convertADFNodes(node.content || []);
      return `${title}:\n${content}\n`;
    }

    case "mediaGroup":
    case "mediaSingle":
      return "[Media attachment]\n";

    default:
      // Recursively process unknown nodes with content
      if (node.content) {
        return convertADFNodes(node.content);
      }
      return "";
  }
}

function convertListItems(items: ADFNode[], prefix: string): string {
  return items
    .map(item => prefix + convertADFNodes(item.content || []).trim())
    .join("\n");
}

function convertOrderedListItems(items: ADFNode[]): string {
  return items
    .map((item, idx) => `${idx + 1}. ${convertADFNodes(item.content || []).trim()}`)
    .join("\n");
}

function convertTable(node: ADFNode): string {
  if (!node.content) return "";

  const rows = node.content.map(row => {
    if (!row.content) return "";
    const cells = row.content.map(cell => convertADFNodes(cell.content || []).trim());
    return `| ${cells.join(" | ")} |`;
  });

  if (rows.length > 0) {
    // Add header separator after first row
    const headerSep = `| ${rows[0].split("|").slice(1, -1).map(() => "---").join(" | ")} |`;
    return [rows[0], headerSep, ...rows.slice(1)].join("\n");
  }

  return rows.join("\n");
}

// ============================================================================
// Error Signature Extraction
// ============================================================================

/**
 * Extract potential error signatures from text
 */
export function extractErrorSignatures(text: string): string[] {
  const signatures: Set<string> = new Set();

  if (!text) return [];

  // Common error patterns
  const patterns = [
    // Exception types with messages
    /(?:Exception|Error|Fault|Crash|Panic):\s*([^\n]{10,100})/gi,
    // Stack trace method signatures
    /at\s+([\w.$]+)\s*\([^)]*\)/g,
    // Error codes
    /(?:Error|Code|Status)[\s:]+([A-Z_]+\d+|\d{4,})/gi,
    // Memory addresses (crash signatures)
    /0x[0-9a-fA-F]{8,16}/g,
    // Smalltalk-style error messages
    /(?:MessageNotUnderstood|DoesNotUnderstand|walkback):\s*([^\n]+)/gi,
    // Common error class names
    /\b([A-Z][a-zA-Z]*(?:Exception|Error|Fault|Crash))\b/g,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const sig = (match[1] || match[0]).trim();
      if (sig.length >= 5 && sig.length <= 200) {
        signatures.add(sig);
      }
    }
  }

  return Array.from(signatures).slice(0, JIRA_CONFIG.maxSignatures);
}

/**
 * Calculate crash relevance score based on content
 */
export function calculateCrashRelevanceScore(issue: Partial<NormalizedIssue>): number {
  let score = 0;
  const text = [
    issue.summary || "",
    issue.descriptionPlaintext || "",
    ...(issue.comments?.map(c => c.body) || []),
  ].join(" ").toLowerCase();

  // High-value keywords
  const highValueKeywords = [
    "crash", "exception", "error", "bug", "defect", "walkback",
    "stack trace", "stacktrace", "memory", "null pointer", "segfault",
    "out of memory", "heap", "gc", "garbage collection",
  ];

  // Medium-value keywords
  const mediumValueKeywords = [
    "issue", "problem", "failure", "failed", "broken", "fix",
    "reproduce", "steps", "workaround", "regression",
  ];

  // Check keywords
  for (const kw of highValueKeywords) {
    if (text.includes(kw)) score += 0.15;
  }

  for (const kw of mediumValueKeywords) {
    if (text.includes(kw)) score += 0.05;
  }

  // Boost for issue type
  const issueType = (issue.issueType || "").toLowerCase();
  if (issueType === "bug" || issueType === "defect") score += 0.2;
  if (issueType === "incident" || issueType === "problem") score += 0.15;

  // Boost for labels
  const labels = (issue.labels || []).map(l => l.toLowerCase());
  if (labels.some(l => l.includes("crash") || l.includes("bug") || l.includes("error"))) {
    score += 0.1;
  }

  // Boost for extracted signatures
  if ((issue.extractedSignatures?.length || 0) > 0) {
    score += 0.1 * Math.min(issue.extractedSignatures!.length, 5);
  }

  // Normalize to 0-1
  return Math.min(1, Math.max(0, score));
}

// ============================================================================
// JIRA Issue Normalizer (Refactored - TDR: Extract god function)
// ============================================================================

/**
 * Convert JIRA comments to normalized format
 */
function normalizeComments(
  commentData: JiraIssue["fields"]["comment"]
): NormalizedComment[] {
  return (commentData?.comments || []).map(c => ({
    id: c.id,
    author: c.author.displayName,
    body: typeof c.body === "string" ? c.body : adfToPlaintext(c.body),
    createdAt: c.created,
    updatedAt: c.updated,
  }));
}

/**
 * Map JIRA link type to normalized link type
 */
function mapLinkType(
  typeName: string,
  isInward: boolean
): LinkedIssue["type"] {
  const lowerType = typeName.toLowerCase();

  if (lowerType.includes("block")) {
    return isInward ? "is_blocked_by" : "blocks";
  }
  if (lowerType.includes("duplicate")) {
    return isInward ? "is_duplicated_by" : "duplicates";
  }
  if (lowerType.includes("cause")) {
    return isInward ? "is_caused_by" : "causes";
  }

  return "relates_to";
}

/**
 * Convert JIRA issue links to normalized format
 */
function normalizeLinks(
  issueLinks: JiraIssue["fields"]["issuelinks"]
): LinkedIssue[] {
  return (issueLinks || [])
    .filter(link => link.inwardIssue || link.outwardIssue)
    .map(link => {
      const isInward = !!link.inwardIssue;
      const linkedKey = isInward ? link.inwardIssue!.key : link.outwardIssue!.key;
      const linkedSummary = isInward
        ? link.inwardIssue?.fields?.summary
        : link.outwardIssue?.fields?.summary;

      return {
        key: linkedKey,
        type: mapLinkType(link.type.name, isInward),
        summary: linkedSummary,
      };
    });
}

/**
 * Extract user info from JIRA user object
 */
function extractUserInfo(
  user: { displayName: string; emailAddress?: string } | undefined
): { displayName: string; email?: string } | undefined {
  if (!user) return undefined;
  return {
    displayName: user.displayName,
    email: user.emailAddress,
  };
}

/**
 * Build the core normalized issue structure
 */
function buildNormalizedIssue(
  issue: JiraIssue,
  baseUrl: string,
  descriptionPlaintext: string,
  comments: NormalizedComment[],
  linkedIssues: LinkedIssue[]
): NormalizedIssue {
  return {
    id: `jira:${issue.key}`,
    platform: "jira",
    key: issue.key,
    summary: issue.fields.summary,
    descriptionPlaintext,
    descriptionRaw: typeof issue.fields.description === "string"
      ? issue.fields.description
      : JSON.stringify(issue.fields.description),
    status: issue.fields.status.name,
    priority: issue.fields.priority?.name || "Medium",
    issueType: issue.fields.issuetype.name,
    assignee: extractUserInfo(issue.fields.assignee),
    reporter: extractUserInfo(issue.fields.reporter),
    labels: issue.fields.labels || [],
    components: (issue.fields.components || []).map(c => c.name),
    createdAt: issue.fields.created,
    updatedAt: issue.fields.updated,
    resolvedAt: issue.fields.resolutiondate,
    resolution: issue.fields.resolution?.name,
    linkedIssues,
    comments,
    customFields: {},
    url: `${baseUrl}/browse/${issue.key}`,
    extractedSignatures: [],
    crashRelevanceScore: 0,
  };
}

/**
 * Combine all text for signature extraction
 */
function combineTextForAnalysis(normalized: NormalizedIssue): string {
  return [
    normalized.summary,
    normalized.descriptionPlaintext,
    ...normalized.comments.map(c => c.body),
  ].join("\n");
}

/**
 * Normalize a JIRA issue to platform-agnostic format
 * Composed from smaller, focused functions for maintainability
 */
export function normalizeJiraIssue(issue: JiraIssue, baseUrl: string): NormalizedIssue {
  // Convert description
  const descriptionPlaintext = adfToPlaintext(issue.fields.description);

  // Normalize sub-structures
  const comments = normalizeComments(issue.fields.comment);
  const linkedIssues = normalizeLinks(issue.fields.issuelinks);

  // Build normalized issue
  const normalized = buildNormalizedIssue(
    issue,
    baseUrl,
    descriptionPlaintext,
    comments,
    linkedIssues
  );

  // Extract signatures and calculate relevance
  const allText = combineTextForAnalysis(normalized);
  normalized.extractedSignatures = extractErrorSignatures(allText);
  normalized.crashRelevanceScore = calculateCrashRelevanceScore(normalized);

  return normalized;
}

// ============================================================================
// JIRA Import Functions
// ============================================================================

export interface ImportOptions {
  /** JQL query to filter issues */
  jql?: string;
  /** Project key(s) to import from */
  projectKeys?: string[];
  /** Maximum issues to import */
  maxResults?: number;
  /** Include only issues updated after this date */
  updatedAfter?: string;
  /** Minimum crash relevance score (0-1) */
  minRelevanceScore?: number;
  /** Include comments */
  includeComments?: boolean;
  /** Cursor token for fetching the next page (from a previous ImportResult) */
  nextPageToken?: string;
}

export interface ImportResult {
  success: boolean;
  totalFetched: number;
  totalImported: number;
  issues: NormalizedIssue[];
  errors: string[];
  duration: number;
  /** Cursor token for the next page, if more results are available */
  nextPageToken?: string;
}

// ============================================================================
// Input Sanitization (Security)
// ============================================================================

/**
 * Sanitize JQL input to prevent injection attacks
 * JIRA JQL is relatively safe but we still validate and clean input
 */
export function sanitizeJQL(jql: string): string {
  if (!jql) return "";

  // Remove potential script injection patterns
  let sanitized = jql
    // Remove HTML/script tags
    .replace(/<[^>]*>/g, "")
    // Remove JavaScript event handlers
    .replace(/on\w+\s*=/gi, "")
    // Limit length to prevent DoS
    .slice(0, 2000);

  // Validate basic JQL structure - only allow safe characters
  // JQL allows: alphanumeric, spaces, quotes, operators, parentheses, dates
  const jqlPattern = /^[\w\s\-_.,"'=<>!~()AND OR NOT IN EMPTY NULL ORDER BY ASC DESC@:\/\[\]]+$/i;
  if (!jqlPattern.test(sanitized)) {
    logger.warn("JQL contains potentially unsafe characters, escaping", {
      original: jql.slice(0, 100),
    });
    // Escape potentially dangerous characters
    sanitized = sanitized.replace(/[^\w\s\-_.,"'=<>!~()]/g, "");
  }

  return sanitized;
}

/**
 * Validate and sanitize a project key
 */
function sanitizeProjectKey(key: string): string {
  // Project keys are uppercase alphanumeric with underscores
  return key.replace(/[^A-Z0-9_]/gi, "").toUpperCase().slice(0, 20);
}

/**
 * Build JQL query from options
 */
export function buildJQL(options: ImportOptions, config: JiraConfig): string {
  const conditions: string[] = [];

  // Custom JQL takes precedence - but sanitize it first
  if (options.jql) {
    return sanitizeJQL(options.jql);
  }

  // Project filter (sanitize keys)
  if (options.projectKeys?.length) {
    const sanitizedKeys = options.projectKeys.map(sanitizeProjectKey).filter(k => k.length > 0);
    if (sanitizedKeys.length > 0) {
      conditions.push(`project IN (${sanitizedKeys.join(", ")})`);
    }
  } else if (config.projectKey) {
    const sanitizedKey = sanitizeProjectKey(config.projectKey);
    if (sanitizedKey) {
      conditions.push(`project = ${sanitizedKey}`);
    }
  }

  // Date filter
  if (options.updatedAfter) {
    conditions.push(`updated >= "${options.updatedAfter}"`);
  }

  // Crash-relevant filters
  conditions.push(
    `(issuetype IN (Bug, Defect, Incident, Problem) OR labels IN (crash, error, bug, defect))`
  );

  // Order by updated date descending
  const jql = conditions.join(" AND ") + " ORDER BY updated DESC";

  return jql;
}

/**
 * Fetch issues from JIRA using JQL
 */
export async function fetchJiraIssues(options: ImportOptions = {}): Promise<ImportResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const issues: NormalizedIssue[] = [];

  try {
    const config = await getJiraConfig();
    const apiToken = await getApiKey("jira");

    if (!config.enabled || !config.baseUrl || !config.email || !apiToken) {
      return {
        success: false,
        totalFetched: 0,
        totalImported: 0,
        issues: [],
        errors: ["JIRA configuration is incomplete"],
        duration: Date.now() - startTime,
      };
    }

    const jql = buildJQL(options, config);
    const maxResults = options.maxResults || JIRA_CONFIG.defaultPageSize;
    const includeComments = options.includeComments !== false;

    logger.info("Fetching JIRA issues", { jql, maxResults, nextPageToken: options.nextPageToken });

    // Check API health before making request
    const apiHealth = getJiraApiHealth();
    if (!apiHealth.available) {
      return {
        success: false,
        totalFetched: 0,
        totalImported: 0,
        issues: [],
        errors: [`JIRA API is temporarily unavailable (circuit breaker: ${apiHealth.circuitState})`],
        duration: Date.now() - startTime,
      };
    }

    // Call Rust backend — use cursor command when fetching subsequent pages
    const response = await executeWithResilience(() =>
      options.nextPageToken
        ? invoke<JiraSearchResponse>("search_jira_issues_next_page", {
            baseUrl: config.baseUrl,
            email: config.email,
            apiToken,
            jql,
            maxResults,
            includeComments,
            nextPageToken: options.nextPageToken,
          })
        : invoke<JiraSearchResponse>("search_jira_issues", {
            baseUrl: config.baseUrl,
            email: config.email,
            apiToken,
            jql,
            maxResults,
            includeComments,
          })
    );

    // Normalize issues
    for (const jiraIssue of response.issues) {
      try {
        const normalized = normalizeJiraIssue(jiraIssue, config.baseUrl);

        // Filter by relevance score if specified
        if (options.minRelevanceScore && normalized.crashRelevanceScore < options.minRelevanceScore) {
          continue;
        }

        issues.push(normalized);
      } catch (e) {
        errors.push(`Failed to normalize ${jiraIssue.key}: ${e}`);
      }
    }

    logger.info("JIRA import complete", {
      totalFetched: response.issues.length,
      totalImported: issues.length,
      hasNextPage: !!response.nextPageToken,
    });

    return {
      success: true,
      totalFetched: response.issues.length,
      totalImported: issues.length,
      issues,
      errors,
      duration: Date.now() - startTime,
      nextPageToken: response.nextPageToken,
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.error("JIRA import failed", { error: errorMsg });

    return {
      success: false,
      totalFetched: 0,
      totalImported: 0,
      issues: [],
      errors: [errorMsg],
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Case File Generator for RAG
// ============================================================================

export interface JiraCaseFile {
  /** Unique case ID */
  caseId: string;
  /** Source issue key */
  issueKey: string;
  /** Title for the case */
  title: string;
  /** Full case content for embedding */
  content: string;
  /** Metadata for filtering */
  metadata: {
    platform: string;
    issueType: string;
    status: string;
    priority: string;
    components: string[];
    labels: string[];
    createdAt: string;
    updatedAt: string;
    resolvedAt?: string;
    resolution?: string;
    crashRelevanceScore: number;
    extractedSignatures: string[];
    url: string;
  };
}

/**
 * Generate a case file from a normalized issue for RAG indexing
 */
export function generateCaseFile(issue: NormalizedIssue): JiraCaseFile {
  // Build comprehensive content for embedding
  const sections: string[] = [];

  // Title section
  sections.push(`# ${issue.key}: ${issue.summary}`);
  sections.push("");

  // Metadata section
  sections.push(`## Issue Details`);
  sections.push(`- Type: ${issue.issueType}`);
  sections.push(`- Status: ${issue.status}`);
  sections.push(`- Priority: ${issue.priority}`);
  if (issue.components.length > 0) {
    sections.push(`- Components: ${issue.components.join(", ")}`);
  }
  if (issue.labels.length > 0) {
    sections.push(`- Labels: ${issue.labels.join(", ")}`);
  }
  if (issue.resolution) {
    sections.push(`- Resolution: ${issue.resolution}`);
  }
  sections.push("");

  // Description section
  if (issue.descriptionPlaintext) {
    sections.push(`## Description`);
    sections.push(issue.descriptionPlaintext);
    sections.push("");
  }

  // Extracted signatures section
  if (issue.extractedSignatures.length > 0) {
    sections.push(`## Error Signatures`);
    for (const sig of issue.extractedSignatures) {
      sections.push(`- ${sig}`);
    }
    sections.push("");
  }

  // Comments section (summarized for embedding)
  if (issue.comments.length > 0) {
    sections.push(`## Discussion (${issue.comments.length} comments)`);
    // Include first 5 comments fully, summarize rest
    const displayComments = issue.comments.slice(0, 5);
    for (const comment of displayComments) {
      sections.push(`### ${comment.author} (${new Date(comment.createdAt).toLocaleDateString()})`);
      sections.push(comment.body);
      sections.push("");
    }
    if (issue.comments.length > 5) {
      sections.push(`... and ${issue.comments.length - 5} more comments`);
    }
    sections.push("");
  }

  // Linked issues section
  if (issue.linkedIssues.length > 0) {
    sections.push(`## Related Issues`);
    for (const linked of issue.linkedIssues) {
      sections.push(`- ${linked.type}: ${linked.key}${linked.summary ? ` - ${linked.summary}` : ""}`);
    }
    sections.push("");
  }

  return {
    caseId: issue.id,
    issueKey: issue.key,
    title: `${issue.key}: ${issue.summary}`,
    content: sections.join("\n"),
    metadata: {
      platform: issue.platform,
      issueType: issue.issueType,
      status: issue.status,
      priority: issue.priority,
      components: issue.components,
      labels: issue.labels,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      resolvedAt: issue.resolvedAt,
      resolution: issue.resolution,
      crashRelevanceScore: issue.crashRelevanceScore,
      extractedSignatures: issue.extractedSignatures,
      url: issue.url,
    },
  };
}

/**
 * Generate case files for multiple issues
 */
export function generateCaseFiles(issues: NormalizedIssue[]): JiraCaseFile[] {
  return issues.map(generateCaseFile);
}

// ============================================================================
// Storage & Sync (Using IndexedDB Adapter)
// ============================================================================

// Re-export SyncState from storage module
export type { SyncState } from "./jira-storage";

// Storage adapter instance (lazy initialized)
let storageAdapter: IssueStorageAdapter | null = null;

/**
 * Get the storage adapter (initializes on first call)
 */
async function getStorage(): Promise<IssueStorageAdapter> {
  if (!storageAdapter) {
    storageAdapter = await getStorageAdapter();
  }
  return storageAdapter;
}

/**
 * Get sync state (async)
 */
export async function getSyncStateAsync(): Promise<SyncState | null> {
  const storage = await getStorage();
  return storage.getSyncState();
}

/**
 * Save sync state (async)
 */
export async function saveSyncStateAsync(state: SyncState): Promise<void> {
  const storage = await getStorage();
  await storage.saveSyncState(state);
}

/**
 * Get cached imported issues (async)
 */
export async function getCachedIssuesAsync(): Promise<NormalizedIssue[]> {
  const storage = await getStorage();
  return storage.getIssues();
}

/**
 * Cache imported issues (async)
 */
export async function cacheIssuesAsync(issues: NormalizedIssue[]): Promise<void> {
  const storage = await getStorage();
  await storage.saveIssues(issues);
}

/**
 * Atomic save: issues and sync state together (TDR-003)
 */
export async function saveWithSyncStateAsync(
  issues: NormalizedIssue[],
  state: SyncState
): Promise<void> {
  const storage = await getStorage();
  await storage.saveWithSyncState(issues, state);
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  issueCount: number;
  estimatedSizeBytes: number;
}> {
  const storage = await getStorage();
  return storage.getStats();
}

// Legacy synchronous wrappers (for backward compatibility)
// These use cached data when available, otherwise return empty/null

let cachedIssuesSync: NormalizedIssue[] | null = null;
let cachedSyncStateSync: SyncState | null = null;

/**
 * @deprecated Use getCachedIssuesAsync instead
 */
export function getCachedIssues(): NormalizedIssue[] {
  // Trigger async load in background
  getCachedIssuesAsync().then(issues => {
    cachedIssuesSync = issues;
  }).catch(e => {
    logger.warn("Failed to load cached issues", { error: String(e) });
  });

  return cachedIssuesSync || [];
}

/**
 * @deprecated Use cacheIssuesAsync instead
 */
export function cacheIssues(issues: NormalizedIssue[]): void {
  cachedIssuesSync = issues;
  cacheIssuesAsync(issues).catch(e => {
    logger.error("Failed to cache issues", { error: e });
  });
}

/**
 * @deprecated Use getSyncStateAsync instead
 */
export function getSyncState(): SyncState | null {
  // Trigger async load in background
  getSyncStateAsync().then(state => {
    cachedSyncStateSync = state;
  }).catch(e => {
    logger.warn("Failed to load sync state", { error: String(e) });
  });

  return cachedSyncStateSync;
}

/**
 * @deprecated Use saveSyncStateAsync instead
 */
export function saveSyncState(state: SyncState): void {
  cachedSyncStateSync = state;
  saveSyncStateAsync(state).catch(e => {
    logger.error("Failed to save sync state", { error: e });
  });
}

/**
 * Parse a JIRA URL or key to extract the issue key
 * Supports formats:
 * - PROJ-123
 * - https://company.atlassian.net/browse/PROJ-123
 * - https://company.atlassian.net/jira/software/projects/PROJ/boards/1?selectedIssue=PROJ-123
 */
export function parseJiraKeyOrUrl(input: string): string | null {
  if (!input) return null;

  const trimmed = input.trim();

  // Direct key format: PROJ-123
  const keyMatch = trimmed.match(/^([A-Z][A-Z0-9_]+-\d+)$/i);
  if (keyMatch) {
    return keyMatch[1].toUpperCase();
  }

  // URL format: /browse/PROJ-123
  const browseMatch = trimmed.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
  if (browseMatch) {
    return browseMatch[1].toUpperCase();
  }

  // URL format: selectedIssue=PROJ-123
  const selectedMatch = trimmed.match(/selectedIssue=([A-Z][A-Z0-9_]+-\d+)/i);
  if (selectedMatch) {
    return selectedMatch[1].toUpperCase();
  }

  // Try to find any issue key pattern in the string
  const anyKeyMatch = trimmed.match(/([A-Z][A-Z0-9_]+-\d+)/i);
  if (anyKeyMatch) {
    return anyKeyMatch[1].toUpperCase();
  }

  return null;
}

/**
 * Fetch a single JIRA issue by key
 * Uses rate limiter and circuit breaker for resilience
 */
export async function fetchSingleIssue(issueKey: string): Promise<{
  success: boolean;
  issue?: NormalizedIssue;
  error?: string;
}> {
  try {
    const config = await getJiraConfig();
    const apiToken = await getApiKey("jira");

    if (!config.enabled || !config.baseUrl || !config.email || !apiToken) {
      return { success: false, error: "JIRA configuration is incomplete" };
    }

    // Check API health
    const apiHealth = getJiraApiHealth();
    if (!apiHealth.available) {
      return {
        success: false,
        error: `JIRA API is temporarily unavailable (circuit breaker: ${apiHealth.circuitState})`,
      };
    }

    // Sanitize and validate issue key
    const sanitizedKey = issueKey.replace(/[^A-Z0-9_-]/gi, "").toUpperCase();
    if (!sanitizedKey || !/^[A-Z][A-Z0-9_]+-\d+$/.test(sanitizedKey)) {
      return { success: false, error: "Invalid issue key format" };
    }

    // Use JQL to fetch the specific issue
    const jql = `key = ${sanitizedKey}`;

    logger.info("Fetching single JIRA issue", { issueKey: sanitizedKey });

    // Use rate limiter with retry
    const response = await executeWithResilience(() =>
      invoke<JiraSearchResponse>("search_jira_issues", {
        baseUrl: config.baseUrl,
        email: config.email,
        apiToken,
        jql,
        maxResults: 1,
        includeComments: true,
      })
    );

    if (response.issues.length === 0) {
      return { success: false, error: `Issue ${sanitizedKey} not found` };
    }

    const normalized = normalizeJiraIssue(response.issues[0], config.baseUrl);

    logger.info("Single issue fetched", { issueKey: sanitizedKey, relevance: normalized.crashRelevanceScore });

    return { success: true, issue: normalized };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logger.error("Failed to fetch single issue", { issueKey, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Import a single issue by URL or key and add to cache
 * Uses async storage with atomic transactions
 */
export async function importSingleIssue(urlOrKey: string): Promise<{
  success: boolean;
  issue?: NormalizedIssue;
  error?: string;
  alreadyExists?: boolean;
}> {
  // Parse the input
  const issueKey = parseJiraKeyOrUrl(urlOrKey);

  if (!issueKey) {
    return {
      success: false,
      error: "Invalid JIRA URL or key. Expected format: PROJ-123 or https://company.atlassian.net/browse/PROJ-123",
    };
  }

  // Check if already in cache (using async)
  const cached = await getCachedIssuesAsync();
  const existing = cached.find(i => i.key === issueKey);

  if (existing) {
    // Re-fetch to get latest version
    const result = await fetchSingleIssue(issueKey);

    if (result.success && result.issue) {
      // Update in cache atomically
      const updatedCache = cached.map(i => (i.key === issueKey ? result.issue! : i));
      await cacheIssuesAsync(updatedCache);

      // Update sync cache
      cachedIssuesSync = updatedCache;

      return { success: true, issue: result.issue, alreadyExists: true };
    }

    return result;
  }

  // Fetch the issue
  const result = await fetchSingleIssue(issueKey);

  if (result.success && result.issue) {
    // Add to cache atomically with sync state
    const updatedCache = [result.issue, ...cached];
    const syncState = await getSyncStateAsync();

    const newSyncState: SyncState = {
      lastSyncAt: syncState?.lastSyncAt || new Date().toISOString(),
      lastSyncedKey: result.issue.key,
      totalImported: updatedCache.length,
      version: (syncState?.version || 0) + 1,
    };

    await saveWithSyncStateAsync(updatedCache, newSyncState);

    // Update sync cache
    cachedIssuesSync = updatedCache;
    cachedSyncStateSync = newSyncState;
  }

  return result;
}

/**
 * Perform incremental sync (only fetch new/updated issues)
 * Uses atomic transactions to prevent data corruption (TDR-003)
 */
export async function syncJiraIssues(): Promise<ImportResult> {
  const syncState = await getSyncStateAsync();
  const options: ImportOptions = {
    maxResults: JIRA_CONFIG.defaultPageSize,
    includeComments: true,
  };

  // If we have previous sync, only fetch updates
  if (syncState?.lastSyncAt) {
    options.updatedAfter = syncState.lastSyncAt;
  }

  const result = await fetchJiraIssues(options);

  if (result.success) {
    // Merge with existing cached issues
    const existing = await getCachedIssuesAsync();
    const existingMap = new Map(existing.map(i => [i.id, i]));

    // Update/add new issues
    for (const issue of result.issues) {
      existingMap.set(issue.id, issue);
    }

    // Convert back to array and sort
    const merged = Array.from(existingMap.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Atomic save: issues and sync state together (TDR-003)
    const newSyncState: SyncState = {
      lastSyncAt: new Date().toISOString(),
      lastSyncedKey: result.issues[0]?.key,
      totalImported: merged.length,
      version: (syncState?.version || 0) + 1,
    };

    await saveWithSyncStateAsync(merged, newSyncState);

    // Update local cache for sync wrappers
    cachedIssuesSync = merged;
    cachedSyncStateSync = newSyncState;
  }

  return result;
}

// ============================================================================
// Export Service Object
// ============================================================================

export const JiraImportService = {
  // Core functions
  fetchIssues: fetchJiraIssues,
  syncIssues: syncJiraIssues,
  buildJQL,
  sanitizeJQL,

  // Manual import
  parseJiraKeyOrUrl,
  fetchSingleIssue,
  importSingleIssue,

  // Normalization
  normalizeJiraIssue,
  adfToPlaintext,
  extractErrorSignatures,
  calculateCrashRelevanceScore,

  // Case file generation
  generateCaseFile,
  generateCaseFiles,

  // Cache management (async - preferred)
  getCachedIssuesAsync,
  cacheIssuesAsync,
  getSyncStateAsync,
  saveSyncStateAsync,
  saveWithSyncStateAsync,
  getStorageStats,

  // Cache management (legacy sync - deprecated)
  getCachedIssues,
  cacheIssues,
  getSyncState,
  saveSyncState,

  // Health monitoring
  getJiraApiHealth,
};

// Re-export config and health utilities
export { JIRA_CONFIG } from "./jira-storage";
export {
  getJiraApiHealth,
  getRateLimiterState,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  isJiraApiAvailable,
} from "./jira-rate-limiter";

export default JiraImportService;
