/**
 * JIRA Import Panel Component
 * Phase 3 - Displays and manages JIRA issues imported for RAG context
 */

import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  RefreshCw,
  Search,
  ExternalLink,
  AlertCircle,
  Check,
  Clock,
  Tag,
  FileText,
  Sparkles,
  Filter,
  ChevronDown,
  ChevronUp,
  Loader2,
  Link2,
  Plus,
  Zap,
} from "lucide-react";
import JiraImportService, {
  type NormalizedIssue,
  type ImportResult,
} from "../services/jira-import";
import { isJiraEnabled } from "../services/jira";
import { analyzeJiraTicket, getAnalysisById, getStoredApiKey } from "../services/api";
import logger from "../services/logger";
import type { Analysis } from "../services/api";

interface JiraImportPanelProps {
  onClose?: () => void;
  onLinkIssue?: (issue: NormalizedIssue) => void;
  embedded?: boolean;
  onAnalysisComplete?: (analysis: Analysis) => void;
}

type SortField = "updatedAt" | "crashRelevanceScore" | "key";
type SortDirection = "asc" | "desc";

export default function JiraImportPanel({ onClose, onLinkIssue, embedded = false, onAnalysisComplete }: JiraImportPanelProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const [issues, setIssues] = useState<NormalizedIssue[]>([]);
  const [syncResult, setSyncResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("crashRelevanceScore");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [minRelevanceScore, setMinRelevanceScore] = useState(0);
  const [selectedIssueType, setSelectedIssueType] = useState<string>("all");

  // Manual import state
  const [manualImportInput, setManualImportInput] = useState("");
  const [manualImporting, setManualImporting] = useState(false);
  const [manualImportResult, setManualImportResult] = useState<{
    type: "success" | "error";
    message: string;
    issueKey?: string;
  } | null>(null);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const enabled = await isJiraEnabled();
      setIsEnabled(enabled);

      if (enabled) {
        const cached = JiraImportService.getCachedIssues();
        setIssues(cached);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      logger.error("Failed to load JIRA import data", { error: e });
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);

    try {
      const result = await JiraImportService.syncIssues();
      setSyncResult(result);

      if (result.success) {
        const cached = JiraImportService.getCachedIssues();
        setIssues(cached);
      } else if (result.errors.length > 0) {
        setError(result.errors.join(", "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
      logger.error("JIRA sync failed", { error: e });
    } finally {
      setSyncing(false);
    }
  }

  function handleGenerateCaseFiles() {
    const caseFiles = JiraImportService.generateCaseFiles(filteredIssues);

    // Download as JSON file
    const blob = new Blob([JSON.stringify(caseFiles, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jira-cases-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logger.info("Generated case files", { count: caseFiles.length });
  }

  async function handleManualImport() {
    if (!manualImportInput.trim()) return;

    setManualImporting(true);
    setManualImportResult(null);

    try {
      const result = await JiraImportService.importSingleIssue(manualImportInput.trim());

      if (result.success && result.issue) {
        setManualImportResult({
          type: "success",
          message: result.alreadyExists
            ? `Updated ${result.issue.key}`
            : `Imported ${result.issue.key}`,
          issueKey: result.issue.key,
        });

        // Refresh the list
        const cached = JiraImportService.getCachedIssues();
        setIssues(cached);

        // Expand the newly imported issue
        setExpandedIssues(prev => new Set([...prev, result.issue!.id]));

        // Clear input
        setManualImportInput("");

        // Clear success message after 5 seconds
        setTimeout(() => setManualImportResult(null), 5000);
      } else {
        setManualImportResult({
          type: "error",
          message: result.error || "Failed to import issue",
        });
      }
    } catch (e) {
      setManualImportResult({
        type: "error",
        message: e instanceof Error ? e.message : "Import failed",
      });
      logger.error("Manual JIRA import failed", { error: e });
    } finally {
      setManualImporting(false);
    }
  }

  async function handleAnalyzeTicket(issue: NormalizedIssue) {
    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Please set an API key in Settings.");
      return;
    }
    setAnalyzingKey(issue.key);
    setError(null);
    try {
      const commentTexts = issue.comments.map(c => c.body);
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
      );
      // Fetch full analysis and navigate to detail view
      const fullAnalysis = await getAnalysisById(result.id);
      if (onAnalysisComplete) {
        onAnalysisComplete(fullAnalysis);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      setError(`Failed to analyze ${issue.key}: ${msg}`);
      logger.error("JIRA ticket analysis failed", { key: issue.key, error: err });
    } finally {
      setAnalyzingKey(null);
    }
  }

  function toggleExpanded(issueId: string) {
    setExpandedIssues(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }

  // Filter and sort issues
  const filteredIssues = issues
    .filter(issue => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          issue.key.toLowerCase().includes(query) ||
          issue.summary.toLowerCase().includes(query) ||
          issue.descriptionPlaintext.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Relevance score filter
      if (issue.crashRelevanceScore < minRelevanceScore) return false;

      // Issue type filter
      if (selectedIssueType !== "all" && issue.issueType !== selectedIssueType) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "crashRelevanceScore":
          comparison = a.crashRelevanceScore - b.crashRelevanceScore;
          break;
        case "updatedAt":
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case "key":
          comparison = a.key.localeCompare(b.key);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

  // Get unique issue types for filter
  const issueTypes = [...new Set(issues.map(i => i.issueType))];

  // Get sync state
  const syncState = JiraImportService.getSyncState();

  if (loading) {
    if (embedded) {
      return (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-8 flex items-center gap-4">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          <span className="text-gray-300">Loading JIRA integration...</span>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-xl p-8 flex items-center gap-4">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          <span className="text-gray-300">Loading JIRA integration...</span>
        </div>
      </div>
    );
  }

  if (!isEnabled) {
    const emptyState = (
      <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-md w-full p-6">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold mb-2">JIRA Not Configured</h3>
          <p className="text-gray-400 mb-4">
            Please configure JIRA integration in Settings to import issues.
          </p>
          {onClose && (
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );

    if (embedded) {
      return <div className="flex items-center justify-center">{emptyState}</div>;
    }

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        {emptyState}
      </div>
    );
  }

  const panel = (
    <div className={`bg-gray-900 rounded-xl border border-gray-700 ${embedded ? "w-full" : "max-w-5xl w-full max-h-[90vh]"} overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold">JIRA Issue Intelligence</h2>
              <p className="text-sm text-gray-400">
                Import and analyze JIRA issues for crash correlation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateCaseFiles}
              disabled={filteredIssues.length === 0}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Generate case files for RAG"
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-sm">Export for RAG</span>
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="text-sm">{syncing ? "Syncing..." : "Sync"}</span>
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-700 rounded-lg transition"
              >
                <span className="text-xl">&times;</span>
              </button>
            )}
          </div>
        </div>

        {/* Sync Status */}
        {syncState && (
          <div className="px-6 py-2 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between text-sm">
            <div className="flex items-center gap-4 text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last sync: {new Date(syncState.lastSyncAt).toLocaleString()}
              </span>
              <span>{syncState.totalImported} issues imported</span>
            </div>
            {syncResult && (
              <span className={syncResult.success ? "text-green-400" : "text-red-400"}>
                {syncResult.success
                  ? `Synced ${syncResult.totalImported} issues in ${(syncResult.duration / 1000).toFixed(1)}s`
                  : syncResult.errors.join(", ")}
              </span>
            )}
          </div>
        )}

        {/* Search and Filters */}
        <div className="px-6 py-3 border-b border-gray-700 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search issues by key, summary, or description..."
                className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition ${
                showFilters
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 hover:bg-gray-600 text-gray-300"
              }`}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm">Filters</span>
            </button>
          </div>

          {showFilters && (
            <div className="flex gap-4 items-center text-sm">
              <div className="flex items-center gap-2">
                <label className="text-gray-400">Min Relevance:</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={minRelevanceScore}
                  onChange={e => setMinRelevanceScore(parseFloat(e.target.value))}
                  className="w-24"
                />
                <span className="text-gray-300">{(minRelevanceScore * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-gray-400">Type:</label>
                <select
                  value={selectedIssueType}
                  onChange={e => setSelectedIssueType(e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1"
                >
                  <option value="all">All Types</option>
                  {issueTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Manual Import */}
          <div className="flex gap-2 pt-2 border-t border-gray-700">
            <div className="flex-1 relative">
              <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={manualImportInput}
                onChange={e => setManualImportInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !manualImporting) {
                    handleManualImport();
                  }
                }}
                placeholder="Paste JIRA URL or issue key (e.g., CRASH-123)"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-green-500"
                disabled={manualImporting}
              />
            </div>
            <button
              onClick={handleManualImport}
              disabled={manualImporting || !manualImportInput.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition text-sm font-medium"
            >
              {manualImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {manualImporting ? "Importing..." : "Import"}
            </button>
          </div>

          {/* Manual Import Result */}
          {manualImportResult && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                manualImportResult.type === "success"
                  ? "bg-green-500/10 border border-green-500/30 text-green-400"
                  : "bg-red-500/10 border border-red-500/30 text-red-400"
              }`}
            >
              {manualImportResult.type === "success" ? (
                <Check className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{manualImportResult.message}</span>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Issues List */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredIssues.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-400 mb-2">
                {issues.length === 0 ? "No Issues Imported" : "No Matching Issues"}
              </h3>
              <p className="text-gray-500 max-w-md mx-auto">
                {issues.length === 0
                  ? "Click 'Sync' to import crash-relevant issues from JIRA"
                  : "Try adjusting your search or filter criteria"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Sort Header */}
              <div className="flex items-center gap-4 text-xs text-gray-500 px-4">
                <button
                  onClick={() => handleSort("key")}
                  className="flex items-center gap-1 hover:text-gray-300 transition"
                >
                  Key
                  {sortField === "key" && (
                    sortDirection === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <span className="flex-1">Summary</span>
                <button
                  onClick={() => handleSort("crashRelevanceScore")}
                  className="flex items-center gap-1 hover:text-gray-300 transition"
                >
                  Relevance
                  {sortField === "crashRelevanceScore" && (
                    sortDirection === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={() => handleSort("updatedAt")}
                  className="flex items-center gap-1 hover:text-gray-300 transition"
                >
                  Updated
                  {sortField === "updatedAt" && (
                    sortDirection === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              </div>

              {/* Issue Cards */}
              {filteredIssues.map(issue => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  expanded={expandedIssues.has(issue.id)}
                  onToggleExpand={() => toggleExpanded(issue.id)}
                  onLink={onLinkIssue ? () => onLinkIssue(issue) : undefined}
                  onAnalyze={() => handleAnalyzeTicket(issue)}
                  analyzing={analyzingKey === issue.key}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-between items-center text-sm text-gray-500">
          <span>
            Showing {filteredIssues.length} of {issues.length} issues
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Close
            </button>
          )}
        </div>
    </div>
  );

  if (embedded) {
    return panel;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      {panel}
    </div>
  );
}

// ============================================================================
// Issue Card Component
// ============================================================================

interface IssueCardProps {
  issue: NormalizedIssue;
  expanded: boolean;
  onToggleExpand: () => void;
  onLink?: () => void;
  onAnalyze?: () => void;
  analyzing?: boolean;
}

function IssueCard({ issue, expanded, onToggleExpand, onLink, onAnalyze, analyzing }: IssueCardProps) {
  const relevanceColor =
    issue.crashRelevanceScore >= 0.7
      ? "text-green-400"
      : issue.crashRelevanceScore >= 0.4
      ? "text-yellow-400"
      : "text-gray-400";

  const statusColor = getStatusColor(issue.status);

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
      {/* Card Header */}
      <div
        className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-gray-800/70 transition"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-blue-400">{issue.key}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${statusColor}`}>
            {issue.status}
          </span>
        </div>

        <span className="flex-1 truncate">{issue.summary}</span>

        <div className="flex items-center gap-4 flex-shrink-0">
          {/* Relevance Score */}
          <div className={`text-sm ${relevanceColor}`}>
            {(issue.crashRelevanceScore * 100).toFixed(0)}%
          </div>

          {/* Updated Date */}
          <span className="text-xs text-gray-500">
            {new Date(issue.updatedAt).toLocaleDateString()}
          </span>

          {/* Expand/Collapse */}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 py-3 border-t border-gray-700 space-y-3">
          {/* Metadata */}
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1 text-gray-400">
              <Tag className="w-3 h-3" />
              {issue.issueType}
            </span>
            {issue.priority && (
              <span className="text-gray-400">Priority: {issue.priority}</span>
            )}
            {issue.components.length > 0 && (
              <span className="text-gray-400">
                Components: {issue.components.join(", ")}
              </span>
            )}
            {issue.resolution && (
              <span className="text-green-400">
                Resolution: {issue.resolution}
              </span>
            )}
          </div>

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {issue.labels.map(label => (
                <span
                  key={label}
                  className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Description Preview */}
          {issue.descriptionPlaintext && (
            <div className="text-sm text-gray-400 whitespace-pre-wrap line-clamp-4">
              {issue.descriptionPlaintext.substring(0, 500)}
              {issue.descriptionPlaintext.length > 500 && "..."}
            </div>
          )}

          {/* Extracted Signatures */}
          {issue.extractedSignatures.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Extracted Error Signatures:</span>
              <div className="flex flex-wrap gap-1">
                {issue.extractedSignatures.slice(0, 5).map((sig, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300 font-mono"
                  >
                    {sig.substring(0, 50)}
                    {sig.length > 50 && "..."}
                  </span>
                ))}
                {issue.extractedSignatures.length > 5 && (
                  <span className="text-xs text-gray-500">
                    +{issue.extractedSignatures.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
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
            {onLink && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onLink();
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded text-sm text-blue-400 transition"
              >
                <Link2 className="w-3 h-3" />
                Link to Crash
              </button>
            )}
            {onAnalyze && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onAnalyze();
                }}
                disabled={analyzing}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded text-sm text-white transition"
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes("done") || lower.includes("resolved") || lower.includes("closed")) {
    return "bg-green-500/20 text-green-400";
  }
  if (lower.includes("progress") || lower.includes("review")) {
    return "bg-blue-500/20 text-blue-400";
  }
  if (lower.includes("blocked") || lower.includes("hold")) {
    return "bg-red-500/20 text-red-400";
  }
  return "bg-gray-500/20 text-gray-400";
}
