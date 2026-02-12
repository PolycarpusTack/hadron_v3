/**
 * JIRA Ticket Analyzer
 * Tab 1: Paste a JIRA key/URL, fetch and preview the ticket, then analyze with AI.
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  Search,
  ExternalLink,
  AlertCircle,
  Loader2,
  Zap,
  Tag,
  Clock,
  User,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Info,
  FileText,
  CheckCircle2,
} from "lucide-react";
import JiraImportService, { type NormalizedIssue } from "../../services/jira-import";
import { analyzeJiraTicket, getAnalysisById, getStoredApiKey } from "../../services/api";
import { getStoredModel, getStoredProvider } from "../../services/api";
import type { Analysis } from "../../services/api";
import { getStatusColor, getPriorityColor, formatRelativeTime } from "./jiraHelpers";
import { isKBEnabled, getOpenSearchConfig } from "../../services/opensearch";

interface JiraTicketAnalyzerProps {
  onAnalysisComplete: (analysis: Analysis) => void;
}

export default function JiraTicketAnalyzer({ onAnalysisComplete }: JiraTicketAnalyzerProps) {
  const [input, setInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<NormalizedIssue | null>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);

  async function handleFetch() {
    const trimmed = input.trim();
    if (!trimmed) return;

    setFetching(true);
    setError(null);
    setIssue(null);
    setShowFullDescription(false);

    try {
      const key = JiraImportService.parseJiraKeyOrUrl(trimmed);
      if (!key) {
        setError("Invalid JIRA key or URL. Expected PROJ-123 or a JIRA browse URL.");
        return;
      }

      const result = await JiraImportService.fetchSingleIssue(key);
      if (result.success && result.issue) {
        setIssue(result.issue);
      } else {
        setError(result.error || "Failed to fetch issue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  async function handleAnalyze() {
    if (!issue) return;

    const apiKey = await getStoredApiKey();
    if (!apiKey) {
      setError("No API key configured. Set one in Settings.");
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const commentTexts = issue.comments.map((c) => c.body);

      // Check if KB integration is enabled
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
      } catch {
        // KB check failed, continue without KB
      }

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
        undefined, // useRag
        kbOptions,
      );
      const fullAnalysis = await getAnalysisById(result.id);
      onAnalysisComplete(fullAnalysis);
    } catch (err) {
      setError(`Analysis failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleReset() {
    setIssue(null);
    setInput("");
    setError(null);
    setShowFullDescription(false);
  }

  return (
    <div className="space-y-4">
      {/* Input Bar */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !fetching && !analyzing) handleFetch();
            }}
            placeholder="Paste JIRA ticket key (PROJ-123) or URL..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-sky-500 transition"
            disabled={fetching || analyzing}
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={fetching || analyzing || !input.trim()}
          className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition text-sm font-medium flex items-center gap-2"
        >
          {fetching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          {fetching ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Progress indicator during analysis */}
      {analyzing && (
        <div className="flex items-center gap-3 p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
          <div>
            <p className="text-sm text-sky-300 font-medium">Analyzing {issue?.key}...</p>
            <p className="text-xs text-gray-400">Running AI analysis on ticket content</p>
          </div>
        </div>
      )}

      {/* Issue Preview Card */}
      {issue && !analyzing && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-700">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sky-400 text-sm font-medium">
                    {issue.key}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(issue.status)}`}>
                    {issue.status}
                  </span>
                  <span className={`text-xs ${getPriorityColor(issue.priority)}`}>
                    {issue.priority}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-white leading-snug">
                  {issue.summary}
                </h3>
              </div>
              <button
                onClick={() => open(issue.url)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition flex-shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
                Open in JIRA
              </button>
            </div>

            {/* Metadata Row */}
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" />
                {issue.issueType}
              </span>
              {issue.assignee && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {issue.assignee.displayName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Updated {formatRelativeTime(issue.updatedAt)}
              </span>
              {issue.comments.length > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {issue.comments.length} comment{issue.comments.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Labels & Components */}
          {(issue.labels.length > 0 || issue.components.length > 0) && (
            <div className="px-5 py-3 border-b border-gray-700 flex flex-wrap gap-1.5">
              {issue.components.map((c) => (
                <span key={c} className="px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded text-xs text-sky-300">
                  {c}
                </span>
              ))}
              {issue.labels.map((l) => (
                <span key={l} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          {issue.descriptionPlaintext && (
            <div className="px-5 py-4 border-b border-gray-700">
              <div className={`text-sm text-gray-300 whitespace-pre-wrap ${!showFullDescription ? "line-clamp-6" : ""}`}>
                {issue.descriptionPlaintext}
              </div>
              {issue.descriptionPlaintext.length > 400 && (
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="mt-2 text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  {showFullDescription ? (
                    <>
                      <ChevronUp className="w-3 h-3" /> Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" /> Show full description
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Error Signatures */}
          {issue.extractedSignatures.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-700">
              <span className="text-xs text-gray-500 block mb-1.5">Detected Error Signatures</span>
              <div className="flex flex-wrap gap-1.5">
                {issue.extractedSignatures.slice(0, 5).map((sig, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300 font-mono"
                  >
                    {sig.length > 60 ? sig.substring(0, 57) + "..." : sig}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Analysis Sources Box */}
          <AnalysisSourcesBox issue={issue} />

          {/* Action Bar */}
          <div className="px-5 py-4 flex items-center justify-between">
            <button
              onClick={handleReset}
              className="text-sm text-gray-400 hover:text-gray-300 transition"
            >
              Clear & start over
            </button>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-600/50 disabled:cursor-not-allowed rounded-lg transition text-sm font-semibold"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Analyze with AI
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!issue && !fetching && !error && (
        <div className="text-center py-16 text-gray-500">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Paste a JIRA ticket key or URL above to get started</p>
          <p className="text-xs mt-1 text-gray-600">
            e.g. PROJ-123 or https://company.atlassian.net/browse/PROJ-123
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Analysis Sources Box — shows what data the AI will receive
// ============================================================================

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function AnalysisSourcesBox({ issue }: { issue: NormalizedIssue }) {
  const [expanded, setExpanded] = useState(false);

  const descWords = wordCount(issue.descriptionPlaintext);
  const commentWords = issue.comments.reduce((sum, c) => sum + wordCount(c.body), 0);
  const totalWords = wordCount(issue.summary) + descWords + commentWords;

  // Build source entries: icon, label, detail, present?
  const sources: { label: string; detail: string; present: boolean }[] = [
    { label: "Summary", detail: issue.summary.length > 80 ? issue.summary.substring(0, 77) + "..." : issue.summary, present: true },
    { label: "Description", detail: descWords > 0 ? `${descWords.toLocaleString()} words` : "empty", present: descWords > 0 },
    { label: "Comments", detail: issue.comments.length > 0 ? `${issue.comments.length} comment${issue.comments.length !== 1 ? "s" : ""} (${commentWords.toLocaleString()} words)` : "none", present: issue.comments.length > 0 },
    { label: "Priority", detail: issue.priority || "not set", present: !!issue.priority },
    { label: "Status", detail: issue.status, present: !!issue.status },
    { label: "Components", detail: issue.components.length > 0 ? issue.components.join(", ") : "none", present: issue.components.length > 0 },
    { label: "Labels", detail: issue.labels.length > 0 ? issue.labels.join(", ") : "none", present: issue.labels.length > 0 },
  ];

  const presentCount = sources.filter((s) => s.present).length;

  return (
    <div className="mx-5 mb-1 rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-sky-500/10 transition"
      >
        <div className="flex items-center gap-2 text-xs">
          <Info className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-sky-300 font-medium">Analysis Sources</span>
          <span className="text-gray-500">
            {presentCount} fields &middot; ~{totalWords.toLocaleString()} words sent to AI
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            The AI receives a structured document composed from the ticket fields below.
            It analyzes the content for error patterns, root causes, and actionable fixes
            using the same pipeline as the Crash Analyzer.
          </p>

          <div className="space-y-1">
            {sources.map((src) => (
              <div key={src.label} className="flex items-start gap-2 text-xs">
                {src.present ? (
                  <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <FileText className="w-3 h-3 text-gray-600 mt-0.5 flex-shrink-0" />
                )}
                <span className={`font-medium w-20 flex-shrink-0 ${src.present ? "text-gray-300" : "text-gray-600"}`}>
                  {src.label}
                </span>
                <span className={src.present ? "text-gray-400" : "text-gray-600"}>
                  {src.detail}
                </span>
              </div>
            ))}
          </div>

          {issue.extractedSignatures.length > 0 && (
            <p className="text-xs text-gray-500 pt-1 border-t border-gray-700/50">
              {issue.extractedSignatures.length} error signature{issue.extractedSignatures.length !== 1 ? "s" : ""} were
              auto-detected from the ticket content. These are shown above but not sent separately —
              they are already part of the description and comments.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
