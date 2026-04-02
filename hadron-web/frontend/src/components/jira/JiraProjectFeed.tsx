/**
 * JiraProjectFeed
 * Self-contained view for browsing JIRA project issues with batch triage support.
 * Reads JIRA credentials from localStorage (same keys as desktop).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../services/api";
import type {
  JiraIssue,
  JiraCredentials,
  TicketBriefRow,
  JiraTriageResult,
} from "../../services/api";
import { useToast } from "../Toast";

// ============================================================================
// Constants
// ============================================================================

const LS_JIRA_URL = "hadron_jira_url";
const LS_JIRA_EMAIL = "hadron_jira_email";
const LS_JIRA_TOKEN = "hadron_jira_token";

const SEVERITY_BADGE: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-400 border-red-500/30",
  High: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Low: "bg-green-500/20 text-green-400 border-green-500/30",
};

const SEVERITY_DOT: Record<string, string> = {
  Critical: "text-red-400",
  High: "text-orange-400",
  Medium: "text-yellow-400",
  Low: "text-green-400",
};

// ============================================================================
// Helpers
// ============================================================================

function getCredsFromStorage(): JiraCredentials | null {
  const baseUrl = localStorage.getItem(LS_JIRA_URL) || "";
  const email = localStorage.getItem(LS_JIRA_EMAIL) || "";
  const apiToken = localStorage.getItem(LS_JIRA_TOKEN) || "";
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl, email, apiToken };
}

function parseTags(tagsStr: string | null): string[] {
  if (!tagsStr) return [];
  try {
    const parsed = JSON.parse(tagsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return tagsStr.split(",").map((t) => t.trim()).filter(Boolean);
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function SeverityBadge({ severity }: { severity: string }) {
  const cls = SEVERITY_BADGE[severity] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
  const dotCls = SEVERITY_DOT[severity] ?? "text-slate-400";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-semibold ${cls}`}>
      <span className={`text-base leading-none ${dotCls}`}>●</span>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300 border border-slate-600">
      {status}
    </span>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function JiraProjectFeed() {
  const toast = useToast();

  // JIRA credentials from localStorage
  const [creds] = useState<JiraCredentials | null>(getCredsFromStorage);

  // Project key input
  const [projectKey, setProjectKey] = useState("");

  // Issues list
  const [issues, setIssues] = useState<JiraIssue[]>([]);

  // Brief/triage cache
  const [briefsMap, setBriefsMap] = useState<Map<string, TicketBriefRow>>(new Map());

  // Loading state
  const [loading, setLoading] = useState(false);

  // Search
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filters
  const [triagedOnly, setTriagedOnly] = useState(false);
  const [severityFilter, setSeverityFilter] = useState("all");

  // Expanded rows
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Subscriptions
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [newSubKey, setNewSubKey] = useState("");

  // Triage progress
  const [triageProgress, setTriageProgress] = useState<{
    current: number;
    total: number;
    currentKey: string;
  } | null>(null);
  const triageCancelledRef = useRef(false);

  // ============================================================
  // Load subscriptions on mount
  // ============================================================

  useEffect(() => {
    api.getUserSubscriptions().then(setSubscriptions).catch(() => {});
  }, []);

  // ============================================================
  // Search debounce
  // ============================================================

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  // ============================================================
  // Load issues
  // ============================================================

  const handleLoadIssues = useCallback(async () => {
    const key = projectKey.trim().toUpperCase();
    if (!key) {
      toast.error("Enter a project key first");
      return;
    }
    if (!creds) {
      toast.error("JIRA credentials not configured — go to Settings");
      return;
    }

    setLoading(true);
    setIssues([]);
    setBriefsMap(new Map());
    setExpandedKeys(new Set());

    try {
      const result = await api.searchJira(
        { ...creds, projectKey: key },
        { jql: `project = ${key} ORDER BY updated DESC`, maxResults: 50 },
      );
      setIssues(result.issues);

      // Enrich with briefs batch
      if (result.issues.length > 0) {
        const keys = result.issues.map((i) => i.key);
        try {
          const briefs = await api.getTicketBriefsBatch(keys);
          const map = new Map<string, TicketBriefRow>();
          for (const b of briefs) map.set(b.jiraKey, b);
          setBriefsMap(map);
        } catch {
          // Non-critical — badges just won't show
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [projectKey, creds, toast]);

  // ============================================================
  // Toggle row expansion
  // ============================================================

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ============================================================
  // Filtered issues
  // ============================================================

  const filteredBySubscription =
    subscriptions.length > 0
      ? issues.filter((i) =>
          subscriptions.some((sub) => i.key.startsWith(sub + "-")),
        )
      : issues;

  const filteredIssues = filteredBySubscription.filter((issue) => {
    // Search filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      if (
        !issue.key.toLowerCase().includes(q) &&
        !issue.summary.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    // Triaged only
    if (triagedOnly && !briefsMap.has(issue.key)) return false;
    // Severity filter
    if (severityFilter !== "all") {
      const brief = briefsMap.get(issue.key);
      if (!brief || brief.severity?.toLowerCase() !== severityFilter.toLowerCase()) return false;
    }
    return true;
  });

  // ============================================================
  // Triage All
  // ============================================================

  async function handleTriageAll() {
    if (!creds) {
      toast.error("JIRA credentials not configured");
      return;
    }
    if (filteredIssues.length === 0) {
      toast.info("No issues to triage");
      return;
    }

    const confirmed = window.confirm(
      `Triage ${filteredIssues.length} issue(s)? This will call AI for each ticket.`,
    );
    if (!confirmed) return;

    triageCancelledRef.current = false;
    setTriageProgress({ current: 0, total: filteredIssues.length, currentKey: "" });

    for (let i = 0; i < filteredIssues.length; i++) {
      if (triageCancelledRef.current) {
        toast.info("Triage cancelled");
        break;
      }

      const issue = filteredIssues[i];
      setTriageProgress({ current: i + 1, total: filteredIssues.length, currentKey: issue.key });

      try {
        const result: JiraTriageResult = await api.triageJiraIssue(issue.key, creds);

        // Update briefsMap with the new triage result
        setBriefsMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(issue.key);
          const updated: TicketBriefRow = existing
            ? {
                ...existing,
                severity: result.severity,
                category: result.category,
                tags: JSON.stringify(result.tags),
                triageJson: JSON.stringify(result),
              }
            : {
                jiraKey: issue.key,
                title: issue.summary,
                severity: result.severity,
                category: result.category,
                tags: JSON.stringify(result.tags),
                triageJson: JSON.stringify(result),
                briefJson: null,
                postedToJira: false,
                postedAt: null,
                engineerRating: null,
                engineerNotes: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
          next.set(issue.key, updated);
          return next;
        });
      } catch (err) {
        // Log but continue with next ticket
        console.warn(`Triage failed for ${issue.key}:`, err);
      }
    }

    setTriageProgress(null);
    if (!triageCancelledRef.current) {
      toast.success("Triage complete");
    }
  }

  function handleCancelTriage() {
    triageCancelledRef.current = true;
  }

  // ============================================================
  // Render
  // ============================================================

  const hasCreds = !!creds;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="text-lg font-bold text-white mb-4">JIRA Project Feed</h2>

        {!hasCreds && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            JIRA credentials not configured. Go to Settings and enter your JIRA URL, email, and API token.
          </div>
        )}

        {/* Project key input */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Project Key
            </label>
            <input
              type="text"
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleLoadIssues()}
              placeholder="e.g. PROJ"
              disabled={!hasCreds}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleLoadIssues}
              disabled={!hasCreds || loading || !projectKey.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load Issues"
              )}
            </button>
          </div>
        </div>

        {/* Subscription management */}
        <div className="mt-4 space-y-2">
          <span className="text-xs font-medium text-slate-400">Your Subscriptions</span>
          <div className="flex flex-wrap items-center gap-2">
            {subscriptions.map((sub) => (
              <span
                key={sub}
                className="inline-flex items-center gap-1 bg-indigo-500/20 text-indigo-400 rounded-md px-2 py-0.5 text-xs"
              >
                {sub}
                <button
                  onClick={() => {
                    const updated = subscriptions.filter((k) => k !== sub);
                    api.setUserSubscriptions(updated).catch(() => {});
                    setSubscriptions(updated);
                  }}
                  className="ml-0.5 hover:text-indigo-200 transition-colors"
                  aria-label={`Remove ${sub}`}
                >
                  ×
                </button>
              </span>
            ))}
            {subscriptions.length === 0 && (
              <span className="text-xs text-slate-600">No subscriptions — all projects shown</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newSubKey}
              onChange={(e) => setNewSubKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const key = newSubKey.trim().toUpperCase();
                  if (key && !subscriptions.includes(key)) {
                    const updated = [...subscriptions, key];
                    api.setUserSubscriptions(updated).catch(() => {});
                    setSubscriptions(updated);
                  }
                  setNewSubKey("");
                }
              }}
              placeholder="PROJECT KEY"
              className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 font-mono text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none w-32"
            />
            <button
              onClick={() => {
                const key = newSubKey.trim().toUpperCase();
                if (key && !subscriptions.includes(key)) {
                  const updated = [...subscriptions, key];
                  api.setUserSubscriptions(updated).catch(() => {});
                  setSubscriptions(updated);
                }
                setNewSubKey("");
              }}
              disabled={!newSubKey.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Controls bar */}
      {issues.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-3">
          {/* Search + Triage All */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by key or summary..."
                className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {triageProgress ? (
              <button
                onClick={handleCancelTriage}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={handleTriageAll}
                disabled={!hasCreds || filteredIssues.length === 0}
                className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ZapIcon className="h-4 w-4" />
                Triage All
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={triagedOnly}
                onChange={(e) => setTriagedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-300">Triaged only</span>
            </label>

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">Severity:</label>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            <span className="ml-auto text-xs text-slate-500">
              {filteredIssues.length} of {issues.length} issues
            </span>
          </div>

          {/* Progress bar */}
          {triageProgress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Triaging {triageProgress.currentKey}...</span>
                <span>
                  {triageProgress.current}/{triageProgress.total}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300"
                  style={{
                    width: `${(triageProgress.current / triageProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Issues list */}
      {filteredIssues.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="divide-y divide-slate-700/60">
            {filteredIssues.map((issue, idx) => {
              const brief = briefsMap.get(issue.key);
              const isExpanded = expandedKeys.has(issue.key);
              const triageResult: JiraTriageResult | null = brief?.triageJson
                ? (() => {
                    try {
                      return JSON.parse(brief.triageJson);
                    } catch {
                      return null;
                    }
                  })()
                : null;

              return (
                <div
                  key={issue.key}
                  className={idx % 2 === 0 ? "bg-slate-800/50" : "bg-slate-800/30"}
                >
                  {/* Collapsed row */}
                  <button
                    onClick={() => toggleExpanded(issue.key)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/30 transition-colors"
                  >
                    {/* Chevron */}
                    <ChevronIcon
                      className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />

                    {/* Key */}
                    <span className="font-mono text-sm font-medium text-blue-400 w-24 flex-shrink-0">
                      {issue.key}
                    </span>

                    {/* Status */}
                    <div className="flex-shrink-0">
                      <StatusBadge status={issue.status} />
                    </div>

                    {/* Severity (if triaged) */}
                    {brief?.severity && (
                      <div className="flex-shrink-0">
                        <SeverityBadge severity={brief.severity} />
                      </div>
                    )}

                    {/* Summary */}
                    <span className="flex-1 truncate text-sm text-slate-200">
                      {issue.summary}
                    </span>

                    {/* Priority */}
                    {issue.priority && (
                      <span className="flex-shrink-0 text-xs text-slate-500">
                        {issue.priority}
                      </span>
                    )}
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/60 bg-slate-900/50 px-4 pb-4 pt-3 space-y-3">
                      {/* Metadata row */}
                      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                        <span>
                          <span className="text-slate-500">Type:</span>{" "}
                          <span className="text-slate-300">{issue.issueType}</span>
                        </span>
                        {issue.priority && (
                          <span>
                            <span className="text-slate-500">Priority:</span>{" "}
                            <span className="text-slate-300">{issue.priority}</span>
                          </span>
                        )}
                        {issue.assignee && (
                          <span>
                            <span className="text-slate-500">Assignee:</span>{" "}
                            <span className="text-slate-300">{issue.assignee}</span>
                          </span>
                        )}
                        <span>
                          <span className="text-slate-500">Updated:</span>{" "}
                          <span className="text-slate-300">
                            {new Date(issue.updated).toLocaleDateString()}
                          </span>
                        </span>
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Open in JIRA ↗
                        </a>
                      </div>

                      {/* Triage badges if brief exists */}
                      {triageResult && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs text-amber-400 font-semibold uppercase tracking-wide">
                              Triage
                            </span>
                            <SeverityBadge severity={triageResult.severity} />
                            <span
                              className={`text-xs px-2 py-0.5 rounded border ${
                                "bg-slate-500/20 text-slate-300 border-slate-500/30"
                              }`}
                            >
                              {triageResult.category}
                            </span>
                            {parseTags(brief?.tags ?? null).map((tag) => (
                              <span
                                key={tag}
                                className="bg-slate-700 text-slate-300 text-xs rounded px-1.5 py-0.5"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          {triageResult.customer_impact && (
                            <p className="text-xs text-slate-400 italic">
                              {triageResult.customer_impact}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && issues.length === 0 && projectKey && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">
          No issues found. Enter a project key and click "Load Issues".
        </div>
      )}

      {!loading && issues.length === 0 && !projectKey && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">
          Enter a JIRA project key above to browse issues.
        </div>
      )}

      {/* Filtered empty state */}
      {!loading && issues.length > 0 && filteredIssues.length === 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-center text-slate-500">
          No issues match your current filters.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Inline SVG icons (no lucide-react dependency)
// ============================================================================

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default JiraProjectFeed;
