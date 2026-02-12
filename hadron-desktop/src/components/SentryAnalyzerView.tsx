/**
 * Sentry Analyzer View
 * Main view for browsing and analyzing Sentry issues
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Search,
  RefreshCw,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  Settings,
  Clock,
  Users,
  Hash,
  Filter,
  Import,
  ChevronDown,
  ChevronUp,
  Zap,
  Loader2,
} from "lucide-react";
import {
  getSentryConfig,
  isSentryEnabled,
  listSentryIssues,
  fetchSentryIssue,
  parseSentryIssueUrl,
  getCachedSentryProjects,
  analyzeSentryIssue,
} from "../services/sentry";
import { getAnalysisById } from "../services/api";
import { AnalysisProgressBar } from "./AnalysisProgressBar";
import logger from "../services/logger";
import type { SentryConfig, SentryIssue, SentryProjectInfo } from "../types";
import type { Analysis } from "../services/api";

interface SentryAnalyzerViewProps {
  onAnalysisComplete?: (analysis: Analysis) => void;
}

type StatusFilter = "unresolved" | "resolved" | "ignored" | "";

export default function SentryAnalyzerView({ onAnalysisComplete }: SentryAnalyzerViewProps) {
  // Config state
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [config, setConfig] = useState<SentryConfig | null>(null);
  const [projects, setProjects] = useState<SentryProjectInfo[]>([]);

  // Analysis state
  const [analyzingIssueId, setAnalyzingIssueId] = useState<string | null>(null);

  // Browse state
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedOrg, setSelectedOrg] = useState("");
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Quick import state
  const [quickImportValue, setQuickImportValue] = useState("");
  const [quickImportLoading, setQuickImportLoading] = useState(false);
  const [quickImportError, setQuickImportError] = useState<string | null>(null);

  // Expanded issue
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  // Search debounce
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Check configuration on mount
  useEffect(() => {
    checkConfig();
  }, []);

  async function checkConfig() {
    try {
      const enabled = await isSentryEnabled();
      setConfigured(enabled);

      if (enabled) {
        const cfg = await getSentryConfig();
        setConfig(cfg);

        const cached = getCachedSentryProjects();
        setProjects(cached.projects);

        // Set defaults from config
        if (cfg.defaultProject && cfg.organization) {
          setSelectedProject(cfg.defaultProject);
          setSelectedOrg(cfg.organization);
        }
      }
    } catch (err) {
      logger.error("Failed to check Sentry config", { error: String(err) });
      setConfigured(false);
    }
  }

  // Auto-load issues when project/org changes
  useEffect(() => {
    if (selectedProject && selectedOrg) {
      loadIssues();
    }
  }, [selectedProject, selectedOrg]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (selectedProject && selectedOrg) {
      searchTimerRef.current = setTimeout(() => {
        loadIssues();
      }, 400);
    }

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery, statusFilter]);

  const loadIssues = useCallback(async () => {
    if (!selectedProject || !selectedOrg) return;

    setLoading(true);
    setError(null);

    try {
      // Build query string
      let query = searchQuery;
      if (statusFilter) {
        query = `${query} is:${statusFilter}`.trim();
      }

      const result = await listSentryIssues(
        selectedOrg,
        selectedProject,
        query || undefined,
        undefined
      );

      setIssues(result.issues);
      setNextCursor(result.nextCursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("Failed to load Sentry issues", { error: msg });
    } finally {
      setLoading(false);
    }
  }, [selectedProject, selectedOrg, searchQuery, statusFilter]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      let query = searchQuery;
      if (statusFilter) {
        query = `${query} is:${statusFilter}`.trim();
      }

      const result = await listSentryIssues(
        selectedOrg,
        selectedProject,
        query || undefined,
        nextCursor
      );

      setIssues((prev) => [...prev, ...result.issues]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      logger.error("Failed to load more issues", { error: String(err) });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleQuickImport = async () => {
    if (!quickImportValue.trim()) return;

    const issueId = parseSentryIssueUrl(quickImportValue);
    if (!issueId) {
      setQuickImportError("Could not parse issue ID from input. Use a numeric ID, short ID (PROJ-123), or Sentry URL.");
      return;
    }

    setQuickImportLoading(true);
    setQuickImportError(null);

    try {
      const issue = await fetchSentryIssue(issueId);
      // Add to top of list if not already present
      setIssues((prev) => {
        if (prev.some((i) => i.id === issue.id)) return prev;
        return [issue, ...prev];
      });
      setExpandedIssueId(issue.id);
      setQuickImportValue("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQuickImportError(msg);
    } finally {
      setQuickImportLoading(false);
    }
  };

  const handleProjectChange = (projectSlug: string) => {
    setSelectedProject(projectSlug);
    // Find org for this project
    const project = projects.find((p) => p.slug === projectSlug);
    if (project) {
      setSelectedOrg(project.organization.slug);
    } else if (config?.organization) {
      setSelectedOrg(config.organization);
    }
    setIssues([]);
    setNextCursor(null);
  };

  const handleAnalyze = async (issue: SentryIssue) => {
    setAnalyzingIssueId(issue.id);
    setError(null);

    try {
      const result = await analyzeSentryIssue(issue.id);
      // Fetch the full analysis object for navigation
      const fullAnalysis = await getAnalysisById(result.id);
      if (onAnalysisComplete) {
        onAnalysisComplete(fullAnalysis);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to analyze ${issue.shortId}: ${msg}`);
      logger.error("Sentry issue analysis failed", { issueId: issue.id, error: msg });
    } finally {
      setAnalyzingIssueId(null);
    }
  };

  // Not configured state
  if (configured === null) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-6 h-6 text-orange-400 animate-spin" />
        <span className="ml-3 text-gray-400">Checking Sentry configuration...</span>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="p-4 bg-orange-500/10 rounded-full mb-4">
          <Shield className="w-10 h-10 text-orange-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">Sentry Not Configured</h2>
        <p className="text-gray-400 mb-4 max-w-md">
          Set up your Sentry integration in Settings &gt; Integrations to start
          analyzing Sentry issues with AI.
        </p>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Settings className="w-4 h-4" />
          <span>Settings &gt; Integrations &gt; Sentry Integration</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-500/20 rounded-lg">
            <Shield className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Sentry Analyzer</h2>
            <p className="text-sm text-gray-400">Browse and analyze Sentry issues with AI</p>
          </div>
        </div>
      </div>

      {/* Quick Import Bar */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center gap-3">
          <Import className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={quickImportValue}
            onChange={(e) => {
              setQuickImportValue(e.target.value);
              setQuickImportError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleQuickImport();
            }}
            placeholder="Paste Sentry issue URL or ID (e.g., PROJ-123 or https://sentry.io/.../issues/12345/)"
            className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder-gray-500"
          />
          <button
            onClick={handleQuickImport}
            disabled={quickImportLoading || !quickImportValue.trim()}
            className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition flex items-center gap-2"
          >
            {quickImportLoading ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )}
            Import
          </button>
        </div>
        {quickImportError && (
          <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {quickImportError}
          </p>
        )}
      </div>

      {/* Filters Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Project Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 font-medium">Project:</label>
          <select
            value={selectedProject}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="">Select project...</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
                {p.platform ? ` (${p.platform})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="">All statuses</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search issues..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={loadIssues}
          disabled={loading || !selectedProject}
          className="p-1.5 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
          title="Refresh issues"
        >
          <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Analysis Progress Bar */}
      {analyzingIssueId && (
        <AnalysisProgressBar isAnalyzing={true} />
      )}

      {/* Issue List */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Failed to load issues</p>
            <p className="text-red-400/70">{error}</p>
          </div>
        </div>
      )}

      {!selectedProject && !loading && (
        <div className="text-center py-12 text-gray-500">
          <Shield className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>Select a project to browse issues</p>
        </div>
      )}

      {selectedProject && loading && issues.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 text-orange-400 animate-spin" />
          <span className="ml-2 text-gray-400">Loading issues...</span>
        </div>
      )}

      {selectedProject && !loading && issues.length === 0 && !error && (
        <div className="text-center py-12 text-gray-500">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No issues found</p>
          <p className="text-xs mt-1">Try adjusting your search or status filter</p>
        </div>
      )}

      {issues.length > 0 && (
        <div className="space-y-1">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              expanded={expandedIssueId === issue.id}
              onToggleExpand={() =>
                setExpandedIssueId(expandedIssueId === issue.id ? null : issue.id)
              }
              onAnalyze={() => handleAnalyze(issue)}
              analyzing={analyzingIssueId === issue.id}
            />
          ))}

          {/* Load More */}
          {nextCursor && (
            <div className="pt-2 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 text-sm text-gray-300 rounded-lg transition flex items-center gap-2 mx-auto"
              >
                {loadingMore ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Load More
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Issue Row Component
// ============================================================================

interface IssueRowProps {
  issue: SentryIssue;
  expanded: boolean;
  onToggleExpand: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

function IssueRow({ issue, expanded, onToggleExpand, onAnalyze, analyzing }: IssueRowProps) {
  const levelColor = getLevelColor(issue.level);
  const statusColor = getStatusColor(issue.status);

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition">
      {/* Main Row */}
      <button
        onClick={onToggleExpand}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        {/* Level Badge */}
        <span
          className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${levelColor}`}
        >
          {issue.level}
        </span>

        {/* Title & Culprit */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{issue.title}</p>
          {issue.culprit && (
            <p className="text-xs text-gray-500 truncate">{issue.culprit}</p>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
          {issue.platform && (
            <span className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
              {issue.platform}
            </span>
          )}

          <span className={`px-1.5 py-0.5 rounded ${statusColor}`}>
            {issue.status}
          </span>

          {issue.count && (
            <span className="flex items-center gap-1" title="Event count">
              <Hash className="w-3 h-3" />
              {formatCount(issue.count)}
            </span>
          )}

          {issue.userCount != null && issue.userCount > 0 && (
            <span className="flex items-center gap-1" title="Affected users">
              <Users className="w-3 h-3" />
              {issue.userCount}
            </span>
          )}

          {issue.lastSeen && (
            <span className="flex items-center gap-1" title="Last seen">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(issue.lastSeen)}
            </span>
          )}

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-700/50 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-gray-500">Short ID:</span>{" "}
              <span className="text-gray-300 font-mono">{issue.shortId}</span>
            </div>
            <div>
              <span className="text-gray-500">Issue ID:</span>{" "}
              <span className="text-gray-300 font-mono">{issue.id}</span>
            </div>
            {issue.firstSeen && (
              <div>
                <span className="text-gray-500">First Seen:</span>{" "}
                <span className="text-gray-300">
                  {new Date(issue.firstSeen).toLocaleString()}
                </span>
              </div>
            )}
            {issue.lastSeen && (
              <div>
                <span className="text-gray-500">Last Seen:</span>{" "}
                <span className="text-gray-300">
                  {new Date(issue.lastSeen).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-600/50 disabled:cursor-not-allowed text-sm text-white rounded-lg transition"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  Analyze with AI
                </>
              )}
            </button>
            {issue.permalink && (
              <a
                href={issue.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 rounded-lg transition"
              >
                <ExternalLink className="w-3 h-3" />
                View in Sentry
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getLevelColor(level: string): string {
  switch (level) {
    case "fatal":
      return "bg-red-600 text-white";
    case "error":
      return "bg-red-500/20 text-red-400";
    case "warning":
      return "bg-yellow-500/20 text-yellow-400";
    case "info":
      return "bg-blue-500/20 text-blue-400";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "unresolved":
      return "bg-orange-500/20 text-orange-400";
    case "resolved":
      return "bg-green-500/20 text-green-400";
    case "ignored":
      return "bg-gray-500/20 text-gray-400";
    default:
      return "bg-gray-500/20 text-gray-400";
  }
}

function formatCount(count: string): string {
  const n = parseInt(count, 10);
  if (isNaN(n)) return count;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
