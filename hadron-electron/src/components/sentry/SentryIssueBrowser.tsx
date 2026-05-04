/**
 * Sentry Issue Browser
 * Filters, search, issue list with pagination
 */

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  RefreshCw,
  AlertCircle,
  ChevronRight,
  Clock,
  Shield,
  Filter,
} from "lucide-react";
import { listSentryIssues, listSentryOrgIssues } from "../../services/sentry";
import { useDebounce } from "../../hooks/useDebounce";
import logger from "../../services/logger";
import type { SentryConfig, SentryIssue, SentryProjectInfo } from "../../types";
import SentryIssueRow from "./SentryIssueRow";

type StatusFilter = "unresolved" | "resolved" | "ignored" | "";

const RECENT_ALL_PROJECTS = "__recent_all__";

interface SentryIssueBrowserProps {
  config: SentryConfig;
  projects: SentryProjectInfo[];
  analyzingIssueId: string | null;
  onAnalyze: (issue: SentryIssue) => void;
  onIssueCountChange?: (count: number) => void;
}

export default function SentryIssueBrowser({
  config,
  projects,
  analyzingIssueId,
  onAnalyze,
  onIssueCountChange,
}: SentryIssueBrowserProps) {
  const [selectedProject, setSelectedProject] = useState(config.defaultProject || "");
  const [selectedOrg, setSelectedOrg] = useState(config.organization || "");
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 400);
  const debouncedStatus = useDebounce(statusFilter, 400);

  // Report issue count up to parent for tab badge
  useEffect(() => {
    onIssueCountChange?.(issues.length);
  }, [issues.length, onIssueCountChange]);

  // Auto-load issues when project/org changes
  useEffect(() => {
    if (selectedProject && selectedOrg) {
      loadIssues();
    }
  }, [selectedProject, selectedOrg]);

  // Reload when debounced search/status changes
  useEffect(() => {
    if (selectedProject && selectedOrg) {
      loadIssues();
    }
  }, [debouncedSearch, debouncedStatus]);

  const isOrgWide = selectedProject === RECENT_ALL_PROJECTS;

  const loadIssues = useCallback(async () => {
    if (!selectedProject || !selectedOrg) return;

    setLoading(true);
    setError(null);

    try {
      let query = searchQuery;
      if (statusFilter) {
        query = `${query} is:${statusFilter}`.trim();
      }

      let result;
      if (selectedProject === RECENT_ALL_PROJECTS) {
        // Org-level: prepend lastSeen filter to user query
        const orgQuery = query
          ? `lastSeen:-24h ${query}`
          : "lastSeen:-24h";
        result = await listSentryOrgIssues(
          selectedOrg,
          orgQuery,
          undefined
        );
      } else {
        result = await listSentryIssues(
          selectedOrg,
          selectedProject,
          query || undefined,
          undefined
        );
      }

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

      let result;
      if (selectedProject === RECENT_ALL_PROJECTS) {
        const orgQuery = query
          ? `lastSeen:-24h ${query}`
          : "lastSeen:-24h";
        result = await listSentryOrgIssues(
          selectedOrg,
          orgQuery,
          nextCursor
        );
      } else {
        result = await listSentryIssues(
          selectedOrg,
          selectedProject,
          query || undefined,
          nextCursor
        );
      }

      setIssues((prev) => [...prev, ...result.issues]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      logger.error("Failed to load more issues", { error: String(err) });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleProjectChange = (projectSlug: string) => {
    setSelectedProject(projectSlug);
    if (projectSlug === RECENT_ALL_PROJECTS) {
      // Use org from config for cross-project view
      setSelectedOrg(config.organization || "");
    } else {
      const project = projects.find((p) => p.slug === projectSlug);
      if (project) {
        setSelectedOrg(project.organization.slug);
      } else if (config.organization) {
        setSelectedOrg(config.organization);
      }
    }
    setIssues([]);
    setNextCursor(null);
  };

  return (
    <div className="space-y-4">
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
            {config.organization && (
              <option value={RECENT_ALL_PROJECTS}>
                Recent across all projects (24h)
              </option>
            )}
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

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Failed to load issues</p>
            <p className="text-red-400/70">{error}</p>
          </div>
        </div>
      )}

      {/* Org-wide info */}
      {isOrgWide && issues.length > 0 && !loading && (
        <div className="text-xs text-blue-400/70 flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Showing issues seen in the last 24 hours across all projects
        </div>
      )}

      {/* Empty states */}
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

      {/* Issue List */}
      {issues.length > 0 && (
        <div className="space-y-1">
          {issues.map((issue) => (
            <SentryIssueRow
              key={issue.id}
              issue={issue}
              expanded={expandedIssueId === issue.id}
              onToggleExpand={() =>
                setExpandedIssueId(expandedIssueId === issue.id ? null : issue.id)
              }
              onAnalyze={() => onAnalyze(issue)}
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
