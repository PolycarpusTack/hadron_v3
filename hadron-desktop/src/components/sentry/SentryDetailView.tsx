/**
 * Sentry Detail View
 * Tabbed detail view for completed Sentry analyses, mirroring WhatsOnDetailView structure
 */

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { format } from "date-fns";
import logger from "../../services/logger";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Download,
  Copy,
  Check,
  AlertCircle,
  Info,
  Ticket,
  Shield,
  ExternalLink,
  Layers,
  Users,
  Navigation,
  Server,
  Wrench,
  Fingerprint,
} from "lucide-react";
import type { Analysis } from "../../services/api";
import { isJiraEnabled } from "../../services/jira";
import JiraTicketModal from "../JiraTicketModal";
import { FeedbackButtons } from "../FeedbackButtons";
import { StarRating } from "../StarRating";
import { GoldBadge } from "../GoldBadge";
import { InlineEditor } from "../InlineEditor";
import CitationPanel from "../CitationPanel";
import { getLevelColor } from "./sentryHelpers";

// Sub-components
import SentryUserImpact from "./SentryUserImpact";
import SentryPatternCard from "./SentryPatternCard";
import SentryBreadcrumbTimeline from "./SentryBreadcrumbTimeline";
import SentryExceptionChain from "./SentryExceptionChain";
import SentryRuntimeContext from "./SentryRuntimeContext";

interface SentryDetailViewProps {
  analysis: Analysis;
  onBack: () => void;
}

type TabId =
  | "overview"
  | "patterns"
  | "breadcrumbs"
  | "stacktrace"
  | "context"
  | "metadata";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Info className="w-4 h-4" /> },
  { id: "patterns", label: "Patterns", icon: <Fingerprint className="w-4 h-4" /> },
  { id: "breadcrumbs", label: "Breadcrumbs", icon: <Navigation className="w-4 h-4" /> },
  { id: "stacktrace", label: "Stack Trace", icon: <Layers className="w-4 h-4" /> },
  { id: "context", label: "Context", icon: <Server className="w-4 h-4" /> },
  { id: "metadata", label: "Metadata", icon: <Info className="w-4 h-4" /> },
];

/** Parsed Sentry full_data */
interface SentryFullData {
  issueId?: string;
  shortId?: string;
  permalink?: string;
  level?: string;
  status?: string;
  platform?: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  culprit?: string;
  detectedPatterns: Array<{
    patternType: string;
    confidence: number;
    evidence: string[];
  }>;
  aiResult?: {
    root_cause?: string;
    suggested_fixes?: string[];
    error_type?: string;
    error_message?: string;
    severity?: string;
    component?: string;
    confidence?: string;
    pattern_type?: string;
    user_impact?: string;
    breadcrumb_analysis?: string;
  };
  breadcrumbs: Array<{
    timestamp?: string;
    category?: string;
    message?: string;
    level?: string;
    data?: Record<string, unknown>;
    breadcrumb_type?: string;
  }>;
  exceptions: Array<{
    exception_type?: string;
    value?: string;
    module?: string;
    stacktrace?: {
      frames?: Array<{
        filename?: string;
        function?: string;
        lineNo?: number;
        colNo?: number;
        contextLine?: string;
        preContext?: string[];
        postContext?: string[];
        inApp?: boolean;
        module?: string;
      }>;
    };
  }>;
  tags: Array<{ key: string; value: string }>;
  contexts?: Record<string, unknown>;
}

function parseSentryFullData(fullDataStr?: string): SentryFullData | null {
  if (!fullDataStr) return null;
  try {
    const data = JSON.parse(fullDataStr);
    return {
      issueId: data.sentry_issue_id,
      shortId: data.sentry_short_id,
      permalink: data.sentry_permalink,
      level: data.sentry_level,
      status: data.sentry_status,
      platform: data.sentry_platform,
      count: data.sentry_count,
      userCount: data.sentry_user_count,
      firstSeen: data.sentry_first_seen,
      lastSeen: data.sentry_last_seen,
      culprit: data.sentry_culprit,
      detectedPatterns: data.detected_patterns || [],
      aiResult: data.ai_result || null,
      breadcrumbs: data.breadcrumbs || [],
      exceptions: data.exceptions || [],
      tags: data.tags || [],
      contexts: data.contexts || null,
    };
  } catch {
    return null;
  }
}

export default function SentryDetailView({
  analysis,
  onBack,
}: SentryDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [copied, setCopied] = useState(false);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [jiraEnabled, setJiraEnabled] = useState(false);
  const [isGold, setIsGold] = useState(false);
  const [editableRootCause, setEditableRootCause] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const sentryData = parseSentryFullData(analysis.full_data);
  const aiResult = sentryData?.aiResult;
  const currentRootCause =
    editableRootCause ?? aiResult?.root_cause ?? analysis.root_cause;

  useEffect(() => {
    isJiraEnabled().then(setJiraEnabled);
  }, []);

  useEffect(() => {
    invoke<boolean>("is_gold_analysis", { analysisId: analysis.id })
      .then(setIsGold)
      .catch(err => logger.error("Failed to check gold analysis status", { error: String(err) }));
  }, [analysis.id]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "high":
        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "low":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const handleCopyToClipboard = () => {
    const text = `
Sentry Analysis Report - ${analysis.filename}
===============================================

Error Type: ${analysis.error_type}
Severity: ${analysis.severity.toUpperCase()}
Analyzed: ${format(new Date(analysis.analyzed_at), "MMMM d, yyyy 'at' h:mm a")}
${sentryData?.permalink ? `Sentry URL: ${sentryData.permalink}` : ""}

ROOT CAUSE
----------
${currentRootCause}

${aiResult?.user_impact ? `USER IMPACT\n-----------\n${aiResult.user_impact}\n` : ""}
${aiResult?.breadcrumb_analysis ? `BREADCRUMB ANALYSIS\n-------------------\n${aiResult.breadcrumb_analysis}\n` : ""}
SUGGESTED FIXES
---------------
${analysis.suggested_fixes}

---
Generated by Hadron - Sentry Analyzer
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleExportMarkdown = () => {
    const markdown = `# Sentry Analysis: ${analysis.filename}

**Error Type:** ${analysis.error_type}
**Severity:** ${analysis.severity.toUpperCase()}
**Analyzed:** ${format(new Date(analysis.analyzed_at), "MMMM d, yyyy 'at' h:mm a")}
**Model:** ${analysis.ai_model}
${sentryData?.permalink ? `**Sentry:** [View Issue](${sentryData.permalink})` : ""}

## Root Cause

${currentRootCause}

${aiResult?.user_impact ? `## User Impact\n\n${aiResult.user_impact}\n` : ""}
${aiResult?.breadcrumb_analysis ? `## Breadcrumb Analysis\n\n${aiResult.breadcrumb_analysis}\n` : ""}
## Suggested Fixes

${analysis.suggested_fixes}

---

*Generated by Hadron - Sentry Analyzer*
`;

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${analysis.filename}-sentry-analysis.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Parse suggested fixes - try JSON array first, then treat as markdown block
  const suggestedFixesRaw = analysis.suggested_fixes;
  let suggestedFixesArray: string[] | null = null;
  if (typeof suggestedFixesRaw === "string") {
    try {
      const parsed = JSON.parse(suggestedFixesRaw);
      if (Array.isArray(parsed)) suggestedFixesArray = parsed;
    } catch {
      // Not JSON - will render as markdown block below
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 hover:bg-gray-700 rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to History
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyToClipboard}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy Report
              </>
            )}
          </button>
          <button
            onClick={handleExportMarkdown}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
          >
            <Download className="w-4 h-4" />
            Export Markdown
          </button>
          {jiraEnabled && (
            <button
              onClick={() => setShowJiraModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition"
              title="Create JIRA ticket from this analysis"
            >
              <Ticket className="w-4 h-4" />
              Create JIRA Ticket
            </button>
          )}
          {sentryData?.permalink && (
            <button
              onClick={() => open(sentryData.permalink!)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg transition"
            >
              <ExternalLink className="w-4 h-4" />
              View in Sentry
            </button>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2">{analysis.error_type || analysis.filename}</h2>
            <p className="text-gray-400 text-sm mb-3">{analysis.filename}</p>
            <div className="flex items-center gap-3 text-sm text-gray-400 flex-wrap">
              <span>
                {format(new Date(analysis.analyzed_at), "MMMM d, yyyy 'at' h:mm a")}
              </span>
              <span>|</span>
              <span>{analysis.ai_model}</span>
              <span>|</span>
              <span>${analysis.cost.toFixed(4)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`px-4 py-2 rounded-lg text-sm font-semibold border ${getSeverityColor(
                  analysis.severity
                )}`}
              >
                {analysis.severity.toUpperCase()}
              </span>
              <GoldBadge
                analysisId={analysis.id}
                isGold={isGold}
                onPromoted={() => setIsGold(true)}
              />
            </div>
            {analysis.confidence && (
              <span className="text-xs text-gray-500">
                Confidence: {analysis.confidence}
              </span>
            )}
          </div>
        </div>

        {/* Sentry Badge Row */}
        {sentryData && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400">
              <Shield className="w-3.5 h-3.5" />
              Sentry Issue
            </span>
            {sentryData.shortId && (
              <span className="font-mono text-gray-300">{sentryData.shortId}</span>
            )}
            {sentryData.platform && (
              <span className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
                {sentryData.platform}
              </span>
            )}
            {sentryData.level && (
              <span
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${getLevelColor(
                  sentryData.level
                )}`}
              >
                {sentryData.level}
              </span>
            )}
            {sentryData.count && (
              <span className="text-gray-400 text-xs">
                {parseInt(sentryData.count, 10).toLocaleString()} events
              </span>
            )}
            {sentryData.userCount != null && sentryData.userCount > 0 && (
              <span className="text-gray-400 text-xs flex items-center gap-1">
                <Users className="w-3 h-3" />
                {sentryData.userCount} users
              </span>
            )}
          </div>
        )}

        {/* Pattern badges */}
        {sentryData && sentryData.detectedPatterns.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Detected:</span>
            {sentryData.detectedPatterns.map((p, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${getPatternBadgeColor(
                  p.patternType
                )}`}
                title={p.evidence?.join("; ") || ""}
              >
                {getPatternLabel(p.patternType)}
                <span className="opacity-60">
                  {Math.round(p.confidence * 100)}%
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="flex gap-1 overflow-x-auto pb-px" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "patterns" &&
                sentryData &&
                sentryData.detectedPatterns.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-gray-700 text-gray-300 rounded-full">
                    {sentryData.detectedPatterns.length}
                  </span>
                )}
              {tab.id === "breadcrumbs" &&
                sentryData &&
                sentryData.breadcrumbs.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-gray-700 text-gray-300 rounded-full">
                    {sentryData.breadcrumbs.length}
                  </span>
                )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* ============ Overview Tab ============ */}
        {activeTab === "overview" && (
          <>
            {/* User Impact */}
            <SentryUserImpact
              userImpact={aiResult?.user_impact}
              eventCount={sentryData?.count}
              userCount={sentryData?.userCount}
              firstSeen={sentryData?.firstSeen}
              lastSeen={sentryData?.lastSeen}
            />

            {/* Root Cause Analysis — matching WhatsOn layout */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                  <h3 className="text-lg font-semibold">Root Cause Analysis</h3>
                </div>
                <FeedbackButtons
                  analysisId={analysis.id}
                  fieldName="rootCause"
                  currentValue={currentRootCause}
                />
              </div>

              <div className="space-y-4">
                {/* Technical Explanation */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-400 mb-2">Technical Explanation</h4>
                  <div className="prose prose-sm prose-invert max-w-none prose-headings:text-gray-200 prose-h2:text-lg prose-h2:font-semibold prose-h2:mt-6 prose-h2:mb-3 prose-h2:border-b prose-h2:border-gray-700 prose-h2:pb-2 prose-h3:text-base prose-h3:font-medium prose-p:my-2 prose-p:text-gray-300 prose-strong:text-gray-200 prose-code:bg-gray-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-gray-300 prose-hr:border-gray-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {currentRootCause}
                    </ReactMarkdown>
                  </div>
                  <div className="mt-2">
                    <InlineEditor
                      analysisId={analysis.id}
                      fieldName="rootCause"
                      value={currentRootCause}
                      onSave={(newValue) => setEditableRootCause(newValue)}
                    />
                  </div>
                </div>

                {/* Plain English / Error Message — blue box like WhatsOn */}
                {(aiResult?.error_message || analysis.error_message) && (
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <h4 className="text-sm font-semibold text-blue-400 mb-2">Plain English</h4>
                    <p className="text-gray-200">
                      {aiResult?.error_message || analysis.error_message}
                    </p>
                  </div>
                )}

                {/* Affected Component / Culprit grid — like WhatsOn method/module */}
                {(aiResult?.component || sentryData?.culprit) && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {aiResult?.component && (
                      <div>
                        <span className="text-gray-400">Affected Component:</span>
                        <code className="ml-2 px-2 py-1 bg-gray-900 rounded text-blue-400">
                          {aiResult.component}
                        </code>
                      </div>
                    )}
                    {sentryData?.culprit && (
                      <div>
                        <span className="text-gray-400">Culprit:</span>
                        <span className="ml-2 text-purple-400 font-mono">{sentryData.culprit}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Breadcrumb Analysis — yellow trigger box like WhatsOn */}
                {aiResult?.breadcrumb_analysis && (
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <span className="text-sm font-semibold text-yellow-400">Trigger Analysis: </span>
                    <span className="text-gray-200">{aiResult.breadcrumb_analysis}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Similar Historical Cases (RAG Citations) */}
            <CitationPanel
              query={`${analysis.error_type || ""} ${analysis.component || ""} ${analysis.stack_trace?.slice(0, 200) || ""}`}
              component={analysis.component}
              severity={analysis.severity?.toLowerCase()}
              onCitationClick={() => {}}
              defaultCollapsed={false}
            />

            {/* Suggested Fixes */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <Wrench className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold">Suggested Fixes</h3>
                {suggestedFixesArray && (
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-semibold">
                    {suggestedFixesArray.length}{" "}
                    {suggestedFixesArray.length === 1 ? "Fix" : "Fixes"}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {suggestedFixesArray ? (
                  suggestedFixesArray.map((fix, index) => (
                    <div key={index} className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1 prose prose-sm prose-invert max-w-none prose-p:my-1 prose-code:bg-gray-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {fix}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none prose-headings:text-gray-200 prose-h2:text-lg prose-h2:font-semibold prose-h2:mt-6 prose-h2:mb-3 prose-h3:text-base prose-h3:font-medium prose-p:my-2 prose-p:text-gray-300 prose-strong:text-gray-200 prose-code:bg-gray-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-blue-400 prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-gray-300 prose-hr:border-gray-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {String(suggestedFixesRaw)}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>

            {/* Feedback */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold mb-1">
                    How was this analysis?
                  </h3>
                  <p className="text-sm text-gray-400">
                    Your feedback helps improve future analyses
                  </p>
                </div>
                <StarRating analysisId={analysis.id} size="large" />
              </div>
            </div>
          </>
        )}

        {/* ============ Patterns Tab ============ */}
        {activeTab === "patterns" && (
          <SentryPatternCard
            patterns={sentryData?.detectedPatterns || []}
            aiPatternType={aiResult?.pattern_type}
            aiSeverity={aiResult?.severity}
            aiComponent={aiResult?.component}
            errorType={aiResult?.error_type}
          />
        )}

        {/* ============ Breadcrumbs Tab ============ */}
        {activeTab === "breadcrumbs" && (
          <SentryBreadcrumbTimeline
            breadcrumbs={sentryData?.breadcrumbs || []}
            breadcrumbAnalysis={aiResult?.breadcrumb_analysis}
          />
        )}

        {/* ============ Stack Trace Tab ============ */}
        {activeTab === "stacktrace" && (
          <SentryExceptionChain
            exceptions={sentryData?.exceptions || []}
            rawStackTrace={analysis.stack_trace}
          />
        )}

        {/* ============ Context Tab ============ */}
        {activeTab === "context" && (
          <SentryRuntimeContext
            contexts={sentryData?.contexts}
            tags={sentryData?.tags}
          />
        )}

        {/* ============ Metadata Tab ============ */}
        {activeTab === "metadata" && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Analysis Metadata</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Analysis ID:</span>
                <span className="ml-2 font-mono">{analysis.id}</span>
              </div>
              <div>
                <span className="text-gray-400">Tokens Used:</span>
                <span className="ml-2">
                  {analysis.tokens_used.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Model:</span>
                <span className="ml-2">{analysis.ai_model}</span>
              </div>
              {analysis.ai_provider && (
                <div>
                  <span className="text-gray-400">Provider:</span>
                  <span className="ml-2 capitalize">{analysis.ai_provider}</span>
                </div>
              )}
              {analysis.confidence && (
                <div>
                  <span className="text-gray-400">Confidence:</span>
                  <span
                    className={`ml-2 font-semibold ${
                      analysis.confidence === "HIGH"
                        ? "text-green-400"
                        : analysis.confidence === "MEDIUM"
                        ? "text-yellow-400"
                        : "text-orange-400"
                    }`}
                  >
                    {analysis.confidence}
                  </span>
                </div>
              )}
              <div>
                <span className="text-gray-400">Cost:</span>
                <span className="ml-2 text-green-400 font-semibold">
                  ${analysis.cost.toFixed(4)}
                </span>
              </div>
              {analysis.analysis_duration_ms && (
                <div>
                  <span className="text-gray-400">Duration:</span>
                  <span className="ml-2 text-blue-400 font-semibold">
                    {(analysis.analysis_duration_ms / 1000).toFixed(2)}s
                  </span>
                </div>
              )}
              <div>
                <span className="text-gray-400">File Size:</span>
                <span className="ml-2">
                  {analysis.file_size_kb.toFixed(2)} KB
                </span>
              </div>
              <div>
                <span className="text-gray-400">Truncated:</span>
                <span className="ml-2">
                  {analysis.was_truncated ? "Yes" : "No"}
                </span>
              </div>
              {analysis.view_count > 0 && (
                <div>
                  <span className="text-gray-400">Views:</span>
                  <span className="ml-2">{analysis.view_count}</span>
                </div>
              )}
              {sentryData?.issueId && (
                <div>
                  <span className="text-gray-400">Sentry Issue ID:</span>
                  <span className="ml-2 font-mono">{sentryData.issueId}</span>
                </div>
              )}
              {sentryData?.culprit && (
                <div className="col-span-2">
                  <span className="text-gray-400">Culprit:</span>
                  <span className="ml-2 font-mono text-gray-300">
                    {sentryData.culprit}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* JIRA Ticket Modal */}
      <JiraTicketModal
        analysis={analysis}
        isOpen={showJiraModal}
        onClose={() => setShowJiraModal(false)}
      />
    </div>
  );
}

// Pattern badge helpers
function getPatternBadgeColor(patternType: string): string {
  switch (patternType) {
    case "deadlock":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "n_plus_one":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "memory_leak":
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "unhandled_promise":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function getPatternLabel(patternType: string): string {
  switch (patternType) {
    case "deadlock":
      return "Deadlock";
    case "n_plus_one":
      return "N+1 Query";
    case "memory_leak":
      return "Memory Leak";
    case "unhandled_promise":
      return "Unhandled Promise";
    default:
      return patternType;
  }
}
