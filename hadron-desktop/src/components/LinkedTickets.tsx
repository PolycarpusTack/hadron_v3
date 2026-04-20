/**
 * LinkedTickets Component
 * Phase 3: Displays and manages JIRA ticket links for an analysis
 *
 * Features:
 * - Display linked JIRA tickets with status/priority badges
 * - Add new ticket links via search or manual entry
 * - Remove existing links
 * - Open tickets in browser
 */

import { useState, useEffect, useCallback } from "react";
import { openExternal as open } from "../utils/openExternal";
import Button from "./ui/Button";
import {
  JiraLink,
  linkJiraToAnalysis,
  unlinkJiraFromAnalysis,
  getJiraLinksForAnalysis,
  getStatusStyle,
  getPriorityStyle,
  getAvailableLinkTypes,
  getLinkTypeDisplayName,
} from "../services/jira-linking";
import { getCachedIssuesAsync, type NormalizedIssue } from "../services/jira-import";
import logger from "../services/logger";

interface LinkedTicketsProps {
  analysisId: number;
  /** Callback when links change (for parent component refresh) */
  onLinksChange?: () => void;
  /** Compact mode for sidebar display */
  compact?: boolean;
}

export default function LinkedTickets({
  analysisId,
  onLinksChange,
  compact = false,
}: LinkedTicketsProps) {
  const [links, setLinks] = useState<JiraLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);

  // Load linked tickets
  const loadLinks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getJiraLinksForAnalysis(analysisId);
      setLinks(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      logger.error("Failed to load linked tickets", { error: e, analysisId });
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  // Handle unlink
  const handleUnlink = async (jiraKey: string) => {
    try {
      setUnlinkingKey(jiraKey);
      await unlinkJiraFromAnalysis(analysisId, jiraKey);
      setLinks((prev) => prev.filter((l) => l.jiraKey !== jiraKey));
      onLinksChange?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to unlink: ${message}`);
    } finally {
      setUnlinkingKey(null);
    }
  };

  // Handle link success
  const handleLinkSuccess = (link: JiraLink) => {
    setLinks((prev) => [link, ...prev]);
    setShowLinkModal(false);
    onLinksChange?.();
  };

  // Open ticket in browser
  const openTicket = async (url: string) => {
    try {
      await open(url);
    } catch (e) {
      logger.error("Failed to open ticket URL", { error: e, url });
    }
  };

  if (loading) {
    return (
      <div className={`${compact ? "p-2" : "p-4"} animate-pulse`}>
        <div className="h-4 bg-gray-700/50 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-700/50 rounded w-1/2"></div>
      </div>
    );
  }

  return (
    <div className={`${compact ? "" : "border border-gray-700 rounded-lg"}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between ${
          compact ? "mb-2" : "p-3 border-b border-gray-700"
        }`}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
            />
          </svg>
          <span className={`font-medium ${compact ? "text-sm" : ""}`}>
            Linked JIRA Tickets
          </span>
          {links.length > 0 && (
            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
              {links.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowLinkModal(true)}
          className="p-1.5 hover:bg-gray-700 rounded transition text-gray-400 hover:text-white"
          title="Link JIRA Ticket"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-3 mb-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Links List */}
      <div className={compact ? "" : "p-3"}>
        {links.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-4">
            No linked JIRA tickets.
            <button
              onClick={() => setShowLinkModal(true)}
              className="block mx-auto mt-2 text-blue-400 hover:text-blue-300"
            >
              Link a ticket
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <LinkedTicketCard
                key={link.jiraKey}
                link={link}
                onUnlink={() => handleUnlink(link.jiraKey)}
                onOpen={() => link.jiraUrl && openTicket(link.jiraUrl)}
                unlinking={unlinkingKey === link.jiraKey}
                compact={compact}
              />
            ))}
          </div>
        )}
      </div>

      {/* Link Modal */}
      {showLinkModal && (
        <LinkTicketModal
          analysisId={analysisId}
          existingKeys={links.map((l) => l.jiraKey)}
          onClose={() => setShowLinkModal(false)}
          onSuccess={handleLinkSuccess}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface LinkedTicketCardProps {
  link: JiraLink;
  onUnlink: () => void;
  onOpen: () => void;
  unlinking: boolean;
  compact: boolean;
}

function LinkedTicketCard({
  link,
  onUnlink,
  onOpen,
  unlinking,
  compact,
}: LinkedTicketCardProps) {
  const statusStyle = getStatusStyle(link.jiraStatus);
  const priorityStyle = getPriorityStyle(link.jiraPriority);
  const linkTypeInfo = getLinkTypeDisplayName(link.linkType);

  return (
    <div
      className={`group relative bg-gray-800/50 border border-gray-700 rounded-lg ${
        compact ? "p-2" : "p-3"
      } hover:border-gray-600 transition`}
    >
      {/* Main Content */}
      <div className="flex items-start gap-3">
        {/* JIRA Icon */}
        <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 rounded flex items-center justify-center">
          <svg
            className="w-4 h-4 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Key & Summary */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpen}
              disabled={!link.jiraUrl}
              className="font-mono text-sm text-blue-400 hover:text-blue-300 hover:underline disabled:text-gray-500 disabled:no-underline"
            >
              {link.jiraKey}
            </button>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${statusStyle.bgColor} ${statusStyle.textColor} border ${statusStyle.borderColor}`}
            >
              {link.jiraStatus || "Unknown"}
            </span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${priorityStyle.bgColor} ${priorityStyle.textColor}`}
              title={link.jiraPriority || "Unknown Priority"}
            >
              {priorityStyle.icon}
            </span>
          </div>

          {/* Summary */}
          {link.jiraSummary && (
            <p className="text-sm text-gray-300 mt-1 truncate" title={link.jiraSummary}>
              {link.jiraSummary}
            </p>
          )}

          {/* Link Type & Date */}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
            <span className="bg-gray-700/50 px-1.5 py-0.5 rounded">
              {linkTypeInfo.label}
            </span>
            <span>
              Linked {new Date(link.linkedAt).toLocaleDateString()}
            </span>
          </div>

          {/* Notes */}
          {link.notes && !compact && (
            <p className="text-xs text-gray-500 mt-1.5 italic">
              Note: {link.notes}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={onUnlink}
            disabled={unlinking}
            className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition disabled:opacity-50"
            title="Unlink ticket"
          >
            {unlinking ? (
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Link Modal
// ============================================================================

interface LinkTicketModalProps {
  analysisId: number;
  existingKeys: string[];
  onClose: () => void;
  onSuccess: (link: JiraLink) => void;
}

function LinkTicketModal({
  analysisId,
  existingKeys,
  onClose,
  onSuccess,
}: LinkTicketModalProps) {
  const [mode, setMode] = useState<"search" | "manual">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NormalizedIssue[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual entry state
  const [manualKey, setManualKey] = useState("");
  const [manualSummary, setManualSummary] = useState("");
  const [linkType, setLinkType] = useState<"related" | "causes" | "caused_by" | "duplicates" | "blocks">("related");
  const [notes, setNotes] = useState("");

  const linkTypes = getAvailableLinkTypes();

  // Search for issues in IndexedDB
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setSearching(true);
      setError(null);

      // Get issues from IndexedDB and filter
      const allIssues = await getCachedIssuesAsync();
      const query = searchQuery.toLowerCase();
      const filtered = allIssues.filter(
        (issue: NormalizedIssue) =>
          !existingKeys.includes(issue.key) &&
          (issue.key.toLowerCase().includes(query) ||
            issue.summary.toLowerCase().includes(query))
      );
      setSearchResults(filtered.slice(0, 10));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setSearching(false);
    }
  };

  // Link selected issue
  const handleLinkIssue = async (issue: NormalizedIssue) => {
    try {
      setLinking(true);
      setError(null);

      const link = await linkJiraToAnalysis({
        analysisId,
        jiraKey: issue.key,
        jiraUrl: issue.url,
        jiraSummary: issue.summary,
        jiraStatus: issue.status,
        jiraPriority: issue.priority,
        linkType,
        notes: notes || undefined,
      });

      onSuccess(link);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setLinking(false);
    }
  };

  // Link manual entry
  const handleLinkManual = async () => {
    if (!manualKey.trim()) {
      setError("JIRA key is required");
      return;
    }

    if (existingKeys.includes(manualKey.trim().toUpperCase())) {
      setError("This ticket is already linked");
      return;
    }

    try {
      setLinking(true);
      setError(null);

      const link = await linkJiraToAnalysis({
        analysisId,
        jiraKey: manualKey.trim().toUpperCase(),
        jiraSummary: manualSummary || undefined,
        linkType,
        notes: notes || undefined,
      });

      onSuccess(link);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="font-semibold text-lg">Link JIRA Ticket</h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded transition"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setMode("search")}
            className={`flex-1 px-4 py-2 text-sm font-medium transition ${
              mode === "search"
                ? "bg-blue-500/20 text-blue-400 border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            Search Imported
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`flex-1 px-4 py-2 text-sm font-medium transition ${
              mode === "manual"
                ? "bg-blue-500/20 text-blue-400 border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            Manual Entry
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {error && (
            <div className="mb-4 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
              {error}
            </div>
          )}

          {mode === "search" ? (
            <>
              {/* Search Input */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search by key or summary..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <Button
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                >
                  {searching ? "..." : "Search"}
                </Button>
              </div>

              {/* Search Results */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-4">
                    {searchQuery
                      ? "No matching issues found"
                      : "Search your imported JIRA issues"}
                  </p>
                ) : (
                  searchResults.map((issue) => (
                    <button
                      key={issue.key}
                      onClick={() => handleLinkIssue(issue)}
                      disabled={linking}
                      className="w-full text-left p-3 bg-gray-800/50 border border-gray-700 rounded-lg hover:border-blue-500/50 transition disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-blue-400">
                          {issue.key}
                        </span>
                        <span className="text-xs bg-gray-700 px-1.5 py-0.5 rounded">
                          {issue.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 mt-1 truncate">
                        {issue.summary}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* Manual Entry Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    JIRA Key *
                  </label>
                  <input
                    type="text"
                    value={manualKey}
                    onChange={(e) => setManualKey(e.target.value.toUpperCase())}
                    placeholder="e.g., PROJ-123"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Summary (optional)
                  </label>
                  <input
                    type="text"
                    value={manualSummary}
                    onChange={(e) => setManualSummary(e.target.value)}
                    placeholder="Brief description"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Link Type
                  </label>
                  <select
                    value={linkType}
                    onChange={(e) => setLinkType(e.target.value as typeof linkType)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    {linkTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label} - {type.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add context about this link..."
                    rows={2}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>

                <Button
                  onClick={handleLinkManual}
                  disabled={linking || !manualKey.trim()}
                  fullWidth
                  loading={linking}
                >
                  {linking ? "Linking..." : "Link Ticket"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
