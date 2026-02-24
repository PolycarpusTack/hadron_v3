/**
 * JIRA Project Feed
 * Tab 2: Configure up to 5 JIRA projects with status filters, browse matching tickets.
 */

import { useState, useEffect, useCallback } from "react";
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
import { fetchJiraIssues, type NormalizedIssue } from "../../services/jira-import";
import { analyzeJiraTicket, getAnalysisById, getStoredApiKey, getStoredModel, getStoredProvider } from "../../services/api";
import type { Analysis } from "../../services/api";
import {
  getWatchedProjects,
  saveWatchedProjects,
  type WatchedProject,
  getStatusColor,
  getPriorityColor,
  formatRelativeTime,
} from "./jiraHelpers";
import { useDebounce } from "../../hooks/useDebounce";

interface JiraProjectFeedProps {
  onAnalysisComplete: (analysis: Analysis) => void;
}

const DEFAULT_STATUSES = ["Open", "In Progress", "To Do", "Reopened", "Backlog"];
const MAX_PROJECTS = 5;

export default function JiraProjectFeed({ onAnalysisComplete }: JiraProjectFeedProps) {
  // Config state
  const [watched, setWatched] = useState<WatchedProject[]>(getWatchedProjects());
  const [showConfig, setShowConfig] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<JiraProjectInfo[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [addProjectKey, setAddProjectKey] = useState("");
  const [newStatuses, setNewStatuses] = useState<string[]>([...DEFAULT_STATUSES]);
  const [statusInput, setStatusInput] = useState("");

  // Feed state
  const [issues, setIssues] = useState<NormalizedIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  // Load available projects on mount
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

  // Fetch issues when watched projects change
  const loadIssues = useCallback(async () => {
    if (watched.length === 0) {
      setIssues([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Build JQL for watched projects with their status filters
      const projectConditions = watched.map((wp) => {
        const statusList = wp.statuses.map((s) => `"${s}"`).join(", ");
        return `(project = ${wp.key}${statusList ? ` AND status IN (${statusList})` : ""})`;
      });

      const jql = `(${projectConditions.join(" OR ")}) ORDER BY updated DESC`;

      let result = await fetchJiraIssues({
        jql,
        maxResults: 50,
        includeComments: true,
      });

      // If the JQL failed (e.g. invalid status names), retry without status filter
      if (!result.success && result.errors.some((e) => e.toLowerCase().includes("invalid jql"))) {
        const fallbackConditions = watched.map((wp) => `project = ${wp.key}`);
        const fallbackJql = `(${fallbackConditions.join(" OR ")}) ORDER BY updated DESC`;
        result = await fetchJiraIssues({
          jql: fallbackJql,
          maxResults: 50,
          includeComments: true,
        });
      }

      if (result.success) {
        setIssues(result.issues);
      } else {
        setError(result.errors.join(", ") || "Failed to fetch issues");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [watched]);

  useEffect(() => {
    if (watched.length > 0) loadIssues();
  }, [loadIssues]);

  // Refresh available projects from JIRA
  async function handleRefreshProjects() {
    setProjectsLoading(true);
    try {
      const fetched = await listJiraProjects();
      setAvailableProjects(fetched);
    } catch {
      // silent — cached projects are shown
    } finally {
      setProjectsLoading(false);
    }
  }

  // Add a project to the watch list
  function handleAddProject() {
    const key = addProjectKey.toUpperCase().trim();
    if (!key) return;
    if (watched.length >= MAX_PROJECTS) return;
    if (watched.some((w) => w.key === key)) return;

    const matchedProject = availableProjects.find((p) => p.key === key);
    const project: WatchedProject = {
      key,
      name: matchedProject?.name || key,
      statuses: [...newStatuses],
    };

    const updated = [...watched, project];
    setWatched(updated);
    saveWatchedProjects(updated);
    setAddProjectKey("");
  }

  // Remove a project from the watch list
  function handleRemoveProject(key: string) {
    const updated = watched.filter((w) => w.key !== key);
    setWatched(updated);
    saveWatchedProjects(updated);
  }

  // Update statuses for a specific project
  function handleUpdateStatuses(key: string, statuses: string[]) {
    const updated = watched.map((w) =>
      w.key === key ? { ...w, statuses } : w
    );
    setWatched(updated);
    saveWatchedProjects(updated);
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

  // Analyze a specific ticket
  async function handleAnalyze(issue: NormalizedIssue) {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setAnalyzingKey(issue.key);
    setError(null);

    try {
      const commentTexts = issue.comments.map((c) => c.body);
      const result = await analyzeJiraTicket(
        issue.key,
        issue.summary,
        issue.descriptionPlaintext || "",
        commentTexts,
        issue.priority || undefined,
        issue.status || undefined,
        issue.components,
        issue.labels,
        apiKey,
        getStoredModel(),
        getStoredProvider(),
      );
      const fullAnalysis = await getAnalysisById(result.id);
      onAnalysisComplete(fullAnalysis);
    } catch (err) {
      setError(`Failed to analyze ${issue.key}: ${err instanceof Error ? err.message : err}`);
    } finally {
      setAnalyzingKey(null);
    }
  }

  // Filter issues by search
  const filteredIssues = debouncedSearch
    ? issues.filter((issue) => {
        const q = debouncedSearch.toLowerCase();
        return (
          issue.key.toLowerCase().includes(q) ||
          issue.summary.toLowerCase().includes(q) ||
          issue.descriptionPlaintext.toLowerCase().includes(q)
        );
      })
    : issues;

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
                      onChange={(e) => setAddProjectKey(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddProject();
                      }}
                      placeholder="Project key (e.g., CRASH)"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-sky-500 uppercase"
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
            onClick={loadIssues}
            disabled={loading}
            className="p-1.5 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
            title="Refresh feed"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? "animate-spin" : ""}`} />
          </button>
          <span className="text-xs text-gray-500">
            {filteredIssues.length} ticket{filteredIssues.length !== 1 ? "s" : ""}
          </span>
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
              expanded={expandedIssues.has(issue.id)}
              onToggle={() => toggleExpanded(issue.id)}
              onAnalyze={() => handleAnalyze(issue)}
              analyzing={analyzingKey === issue.key}
            />
          ))}
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
  expanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

function FeedIssueRow({ issue, expanded, onToggle, onAnalyze, analyzing }: FeedIssueRowProps) {
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

          {/* Description excerpt */}
          {issue.descriptionPlaintext && (
            <div className="text-sm text-gray-400 whitespace-pre-wrap line-clamp-4">
              {issue.descriptionPlaintext.substring(0, 400)}
              {issue.descriptionPlaintext.length > 400 && "..."}
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
