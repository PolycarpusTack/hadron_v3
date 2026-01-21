import { useState, useCallback, useEffect } from "react";
import { Upload, FileText, Loader2, ClipboardPaste, X, Clock, AlertTriangle, AlertCircle, Info, Zap, Search, Settings2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import logger from "../services/logger";
import type { Analysis, AnalysisMode } from "../services/api";
import { formatDistanceToNow } from "date-fns";
import AnalysisProgressBar from "./AnalysisProgressBar";

interface FileDropZoneProps {
  onFileSelect: (filePath: string, analysisType: string, analysisMode: AnalysisMode) => void;
  onBatchSelect?: (filePaths: string[], analysisType: string, analysisMode: AnalysisMode) => void;
  onOpenAnalysis?: (analysis: Analysis) => void;
  isAnalyzing: boolean;
}

export default function FileDropZone({ onFileSelect, onBatchSelect, onOpenAnalysis, isAnalyzing }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [analysisType, setAnalysisType] = useState<"comprehensive" | "quick">(() => {
    const stored = localStorage.getItem("analysis_default_type");
    // Migrate old values to new types
    if (stored === "whatson" || stored === "complete" || stored === "specialized" || stored === "comprehensive") {
      return "comprehensive";
    }
    if (stored === "quick") {
      return "quick";
    }
    return "comprehensive";
  });
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>((localStorage.getItem("analysis_default_mode") as AnalysisMode) || "auto");
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedContent, setPastedContent] = useState("");
  const [recentAnalyses, setRecentAnalyses] = useState<Analysis[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Fetch recent analyses on mount
  useEffect(() => {
    async function fetchRecent() {
      try {
        const recent = await invoke<Analysis[]>("get_recent", { limit: 5 });
        setRecentAnalyses(recent);
      } catch (error) {
        logger.error("Failed to fetch recent analyses", { error });
      } finally {
        setLoadingRecent(false);
      }
    }
    fetchRecent();
  }, []);

  // Get severity icon and color
  const getSeverityIcon = (severity: string) => {
    switch (severity.toUpperCase()) {
      case "CRITICAL":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "HIGH":
        return <AlertTriangle className="w-5 h-5 text-orange-400" />;
      case "MEDIUM":
        return <Info className="w-5 h-5 text-yellow-400" />;
      default:
        return <FileText className="w-5 h-5 text-blue-400" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toUpperCase()) {
      case "CRITICAL":
        return "text-red-400";
      case "HIGH":
        return "text-orange-400";
      case "MEDIUM":
        return "text-yellow-400";
      default:
        return "text-blue-400";
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Show message to use file picker instead
    alert("Please use the file picker button below instead of drag & drop.\n\nThis ensures proper file path handling in Tauri.");
  }, []);

  const handleSelectFile = useCallback(async () => {
    if (isAnalyzing) return;

    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Crash Logs",
            extensions: ["txt", "log"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];

      if (paths.length === 0) {
        return;
      }

      // If a batch handler is provided and we have multiple files, run batch
      if (paths.length > 1 && onBatchSelect) {
        onBatchSelect(paths, analysisType, analysisMode);
      } else {
        // Single file fallback
        onFileSelect(paths[0], analysisType, analysisMode);
      }
    } catch (error) {
      logger.error('File selection failed', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to select file. Please try again.");
    }
  }, [onFileSelect, onBatchSelect, isAnalyzing, analysisType, analysisMode]);

  const handlePasteLog = useCallback(async () => {
    if (isAnalyzing || !pastedContent.trim()) return;

    try {
      // Save pasted content to temp file
      const tempFilePath = await invoke<string>("save_pasted_log", { content: pastedContent });

      logger.info('Pasted log saved to temp file', { path: tempFilePath });

      // Close modal and analyze
      setShowPasteModal(false);
      setPastedContent("");
      onFileSelect(tempFilePath, analysisType, analysisMode);
    } catch (error) {
      logger.error('Failed to save pasted log', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to process pasted content. Please try again.");
    }
  }, [pastedContent, onFileSelect, isAnalyzing, analysisType, analysisMode]);

  return (
    <div className="w-full space-y-6">
      {/* Analysis Type Selection */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Select Analysis Type</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Comprehensive Analysis */}
          <label
            className={`flex flex-col p-5 border-2 rounded-xl cursor-pointer transition-all ${
              analysisType === "comprehensive"
                ? "border-emerald-500 bg-emerald-900/20 shadow-lg shadow-emerald-500/10"
                : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/30"
            } ${isAnalyzing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name="analysisType"
              value="comprehensive"
              checked={analysisType === "comprehensive"}
              onChange={() => {
                setAnalysisType("comprehensive");
                localStorage.setItem("analysis_default_type", "comprehensive");
              }}
              disabled={isAnalyzing}
              className="sr-only"
            />
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-bold text-lg text-emerald-400">Comprehensive</div>
                <div className="text-xs text-gray-500">Full analysis with all context</div>
              </div>
              <div className="flex flex-col items-end text-xs">
                <span className="text-emerald-400 font-medium">~$0.05-0.15</span>
                <span className="text-gray-500">~30-60s</span>
              </div>
            </div>
            <div className="text-sm text-gray-400 mb-3">
              Deep analysis with domain knowledge, structured JSON output, 7 detailed tabs covering all aspects of the crash.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Root Cause", "Impact", "Testing", "Stack Trace", "Context", "Environment", "Database", "Memory"].map((feature) => (
                <span key={feature} className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-300 rounded">
                  {feature}
                </span>
              ))}
            </div>
          </label>

          {/* Quick Analysis */}
          <label
            className={`flex flex-col p-5 border-2 rounded-xl cursor-pointer transition-all ${
              analysisType === "quick"
                ? "border-cyan-500 bg-cyan-900/20 shadow-lg shadow-cyan-500/10"
                : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/30"
            } ${isAnalyzing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name="analysisType"
              value="quick"
              checked={analysisType === "quick"}
              onChange={() => {
                setAnalysisType("quick");
                localStorage.setItem("analysis_default_type", "quick");
              }}
              disabled={isAnalyzing}
              className="sr-only"
            />
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-bold text-lg text-cyan-400">Quick</div>
                <div className="text-xs text-gray-500">Fast root cause identification</div>
              </div>
              <div className="flex flex-col items-end text-xs">
                <span className="text-cyan-400 font-medium">~$0.01-0.03</span>
                <span className="text-gray-500">~10-20s</span>
              </div>
            </div>
            <div className="text-sm text-gray-400 mb-3">
              Rapid analysis focused on identifying the problem and providing actionable solutions. Best for quick triage.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Root Cause", "Workaround", "Solution", "Explanation"].map((feature) => (
                <span key={feature} className="px-2 py-0.5 text-xs bg-cyan-500/20 text-cyan-300 rounded">
                  {feature}
                </span>
              ))}
            </div>
          </label>
        </div>
      </div>

      {/* Analysis Mode Selection - Token-Safe */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="w-4 h-4 text-gray-400" />
          <h4 className="text-sm font-semibold text-gray-300">Analysis Mode</h4>
          <span className="text-xs px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded">Token-Safe</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setAnalysisMode("auto");
              localStorage.setItem("analysis_default_mode", "auto");
            }}
            disabled={isAnalyzing}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition text-sm ${
              analysisMode === "auto"
                ? "bg-cyan-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            } ${isAnalyzing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Settings2 className="w-4 h-4" />
            Auto
          </button>
          <button
            onClick={() => {
              setAnalysisMode("quick");
              localStorage.setItem("analysis_default_mode", "quick");
            }}
            disabled={isAnalyzing}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition text-sm ${
              analysisMode === "quick"
                ? "bg-green-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            } ${isAnalyzing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Zap className="w-4 h-4" />
            Quick
          </button>
          <button
            onClick={() => {
              setAnalysisMode("deep_scan");
              localStorage.setItem("analysis_default_mode", "deep_scan");
            }}
            disabled={isAnalyzing}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition text-sm ${
              analysisMode === "deep_scan"
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            } ${isAnalyzing ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Search className="w-4 h-4" />
            Deep Scan
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {analysisMode === "auto" && "Automatically selects the best mode based on file size. Recommended for most use cases."}
          {analysisMode === "quick" && "Fast analysis using evidence extraction. Best for small to medium files (<100KB)."}
          {analysisMode === "deep_scan" && "Map-reduce chunked analysis for very large files. May take longer but provides complete coverage."}
        </p>
      </div>

      {/* Drop Zone */}
      <div
        role="region"
        aria-label="File upload area"
        aria-busy={isAnalyzing}
        className={`
          relative border-2 border-dashed rounded-lg p-12 transition-all
          ${isDragging
            ? "border-blue-500 bg-blue-500/10 scale-105"
            : "border-gray-600 hover:border-gray-500"
          }
          ${isAnalyzing ? "opacity-50 pointer-events-none" : ""}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center">
          {isAnalyzing ? (
            <div className="w-full max-w-md">
              <Loader2 className="w-12 h-12 text-blue-400 mb-4 animate-spin mx-auto" />
              <p className="text-xl font-semibold mb-4 text-center">
                Analyzing crash log...
              </p>
              <AnalysisProgressBar isAnalyzing={isAnalyzing} />
            </div>
          ) : (
            <>
              <Upload className="w-16 h-16 text-gray-400 mb-4" />
              <p className="text-xl font-semibold mb-2">
                Select one or more crash log files
              </p>
              <p className="text-gray-400 mb-6">
                Click the button below to browse
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleSelectFile}
                  disabled={isAnalyzing}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Choose File
                </button>
                <button
                  onClick={() => setShowPasteModal(true)}
                  disabled={isAnalyzing}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors flex items-center gap-2"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  Paste Log Text
                </button>
              </div>
              <p className="text-gray-500 text-sm mt-4">
                Supports .txt and .log files up to 5MB or paste log content directly
              </p>
            </>
          )}
        </div>
      </div>

      {/* Recent Analyses Preview */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-300">
            Recent Analyses
          </h3>
        </div>
        <div className="space-y-2">
          {loadingRecent ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              <span className="ml-2 text-gray-400 text-sm">Loading recent analyses...</span>
            </div>
          ) : recentAnalyses.length === 0 ? (
            <div className="text-center p-4 text-gray-500">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No analyses yet. Upload a crash log to get started.</p>
            </div>
          ) : (
            recentAnalyses.map((analysis) => (
              <button
                key={analysis.id}
                onClick={() => onOpenAnalysis?.(analysis)}
                disabled={!onOpenAnalysis}
                className="w-full flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg hover:bg-gray-700/70 transition text-left disabled:opacity-50 disabled:cursor-default"
              >
                {getSeverityIcon(analysis.severity)}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{analysis.filename}</p>
                  <p className="text-sm text-gray-400">
                    <span className={getSeverityColor(analysis.severity)}>{analysis.severity}</span>
                    {" • "}
                    {formatDistanceToNow(new Date(analysis.analyzed_at), { addSuffix: true })}
                  </p>
                </div>
                <span className="text-xs text-gray-500 px-2 py-1 bg-gray-800 rounded">
                  {analysis.analysis_type || "complete"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Paste Log Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="paste-modal-title">
          <div className="bg-gray-800 rounded-lg shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-700">
              <div className="flex items-center gap-3">
                <ClipboardPaste className="w-6 h-6 text-purple-400" />
                <h2 id="paste-modal-title" className="text-2xl font-bold">Paste Log Content</h2>
              </div>
              <button
                onClick={() => {
                  setShowPasteModal(false);
                  setPastedContent("");
                }}
                className="p-2 hover:bg-gray-700 rounded-lg transition"
                aria-label="Close paste dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 flex-1 overflow-y-auto">
              <p className="text-gray-400 mb-4">
                Paste your crash log content below. The text will be saved to a temporary file for analysis.
              </p>
              <textarea
                value={pastedContent}
                onChange={(e) => setPastedContent(e.target.value)}
                placeholder="Paste your crash log here..."
                className="w-full h-64 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 font-mono text-sm focus:outline-none focus:border-purple-500 resize-none"
                autoFocus
                aria-label="Crash log content"
              />
              <p className="text-gray-500 text-sm mt-2">
                {pastedContent.length} characters • {pastedContent.split('\n').length} lines
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-gray-700">
              <button
                onClick={() => {
                  setShowPasteModal(false);
                  setPastedContent("");
                }}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteLog}
                disabled={!pastedContent.trim() || isAnalyzing}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition flex items-center gap-2"
              >
                <ClipboardPaste className="w-4 h-4" />
                Analyze Pasted Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
