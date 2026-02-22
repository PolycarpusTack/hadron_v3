import { useState, useCallback, useEffect } from "react";
import { Upload, FileText, Loader2, ClipboardPaste, X, Clock, AlertCircle, ChevronRight, RotateCcw, Eye } from "lucide-react";
import Button from "./ui/Button";
import Modal from "./ui/Modal";
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

function getSeverityDotClasses(severity: string): string {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "bg-red-500 shadow-[0_0_6px_theme(colors.red.500)]";
    case "HIGH":
      return "bg-orange-500";
    case "MEDIUM":
      return "bg-yellow-500";
    case "LOW":
      return "bg-blue-500";
    default:
      return "bg-gray-500";
  }
}

function getSeverityBadgeClass(severity: string): string {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "hd-badge hd-badge-critical";
    case "HIGH":
      return "hd-badge hd-badge-high";
    case "MEDIUM":
      return "hd-badge hd-badge-medium";
    case "LOW":
      return "hd-badge hd-badge-low";
    default:
      return "hd-badge hd-badge-neutral";
  }
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
      const enforcedMode: AnalysisMode = analysisType === "comprehensive" ? "deep_scan" : "quick";

      if (paths.length > 1 && onBatchSelect) {
        onBatchSelect(paths, analysisType, enforcedMode);
      } else {
        // Single file fallback
        onFileSelect(paths[0], analysisType, enforcedMode);
      }
    } catch (error) {
      logger.error('File selection failed', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to select file. Please try again.");
    }
  }, [onFileSelect, onBatchSelect, isAnalyzing, analysisType]);

  const handlePasteLog = useCallback(async () => {
    if (isAnalyzing || !pastedContent.trim()) return;

    try {
      // Save pasted content to temp file
      const tempFilePath = await invoke<string>("save_pasted_log", { content: pastedContent });

      logger.info('Pasted log saved to temp file', { path: tempFilePath });

      // Close modal and analyze
      setShowPasteModal(false);
      setPastedContent("");
      const enforcedMode: AnalysisMode = analysisType === "comprehensive" ? "deep_scan" : "quick";
      onFileSelect(tempFilePath, analysisType, enforcedMode);
    } catch (error) {
      logger.error('Failed to save pasted log', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to process pasted content. Please try again.");
    }
  }, [pastedContent, onFileSelect, isAnalyzing, analysisType]);

  const latestAnalysis = recentAnalyses.length > 0 ? recentAnalyses[0] : null;
  const recentThree = recentAnalyses.slice(0, 3);

  return (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-12 gap-4">
        {/* Left panel - Crash Ingestion */}
        <section className="hd-panel col-span-7 p-5">
          <h2 className="text-lg font-bold mb-4" style={{ color: 'var(--hd-text)' }}>
            Crash Ingestion
          </h2>

          {isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-emerald-400 mb-4 animate-spin" />
              <p className="text-base font-semibold mb-4" style={{ color: 'var(--hd-text)' }}>
                Analyzing crash log...
              </p>
              <div className="w-full max-w-md">
                <AnalysisProgressBar isAnalyzing={isAnalyzing} />
              </div>
            </div>
          ) : (
            <>
              {/* Dropzone */}
              <div
                role="region"
                aria-label="File upload area"
                aria-busy={isAnalyzing}
                className={`hd-dropzone text-center ${isDragging ? "hd-dropzone-active" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center justify-center">
                  <span className="text-4xl mb-3" role="img" aria-label="file">
                    📄
                  </span>
                  <p className="text-base font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>
                    Drop crash logs here
                  </p>
                  <p className="text-sm mb-4" style={{ color: 'var(--hd-text-muted)' }}>
                    or select files to analyze
                  </p>
                  <p className="text-xs mb-5" style={{ color: 'var(--hd-text-dim)' }}>
                    Supports .txt and .log files up to 5MB
                  </p>
                  <div className="flex gap-3">
                    <Button
                      onClick={handleSelectFile}
                      disabled={isAnalyzing}
                      variant="primary"
                      size="md"
                      icon={<Upload />}
                    >
                      Choose Files
                    </Button>
                    <Button
                      onClick={() => setShowPasteModal(true)}
                      disabled={isAnalyzing}
                      variant="ghost"
                      size="md"
                      icon={<ClipboardPaste />}
                    >
                      Paste Log
                    </Button>
                  </div>
                </div>
              </div>

              {/* Controls row: Analysis depth + Start button */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>
                    Analysis depth
                  </span>
                  <div className="hd-segmented">
                    <button
                      className={`hd-segmented-btn ${analysisType === "quick" ? "hd-segmented-btn-active" : ""}`}
                      onClick={() => { setAnalysisType("quick"); localStorage.setItem("analysis_default_type", "quick"); }}
                    >
                      Quick ~10s
                    </button>
                    <button
                      className={`hd-segmented-btn ${analysisType === "comprehensive" ? "hd-segmented-btn-active" : ""}`}
                      onClick={() => { setAnalysisType("comprehensive"); localStorage.setItem("analysis_default_type", "comprehensive"); }}
                    >
                      Comprehensive ~45s
                    </button>
                  </div>
                </div>
                <Button
                  onClick={handleSelectFile}
                  disabled={isAnalyzing}
                  variant="primary"
                  size="md"
                >
                  Start Analysis
                </Button>
              </div>
            </>
          )}
        </section>

        {/* Right sidebar */}
        <aside className="col-span-5 flex flex-col gap-3">
          {/* Quick Actions */}
          <div className="hd-panel p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>
              Quick Actions
            </h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  if (latestAnalysis && onOpenAnalysis) {
                    onOpenAnalysis(latestAnalysis);
                  }
                }}
                disabled={!latestAnalysis || !onOpenAnalysis}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.04]"
                style={{ color: 'var(--hd-text-muted)' }}
              >
                <Eye className="w-4 h-4 flex-shrink-0" />
                Open Last Analysis
                <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />
              </button>
              <button
                onClick={handleSelectFile}
                disabled={isAnalyzing}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.04]"
                style={{ color: 'var(--hd-text-muted)' }}
              >
                <RotateCcw className="w-4 h-4 flex-shrink-0" />
                Re-analyze Last File
                <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />
              </button>
              <button
                onClick={() => {
                  const critical = recentAnalyses.find(
                    (a) => a.severity.toUpperCase() === "CRITICAL" || a.severity.toUpperCase() === "HIGH"
                  );
                  if (critical && onOpenAnalysis) {
                    onOpenAnalysis(critical);
                  }
                }}
                disabled={!recentAnalyses.some(
                  (a) => a.severity.toUpperCase() === "CRITICAL" || a.severity.toUpperCase() === "HIGH"
                ) || !onOpenAnalysis}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.04]"
                style={{ color: 'var(--hd-text-muted)' }}
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                Review Critical Items
                <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />
              </button>
            </div>
          </div>

          {/* Latest Result */}
          <div className="hd-panel p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>
              Latest Result
            </h3>
            {loadingRecent ? (
              <div className="flex items-center gap-2 py-3">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--hd-text-dim)' }} />
                <span className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Loading...</span>
              </div>
            ) : latestAnalysis ? (
              <button
                onClick={() => onOpenAnalysis?.(latestAnalysis)}
                disabled={!onOpenAnalysis}
                className="w-full text-left disabled:cursor-default"
              >
                <div className="flex items-start gap-3">
                  <span className={getSeverityBadgeClass(latestAnalysis.severity)}>
                    {latestAnalysis.severity.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--hd-text)' }}>
                      {latestAnalysis.filename}
                    </p>
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--hd-text-muted)' }}>
                      {latestAnalysis.error_type || latestAnalysis.root_cause}
                    </p>
                    {latestAnalysis.suggested_fixes && (
                      <p className="text-xs mt-1.5 line-clamp-1" style={{ color: 'var(--hd-text-dim)' }}>
                        Fix: {typeof latestAnalysis.suggested_fixes === "string"
                          ? latestAnalysis.suggested_fixes.split("\n")[0]
                          : latestAnalysis.suggested_fixes[0]}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ) : (
              <div className="text-center py-4">
                <FileText className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--hd-text-dim)' }} />
                <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>No analyses yet</p>
              </div>
            )}
          </div>

          {/* Recent Analyses */}
          <div className="hd-panel p-4 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5" style={{ color: 'var(--hd-text-dim)' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>
                Recent Analyses
              </h3>
            </div>
            {loadingRecent ? (
              <div className="flex items-center gap-2 py-3">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--hd-text-dim)' }} />
                <span className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Loading...</span>
              </div>
            ) : recentThree.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                  No analyses yet. Upload a crash log to get started.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {recentThree.map((analysis) => (
                  <button
                    key={analysis.id}
                    onClick={() => onOpenAnalysis?.(analysis)}
                    disabled={!onOpenAnalysis}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-default"
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${getSeverityDotClasses(analysis.severity)}`}
                    />
                    <span className="flex-1 min-w-0 text-sm truncate" style={{ color: 'var(--hd-text)' }}>
                      {analysis.filename}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--hd-text-dim)' }}>
                      {formatDistanceToNow(new Date(analysis.analyzed_at), { addSuffix: true })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Paste Log Modal */}
      <Modal isOpen={showPasteModal} onClose={() => { setShowPasteModal(false); setPastedContent(""); }}>
          <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
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
              <Button
                onClick={() => {
                  setShowPasteModal(false);
                  setPastedContent("");
                }}
                variant="secondary"
                size="lg"
                className="font-semibold"
              >
                Cancel
              </Button>
              <Button
                onClick={handlePasteLog}
                disabled={!pastedContent.trim() || isAnalyzing}
                variant="accent"
                size="lg"
                icon={<ClipboardPaste />}
                className="font-semibold"
              >
                Analyze Pasted Log
              </Button>
            </div>
          </div>
      </Modal>
    </div>
  );
}
