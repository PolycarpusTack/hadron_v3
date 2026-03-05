/**
 * JIRA Project Feed
 * Tab 2: Configure up to 5 JIRA projects with status filters, browse matching tickets.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  Plus,
  X,
  RefreshCw,
  Search,
  AlertCircle,
  Loader2,
  Zap,
  ExternalLink,
  Tag,
  Clock,
  Settings2,
  FolderOpen,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  getCachedJiraProjects,
  listJiraProjects,
  type JiraProjectInfo,
} from "../../services/jira";
import JiraImportService, { fetchJiraIssues, type NormalizedIssue } from "../../services/jira-import";
import { analyzeJiraTicket, getAnalysisById, getStoredApiKey, getStoredModel, getStoredProvider } from "../../services/api";
import type { Analysis } from "../../services/api";
import { isKBEnabled, getOpenSearchConfig } from "../../services/opensearch";
import { isRagAvailable } from "../../services/rag";
import {
  getWatchedProjects,
  saveWatchedProjects,
  type WatchedProject,
  getStatusColor,
  getPriorityColor,
  formatRelativeTime,
} from "./jiraHelpers";
import {
  getTicketBriefsBatch,
  triageJiraTicket,
  type TicketBrief,
  SEVERITY_BADGE,
  CATEGORY_COLORS,
  parseTags,
} from "../../services/jira-assist";
import { useDebounce } from "../../hooks/useDebounce";

interface JiraProjectFeedProps {
  onAnalysisComplete: (analysis: Analysis) => void;
}

const DEFAULT_STATUSES = ["Open", "In Progress", "To Do", "Reopened", "Backlog"];
const MAX_PROJECTS = 5;

/** Strip non-alphanumeric (except underscore) and uppercase — mirrors backend sanitizeProjectKey */
function sanitizeProjectKey(key: string): string {
  return key.replace(/[^A-Z0-9_]/gi, "").toUpperCase().slice(0, 20);
}

const FEED_PAGE_SIZE = 50;

export default function JiraProjectFeed({ onAnalysisComplete }: JiraProjectFeedProps) {
  // Config state
  const [watched, setWatched] = useState<WatchedProject[]>(getWatchedProjects());
  const [showConfig, setShowConfig] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<JiraProjectInfo[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [addProjectKey, setAddProjectKey] = useState("");
  const [addProjectKeyError, setAddProjectKeyError] = useState<string | null>(null);
  const [newStatuses, setNewStatuses] = useState<string[]>([...DEFAULT_STATUSES]);
  const [statusInput, setStatusInput] = useState("");

  // Feed state
  const [issues, setIssues] = useState<NormalizedIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  // Fix #1: use a Set so multiple rows can be analyzed concurrently without stomping each other
  const [analyzingKeys, setAnalyzingKeys] = useState<Set<string>>(new Set());
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  // JIRA Assist: triage data for badges
  const [briefsMap, setBriefsMap] = useState<Map<string, TicketBrief>>(new Map());
  // Batch triage state
  const [triageProgress, setTriageProgress] = useState<{ current: number; total: number; key: string } | null>(null);
  const triageCancelledRef = useRef(false);
  const [showTriageConfirm, setShowTriageConfirm] = useState(false);
  // Feed filters
  const [filterTriagedOnly, setFilterTriagedOnly] = useState(false);
  const [filterSeverity, setFilterSeverity] = useState("All");
  // Fix #7: last-refreshed timestamp
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  // Current JQL — stored in a ref so loadIssues can read it without being a dep
  const currentJqlRef = useRef<string>("");

  // Fix #3: separate "reload trigger" from config edits.
  // loadIssues only runs when this counter increments — NOT on every status tag change.
  const [reloadTrigger, setReloadTrigger] = useState(0);
  // Keep watched in a ref so loadIssues (which depends only on reloadTrigger) sees the latest value
  const watchedRef = useRef(watched);
  watchedRef.current = watched;

  // Load available projects from cache on mount
  useEffect(() => {
    const cached = getCachedJiraProjects();
    if (cached.projects.length > 0) {
      setAvailableProjects(cached.projects);
    }
  }, []);

  // Auto-show config if no watched projects
  useEffect(() => {
    if (watched.length === 0) setShowConfig(true);
  }, [watched.length]);

  /** Build the feed JQL from the current watched list */
  function buildFeedJql(watchedProjects: WatchedProject[]): string {
    const projectConditions = watchedProjects.map((wp) => {
      const statusList = wp.statuses.map((s) => `"${s}"`).join(", ");
      return `(project = ${wp.key}${statusList ? ` AND status IN (${statusList})` : ""})`;
    });
    return `(${projectConditions.join(" OR ")}) ORDER BY updated DESC`;
  }

  // Fix #3: loadIssues only re-created when reloadTrigger changes, not on status edits
  const loadIssues = useCallback(async () => {
    const currentWatched = watchedRef.current;
    if (currentWatched.length === 0) {
      setIssues([]);
      setNextPageToken(undefined);
      return;
    }

    setLoading(true);
    setError(null);
    setNextPageToken(undefined);

    const jql = buildFeedJql(currentWatched);
    currentJqlRef.current = jql;

    try {
      // Fix #5: load without comments for the browsing view; fetch comments on-demand at analyze time
      let result = await fetchJiraIssues({ jql, maxResults: FEED_PAGE_SIZE, includeComments: false });

      // If the JQL failed (e.g. invalid status names), retry without status filter
      if (!result.success && result.errors.some((e) => e.toLowerCase().includes("invalid jql"))) {
        const fallbackConditions = currentWatched.map((wp) => `project = ${wp.key}`);
        const fallbackJql = `(${fallbackConditions.join(" OR ")}) ORDER BY updated DESC`;
        currentJqlRef.current = fallbackJql;
        result = await fetchJiraIssues({ jql: fallbackJql, maxResults: FEED_PAGE_SIZE, includeComments: false });
      }

      if (result.success) {
        setIssues(result.issues);
        setNextPageToken(result.nextPageToken);
        setLastRefreshed(new Date());
        loadBriefs(result.issues);
      } else {
        setError(result.errors.join(", ") || "Failed to fetch issues");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTrigger]);

  // Load triage briefs for a set of issues (for badge display)
  async function loadBriefs(issueList: NormalizedIssue[]) {
    if (issueList.length === 0) return;
    try {
      const keys = issueList.map((i) => i.key);
      const briefs = await getTicketBriefsBatch(keys);
      setBriefsMap((prev) => {
        const next = new Map(prev);
        for (const b of briefs) next.set(b.jira_key, b);
        return next;
      });
    } catch {
      // Non-critical — badges just won't show
    }
  }

  useEffect(() => {
    if (watchedRef.current.length > 0) loadIssues();
  }, [loadIssues]);

  // Fix #6: load the next page and append to the existing list
  async function handleLoadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchJiraIssues({
        jql: currentJqlRef.current,
        maxResults: FEED_PAGE_SIZE,
        includeComments: false,
        nextPageToken,
      });
      if (result.success) {
        setIssues((prev) => [...prev, ...result.issues]);
        setNextPageToken(result.nextPageToken);
        loadBriefs(result.issues);
      } else {
        setError(result.errors.join(", ") || "Failed to load more issues");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more issues");
    } finally {
      setLoadingMore(false);
    }
  }

  // Refresh available projects from JIRA (Fix #2: listJiraProjects now throws on API errors)
  async function handleRefreshProjects() {
    setProjectsLoading(true);
    setError(null);
    try {
      const fetched = await listJiraProjects();
      setAvailableProjects(fetched);
    } catch (err) {
      setError(`Failed to refresh projects: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProjectsLoading(false);
    }
  }

  // Fix #4: validate and sanitize project key before storing
  function handleAddProject() {
    const sanitized = sanitizeProjectKey(addProjectKey);
    if (!sanitized) {
      setAddProjectKeyError("Project key must contain letters or digits only (e.g. PROJ).");
      return;
    }
    if (watched.length >= MAX_PROJECTS) return;
    if (watched.some((w) => w.key === sanitized)) {
      setAddProjectKeyError(`${sanitized} is already in your watch list.`);
      return;
    }

    setAddProjectKeyError(null);
    const matchedProject = availableProjects.find((p) => p.key === sanitized);
    const project: WatchedProject = {
      key: sanitized,
      name: matchedProject?.name || sanitized,
      statuses: [...newStatuses],
    };

    const updated = [...watched, project];
    setWatched(updated);
    saveWatchedProjects(updated);
    setAddProjectKey("");
    // Trigger a feed reload because a new project was added
    setReloadTrigger((t) => t + 1);
  }

  // Remove a project — triggers feed reload
  function handleRemoveProject(key: string) {
    const updated = watched.filter((w) => w.key !== key);
    setWatched(updated);
    saveWatchedProjects(updated);
    setReloadTrigger((t) => t + 1);
  }

  // Fix #3: status edits save to storage but do NOT trigger a feed reload
  function handleUpdateStatuses(key: string, statuses: string[]) {
    const updated = watched.map((w) => (w.key === key ? { ...w, statuses } : w));
    setWatched(updated);
    saveWatchedProjects(updated);
    // NOTE: intentionally no setReloadTrigger here — user must click Refresh to apply new filters
  }

  // Toggle issue expansion
  function toggleExpanded(issueId: string) {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }

  // Analyze a ticket. Fix #1: track per-key analyzing state (Set). Fix #5: fetch comments on-demand.
  async function handleAnalyze(issue: NormalizedIssue) {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setAnalyzingKeys((prev) => new Set(prev).add(issue.key));
    setError(null);

    try {
      // Fix #5: fetch the full issue (with comments) only when the user asks to analyze
      let issueWithComments = issue;
      if (issue.comments.length === 0) {
        const fetched = await JiraImportService.fetchSingleIssue(issue.key);
        if (fetched.success && fetched.issue) {
          issueWithComments = fetched.issue;
        }
      }

      const commentTexts = issueWithComments.comments.map((c) => c.body);

      let useRag = false;
      try { useRag = await isRagAvailable(); } catch { /* continue without */ }

      let kbOptions: { useKB?: boolean; customer?: string; wonVersion?: string; kbMode?: string } | undefined;
      try {
        const kbEnabled = await isKBEnabled();
        if (kbEnabled) {
          const kbConfig = await getOpenSearchConfig();
          kbOptions = {
            useKB: true,
            customer: kbConfig.defaultCustomer || undefined,
            wonVersion: kbConfig.defaultVersion || undefined,
            kbMode: kbConfig.mode === "both" ? "remote" : kbConfig.mode,
          };
        }
      } catch { /* continue without KB */ }

      const result = await analyzeJiraTicket(
        issueWithComments.key,
        issueWithComments.summary,
        issueWithComments.descriptionPlaintext || "",
        commentTexts,
        issueWithComments.priority || undefined,
        issueWithComments.status || undefined,
        issueWithComments.components,
        issueWithComments.labels,
        apiKey,
        getStoredModel(),
        getStoredProvider(),
        useRag || undefined,
        kbOptions,
      );
      const fullAnalysis = await getAnalysisById(result.id);
      onAnalysisComplete(fullAnalysis);
    } catch (err) {
      setError(`Failed to analyze ${issue.key}: ${err instanceof Error ? err.message : err}`);
    } finally {
      setAnalyzingKeys((prev) => {
        const next = new Set(prev);
        next.delete(issue.key);
        return next;
      });
    }
  }

  // Batch triage — sequential with cancel support
  async function handleBatchTriage(retriageAll: boolean, visibleIssues: NormalizedIssue[]) {
    setShowTriageConfirm(false);
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    const ticketsToTriage = retriageAll
      ? visibleIssues
      : visibleIssues.filter((i) => !briefsMap.has(i.key));

    if (ticketsToTriage.length === 0) return;

    triageCancelledRef.current = false;
    const model = getStoredModel();
    const provider = getStoredProvider();

    for (let i = 0; i < ticketsToTriage.length; i++) {
      if (triageCancelledRef.current) break;
      const issue = ticketsToTriage[i];
      setTriageProgress({ current: i + 1, total: ticketsToTriage.length, key: issue.key });

      try {
        const result = await triageJiraTicket({
          jiraKey: issue.key,
          title: issue.summary,
          description: issue.descriptionPlaintext || "",
          issueType: issue.issueType || "Bug",
          priority: issue.priority || undefined,
          status: issue.status || undefined,
          components: issue.components,
          labels: issue.labels,
          comments: issue.comments.map((c) => c.body),
          apiKey,
          model,
          provider,
        });
        // Update briefsMap incrementally
        setBriefsMap((prev) => {
          const next = new Map(prev);
          const existing = next.get(issue.key);
          next.set(issue.key, {
            jira_key: issue.key,
            title: issue.summary,
            customer: existing?.customer ?? null,
            severity: result.severity,
            category: result.category,
            tags: JSON.stringify(result.tags),
            triage_json: JSON.stringify(result),
            brief_json: existing?.brief_json ?? null,
            posted_to_jira: existing?.posted_to_jira ?? false,
            posted_at: existing?.posted_at ?? null,
            engineer_rating: existing?.engineer_rating ?? null,
            engineer_notes: existing?.engineer_notes ?? null,
            created_at: existing?.created_at ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return next;
        });
      } catch (err) {
        setError(`Triage failed for ${issue.key}: ${err instanceof Error ? err.message : err}`);
        break;
      }
    }
    setTriageProgress(null);
  }

  // Filter issues by search + triage filters
  const filteredIssues = (() => {
    let filtered = issues;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter(
        (issue) =>
          issue.key.toLowerCase().includes(q) ||
          issue.summary.toLowerCase().includes(q) ||
          issue.descriptionPlaintext.toLowerCase().includes(q),
      );
    }
    if (filterTriagedOnly) {
      filtered = filtered.filter((i) => briefsMap.has(i.key));
    }
    if (filterSeverity !== "All") {
      filtered = filtered.filter((i) => briefsMap.get(i.key)?.severity === filterSeverity);
    }
    return filtered;
  })();

  // Counts for confirmation dialog
  const alreadyTriagedCount = filteredIssues.filter((i) => briefsMap.has(i.key)).length;
  const untriagedCount = filteredIssues.length - alreadyTriagedCount;

  return (
    <div className="space-y-4">
      {/* Configuration Section */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-800/70 transition rounded-lg"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-sky-400" />
            <span className="text-sm font-medium">
              Watched Projects ({watched.length}/{MAX_PROJECTS})
            </span>
            {watched.length > 0 && (
              <span className="text-xs text-gray-500">
                {watched.map((w) => w.key).join(", ")}
              </span>
            )}
          </div>
          {showConfig ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {showConfig && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-700 pt-3">
            {/* Current watched projects */}
            {watched.map((wp) => (
              <WatchedProjectRow
                key={wp.key}
                project={wp}
                onRemove={() => handleRemoveProject(wp.key)}
                onUpdateStatuses={(statuses) => handleUpdateStatuses(wp.key, statuses)}
              />
            ))}

            {/* Add project */}
            {watched.length < MAX_PROJECTS && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      list="jira-projects-feed"
                      value={addProjectKey}
                      onChange={(e) => {
                        setAddProjectKey(e.target.value.toUpperCase());
                        setAddProjectKeyError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddProject();
                      }}
                      placeholder="Project key (e.g., CRASH)"
                      className={`w-full bg-gray-900 border rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none uppercase ${addProjectKeyError ? "border-red-500 focus:border-red-400" : "border-gray-600 focus:border-sky-500"}`}
                    />
                    <datalist id="jira-projects-feed">
                      {availableProjects
                        .filter((p) => !watched.some((w) => w.key === p.key))
                        .map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                    </datalist>
                  </div>
                  <button
                    onClick={handleAddProject}
                    disabled={!addProjectKey.trim() || watched.length >= MAX_PROJECTS}
                    className="px-3 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition text-sm flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </button>
                  <button
                    onClick={handleRefreshProjects}
                    disabled={projectsLoading}
                    className="p-2 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
                    title="Refresh project list from JIRA"
                  >
                    <RefreshCw className={`w-4 h-4 text-gray-400 ${projectsLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {addProjectKeyError && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    {addProjectKeyError}
                  </p>
                )}

                {/* Default statuses for new projects */}
                <div className="text-xs text-gray-500">
                  <span>Default statuses for new projects:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {newStatuses.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 rounded text-gray-300"
                      >
                        {s}
                        <button
                          onClick={() => setNewStatuses(newStatuses.filter((ns) => ns !== s))}
                          className="hover:text-red-400"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={statusInput}
                        onChange={(e) => setStatusInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && statusInput.trim()) {
                            if (!newStatuses.includes(statusInput.trim())) {
                              setNewStatuses([...newStatuses, statusInput.trim()]);
                            }
                            setStatusInput("");
                          }
                        }}
                        placeholder="+ status"
                        className="w-20 bg-transparent border-b border-gray-600 px-1 py-0.5 text-xs focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Feed Controls */}
      {watched.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter tickets..."
                className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
            <button
              onClick={() => setReloadTrigger((t) => t + 1)}
              disabled={loading}
              className="p-1.5 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
              title="Refresh feed"
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setShowTriageConfirm(true)}
              disabled={!!triageProgress || filteredIssues.length === 0}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-xs text-white transition whitespace-nowrap"
              title="Triage all visible tickets with AI"
            >
              <Zap className="w-3 h-3" />
              Triage All
            </button>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {filteredIssues.length} ticket{filteredIssues.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterTriagedOnly}
                onChange={(e) => setFilterTriagedOnly(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0 w-3.5 h-3.5"
              />
              Triaged only
            </label>
            <label className="flex items-center gap-1.5 text-gray-400">
              Severity:
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-300 focus:outline-none focus:border-sky-500"
              >
                <option value="All">All</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
            {/* Fix #7: last refreshed timestamp */}
            {lastRefreshed && (
              <span className="text-gray-600 ml-auto">
                Updated {formatRelativeTime(lastRefreshed.toISOString())}
              </span>
            )}
          </div>

          {/* Triage progress bar */}
          {triageProgress && (
            <div className="flex items-center gap-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
              <span className="text-sm text-amber-300 flex-1">
                Triaging {triageProgress.current}/{triageProgress.total} ({triageProgress.key})...
              </span>
              <button
                onClick={() => { triageCancelledRef.current = true; }}
                className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Triage confirmation dialog */}
          {showTriageConfirm && (
            <div className="px-3 py-3 bg-gray-800 border border-gray-600 rounded-lg space-y-2">
              <p className="text-sm text-gray-300">
                {alreadyTriagedCount > 0
                  ? `${alreadyTriagedCount} of ${filteredIssues.length} tickets already triaged.`
                  : `Triage ${filteredIssues.length} visible tickets?`}
              </p>
              <div className="flex gap-2">
                {untriagedCount > 0 && (
                  <button
                    onClick={() => handleBatchTriage(false, filteredIssues)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 rounded text-xs text-white transition"
                  >
                    Triage {untriagedCount} remaining
                  </button>
                )}
                <button
                  onClick={() => handleBatchTriage(true, filteredIssues)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition"
                >
                  Re-triage all {filteredIssues.length}
                </button>
                <button
                  onClick={() => setShowTriageConfirm(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && issues.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
          <span className="ml-2 text-gray-400">Loading tickets...</span>
        </div>
      )}

      {/* Empty — no watched projects */}
      {watched.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-500">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No projects configured</p>
          <p className="text-xs mt-1 text-gray-600">
            Add up to {MAX_PROJECTS} JIRA projects above to start pulling in tickets
          </p>
        </div>
      )}

      {/* Empty — no matching issues */}
      {watched.length > 0 && !loading && filteredIssues.length === 0 && !error && (
        <div className="text-center py-12 text-gray-500">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No matching tickets found</p>
          <p className="text-xs mt-1">
            {debouncedSearch ? "Try a different search term" : "Check your project and status filters"}
          </p>
        </div>
      )}

      {/* Issue List */}
      {filteredIssues.length > 0 && (
        <div className="space-y-1">
          {filteredIssues.map((issue) => (
            <FeedIssueRow
              key={issue.id}
              issue={issue}
              brief={briefsMap.get(issue.key)}
              expanded={expandedIssues.has(issue.id)}
              onToggle={() => toggleExpanded(issue.id)}
              onAnalyze={() => handleAnalyze(issue)}
              analyzing={analyzingKeys.has(issue.key)}
            />
          ))}
        </div>
      )}

      {/* Fix #6: Load More — only shown when backend has more results and no search filter active */}
      {!debouncedSearch && !filterTriagedOnly && filterSeverity === "All" && nextPageToken && (
        <div className="flex justify-center pt-2">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Load more tickets
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Watched Project Row (config panel)
// ============================================================================

interface WatchedProjectRowProps {
  project: WatchedProject;
  onRemove: () => void;
  onUpdateStatuses: (statuses: string[]) => void;
}

function WatchedProjectRow({ project, onRemove, onUpdateStatuses }: WatchedProjectRowProps) {
  const [statusInput, setStatusInput] = useState("");

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sky-400 text-sm font-medium">{project.key}</span>
          <span className="text-xs text-gray-500">{project.name}</span>
        </div>
        <button
          onClick={onRemove}
          className="p-1 hover:bg-red-500/20 rounded transition"
          title="Remove project"
        >
          <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-400" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1 items-center">
        <span className="text-xs text-gray-500 mr-1">Statuses:</span>
        {project.statuses.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
          >
            {s}
            <button
              onClick={() => onUpdateStatuses(project.statuses.filter((st) => st !== s))}
              className="hover:text-red-400"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={statusInput}
          onChange={(e) => setStatusInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && statusInput.trim()) {
              if (!project.statuses.includes(statusInput.trim())) {
                onUpdateStatuses([...project.statuses, statusInput.trim()]);
              }
              setStatusInput("");
            }
          }}
          placeholder="+ add"
          className="w-16 bg-transparent border-b border-gray-600 px-1 py-0.5 text-xs focus:outline-none focus:border-sky-500"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Feed Issue Row
// ============================================================================

interface FeedIssueRowProps {
  issue: NormalizedIssue;
  brief?: TicketBrief;
  expanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

function FeedIssueRow({ issue, brief, expanded, onToggle, onAnalyze, analyzing }: FeedIssueRowProps) {
  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-800/70 transition"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-sky-400 text-sm">{issue.key}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(issue.status)}`}>
            {issue.status}
          </span>
          {brief?.severity && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${SEVERITY_BADGE[brief.severity] ?? "bg-gray-500/20 text-gray-300 border-gray-500/40"}`}>
              {brief.severity}
            </span>
          )}
        </div>

        <span className="flex-1 truncate text-sm">{issue.summary}</span>

        <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-500">
          <span className={getPriorityColor(issue.priority)}>{issue.priority}</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(issue.updatedAt)}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-gray-700 space-y-3">
          {/* Metadata */}
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1 text-gray-400">
              <Tag className="w-3 h-3" />
              {issue.issueType}
            </span>
            {issue.assignee && (
              <span className="text-gray-400">Assignee: {issue.assignee.displayName}</span>
            )}
            {issue.components.length > 0 && (
              <span className="text-gray-400">
                Components: {issue.components.join(", ")}
              </span>
            )}
          </div>

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Triage badges (from JIRA Assist) */}
          {brief?.severity && (
            <div className="flex flex-wrap gap-1.5">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_BADGE[brief.severity] ?? ""}`}>
                {brief.severity}
              </span>
              {brief.category && (
                <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[brief.category] ?? "bg-gray-500/15 text-gray-300 border-gray-500/30"}`}>
                  {brief.category}
                </span>
              )}
              {parseTags(brief.tags).map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gray-700/50 text-gray-400 border border-gray-600/50">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Description excerpt */}
          {issue.descriptionPlaintext && (
            <div className="text-sm text-gray-400 whitespace-pre-wrap line-clamp-4">
              {issue.descriptionPlaintext}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                open(issue.url);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
            >
              <ExternalLink className="w-3 h-3" />
              Open in JIRA
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              disabled={analyzing}
              className="flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-600/50 disabled:cursor-not-allowed rounded text-sm text-white transition"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  Analyze
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
