/**
 * ComparisonView - Side-by-side comparison of two crash analyses
 * Used for regression analysis and fix verification
 */

import { useState, useEffect, useMemo, memo } from "react";
import { X, ChevronLeft, ChevronRight, Check, AlertTriangle, Minus } from "lucide-react";
import { format } from "date-fns";
import { getAnalysisById } from "../services/api";
import type { Analysis } from "../services/api";
import logger from "../services/logger";

interface ComparisonViewProps {
  leftId: number;
  rightId: number;
  onClose: () => void;
  onSwap?: () => void;
}

type DiffStatus = "same" | "changed" | "added" | "removed";

interface DiffSection {
  label: string;
  leftValue: string | null;
  rightValue: string | null;
  status: DiffStatus;
}

// Get severity badge colors
function getSeverityColor(severity: string): string {
  switch (severity?.toLowerCase()) {
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
}

// Calculate diff status
function getDiffStatus(left: string | null, right: string | null): DiffStatus {
  if (left === right) return "same";
  if (!left && right) return "added";
  if (left && !right) return "removed";
  return "changed";
}

// Diff status icon
function DiffIcon({ status }: { status: DiffStatus }) {
  switch (status) {
    case "same":
      return <Check className="w-4 h-4 text-green-400" />;
    case "changed":
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    case "added":
      return <span className="text-green-400 font-bold">+</span>;
    case "removed":
      return <Minus className="w-4 h-4 text-red-400" />;
  }
}

// Diff status label
function DiffLabel({ status }: { status: DiffStatus }) {
  switch (status) {
    case "same":
      return <span className="text-xs text-green-400">Same</span>;
    case "changed":
      return <span className="text-xs text-yellow-400">Changed</span>;
    case "added":
      return <span className="text-xs text-green-400">Added</span>;
    case "removed":
      return <span className="text-xs text-red-400">Removed</span>;
  }
}

export const ComparisonView = memo(function ComparisonView({
  leftId,
  rightId,
  onClose,
  onSwap,
}: ComparisonViewProps) {
  const [leftAnalysis, setLeftAnalysis] = useState<Analysis | null>(null);
  const [rightAnalysis, setRightAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStackTrace, setShowStackTrace] = useState(false);

  // Load both analyses
  useEffect(() => {
    const loadAnalyses = async () => {
      setLoading(true);
      setError(null);
      try {
        const [left, right] = await Promise.all([
          getAnalysisById(leftId),
          getAnalysisById(rightId),
        ]);
        setLeftAnalysis(left);
        setRightAnalysis(right);
      } catch (err) {
        logger.error("Failed to load analyses for comparison", { leftId, rightId, error: err });
        setError("Failed to load analyses");
      } finally {
        setLoading(false);
      }
    };

    loadAnalyses();
  }, [leftId, rightId]);

  // Calculate diff sections
  const diffSections: DiffSection[] = useMemo(() => {
    if (!leftAnalysis || !rightAnalysis) return [];

    return [
      {
        label: "Error Type",
        leftValue: leftAnalysis.error_type,
        rightValue: rightAnalysis.error_type,
        status: getDiffStatus(leftAnalysis.error_type, rightAnalysis.error_type),
      },
      {
        label: "Severity",
        leftValue: leftAnalysis.severity,
        rightValue: rightAnalysis.severity,
        status: getDiffStatus(leftAnalysis.severity, rightAnalysis.severity),
      },
      {
        label: "Component",
        leftValue: leftAnalysis.component || null,
        rightValue: rightAnalysis.component || null,
        status: getDiffStatus(leftAnalysis.component || null, rightAnalysis.component || null),
      },
      {
        label: "Root Cause",
        leftValue: leftAnalysis.root_cause,
        rightValue: rightAnalysis.root_cause,
        status: getDiffStatus(leftAnalysis.root_cause, rightAnalysis.root_cause),
      },
      {
        label: "Error Message",
        leftValue: leftAnalysis.error_message || null,
        rightValue: rightAnalysis.error_message || null,
        status: getDiffStatus(leftAnalysis.error_message || null, rightAnalysis.error_message || null),
      },
    ];
  }, [leftAnalysis, rightAnalysis]);

  // Summary of changes
  const changeSummary = useMemo(() => {
    const changed = diffSections.filter((s) => s.status === "changed").length;
    const same = diffSections.filter((s) => s.status === "same").length;
    return { changed, same, total: diffSections.length };
  }, [diffSections]);

  // Determine if this looks like a regression or fix
  const analysisVerdict = useMemo(() => {
    if (!leftAnalysis || !rightAnalysis) return null;

    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    const leftSev = severityOrder[leftAnalysis.severity.toLowerCase() as keyof typeof severityOrder] || 0;
    const rightSev = severityOrder[rightAnalysis.severity.toLowerCase() as keyof typeof severityOrder] || 0;

    if (rightSev < leftSev) {
      return { type: "improvement", message: "Severity reduced - possible fix applied" };
    } else if (rightSev > leftSev) {
      return { type: "regression", message: "Severity increased - possible regression" };
    } else if (changeSummary.changed === 0) {
      return { type: "same", message: "No significant changes detected" };
    }
    return { type: "different", message: `${changeSummary.changed} field(s) changed` };
  }, [leftAnalysis, rightAnalysis, changeSummary]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
        <div className="text-gray-400">Loading comparison...</div>
      </div>
    );
  }

  if (error || !leftAnalysis || !rightAnalysis) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
        <div className="bg-gray-800 p-6 rounded-lg max-w-md">
          <p className="text-red-400 mb-4">{error || "Failed to load analyses"}</p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600 transition"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 z-10">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <h2 className="text-xl font-bold">Compare Analyses</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            title="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Analysis Headers */}
        <div className="grid grid-cols-2 gap-6">
          {/* Left (Older) */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ChevronLeft className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-400">Older</span>
            </div>
            <h3 className="font-semibold text-lg truncate">{leftAnalysis.filename}</h3>
            <p className="text-sm text-gray-400">
              {format(new Date(leftAnalysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}
            </p>
            <span
              className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(
                leftAnalysis.severity
              )}`}
            >
              {leftAnalysis.severity}
            </span>
          </div>

          {/* Right (Newer) */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-gray-400">Newer</span>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
            <h3 className="font-semibold text-lg truncate">{rightAnalysis.filename}</h3>
            <p className="text-sm text-gray-400">
              {format(new Date(rightAnalysis.analyzed_at), "MMM d, yyyy 'at' h:mm a")}
            </p>
            <span
              className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold border ${getSeverityColor(
                rightAnalysis.severity
              )}`}
            >
              {rightAnalysis.severity}
            </span>
          </div>
        </div>

        {/* Verdict Banner */}
        {analysisVerdict && (
          <div
            className={`p-4 rounded-lg border ${
              analysisVerdict.type === "improvement"
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : analysisVerdict.type === "regression"
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : analysisVerdict.type === "same"
                ? "bg-gray-500/10 border-gray-500/30 text-gray-400"
                : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
            }`}
          >
            <div className="flex items-center gap-2">
              {analysisVerdict.type === "improvement" && <Check className="w-5 h-5" />}
              {analysisVerdict.type === "regression" && <AlertTriangle className="w-5 h-5" />}
              <span className="font-semibold">{analysisVerdict.message}</span>
            </div>
          </div>
        )}

        {/* Diff Sections */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-700 pb-2">
            Field Comparison
          </h3>

          {diffSections.map((section) => (
            <div
              key={section.label}
              className={`grid grid-cols-[200px_1fr_1fr] gap-4 p-4 rounded-lg border ${
                section.status === "same"
                  ? "bg-gray-800/30 border-gray-700"
                  : section.status === "changed"
                  ? "bg-yellow-500/5 border-yellow-500/20"
                  : section.status === "added"
                  ? "bg-green-500/5 border-green-500/20"
                  : "bg-red-500/5 border-red-500/20"
              }`}
            >
              {/* Label */}
              <div className="flex items-start gap-2">
                <DiffIcon status={section.status} />
                <div>
                  <div className="font-medium">{section.label}</div>
                  <DiffLabel status={section.status} />
                </div>
              </div>

              {/* Left Value */}
              <div className="text-sm">
                {section.leftValue ? (
                  <div
                    className={`p-2 rounded ${
                      section.status === "removed" || section.status === "changed"
                        ? "bg-red-500/10"
                        : "bg-gray-800"
                    }`}
                  >
                    {section.leftValue}
                  </div>
                ) : (
                  <div className="p-2 text-gray-500 italic">Not present</div>
                )}
              </div>

              {/* Right Value */}
              <div className="text-sm">
                {section.rightValue ? (
                  <div
                    className={`p-2 rounded ${
                      section.status === "added" || section.status === "changed"
                        ? "bg-green-500/10"
                        : "bg-gray-800"
                    }`}
                  >
                    {section.rightValue}
                  </div>
                ) : (
                  <div className="p-2 text-gray-500 italic">Not present</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Suggested Fixes Comparison */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-700 pb-2">
            Suggested Fixes
          </h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <h4 className="text-sm font-semibold text-gray-400 mb-2">Older Analysis</h4>
              <div className="text-sm whitespace-pre-wrap">{leftAnalysis.suggested_fixes}</div>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
              <h4 className="text-sm font-semibold text-gray-400 mb-2">Newer Analysis</h4>
              <div className="text-sm whitespace-pre-wrap">{rightAnalysis.suggested_fixes}</div>
            </div>
          </div>
        </div>

        {/* Stack Trace Toggle */}
        {(leftAnalysis.stack_trace || rightAnalysis.stack_trace) && (
          <div className="space-y-4">
            <button
              onClick={() => setShowStackTrace(!showStackTrace)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition"
            >
              {showStackTrace ? "Hide" : "Show"} Stack Traces
              <ChevronRight
                className={`w-4 h-4 transition-transform ${showStackTrace ? "rotate-90" : ""}`}
              />
            </button>

            {showStackTrace && (
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 max-h-96 overflow-auto">
                  <h4 className="text-sm font-semibold text-gray-400 mb-2 sticky top-0 bg-gray-900">
                    Older Stack Trace
                  </h4>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-gray-300">
                    {leftAnalysis.stack_trace || "No stack trace"}
                  </pre>
                </div>
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 max-h-96 overflow-auto">
                  <h4 className="text-sm font-semibold text-gray-400 mb-2 sticky top-0 bg-gray-900">
                    Newer Stack Trace
                  </h4>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-gray-300">
                    {rightAnalysis.stack_trace || "No stack trace"}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metadata Comparison */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold border-b border-gray-700 pb-2">
            Metadata
          </h3>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">File Size:</span>
                <span>{leftAnalysis.file_size_kb.toFixed(1)} KB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Cost:</span>
                <span>${leftAnalysis.cost.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Model:</span>
                <span>{leftAnalysis.ai_model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Analysis Type:</span>
                <span className="capitalize">{leftAnalysis.analysis_type}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">File Size:</span>
                <span>{rightAnalysis.file_size_kb.toFixed(1)} KB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Cost:</span>
                <span>${rightAnalysis.cost.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Model:</span>
                <span>{rightAnalysis.ai_model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Analysis Type:</span>
                <span className="capitalize">{rightAnalysis.analysis_type}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-6 border-t border-gray-700">
          {onSwap && (
            <button
              onClick={onSwap}
              className="px-4 py-2 text-gray-400 hover:text-white transition"
            >
              Swap Left/Right
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

export default ComparisonView;
