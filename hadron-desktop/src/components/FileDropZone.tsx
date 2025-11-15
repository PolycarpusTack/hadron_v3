import { useState, useCallback } from "react";
import { Upload, FileText, Loader2, ClipboardPaste, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import logger from "../services/logger";

interface FileDropZoneProps {
  onFileSelect: (filePath: string, analysisType: string) => void;
  onBatchSelect?: (filePaths: string[], analysisType: string) => void;
  isAnalyzing: boolean;
}

export default function FileDropZone({ onFileSelect, onBatchSelect, isAnalyzing }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [analysisType, setAnalysisType] = useState<"complete" | "specialized">((localStorage.getItem("analysis_default_type") as "complete" | "specialized") || "complete");
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedContent, setPastedContent] = useState("");

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
        onBatchSelect(paths, analysisType);
      } else {
        // Single file fallback
        onFileSelect(paths[0], analysisType);
      }
    } catch (error) {
      logger.error('File selection failed', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to select file. Please try again.");
    }
  }, [onFileSelect, isAnalyzing, analysisType]);

  const handlePasteLog = useCallback(async () => {
    if (isAnalyzing || !pastedContent.trim()) return;

    try {
      // Save pasted content to temp file
      const tempFilePath = await invoke<string>("save_pasted_log", { content: pastedContent });

      logger.info('Pasted log saved to temp file', { path: tempFilePath });

      // Close modal and analyze
      setShowPasteModal(false);
      setPastedContent("");
      onFileSelect(tempFilePath, analysisType);
    } catch (error) {
      logger.error('Failed to save pasted log', { error: error instanceof Error ? error.message : String(error) });
      alert("Failed to process pasted content. Please try again.");
    }
  }, [pastedContent, onFileSelect, isAnalyzing, analysisType]);

  return (
    <div className="w-full space-y-6">
      {/* Analysis Type Selection */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Select Analysis Type</h3>
        <div className="space-y-3">
          <label className="flex items-start gap-3 p-4 border border-gray-600 rounded-lg cursor-pointer hover:bg-gray-700/50 transition">
            <input
              type="radio"
              name="analysisType"
              value="complete"
              checked={analysisType === "complete"}
              onChange={() => setAnalysisType("complete")}
              disabled={isAnalyzing}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-blue-400">Complete Analysis</div>
              <div className="text-sm text-gray-400 mt-1">
                Comprehensive standalone analysis with 10 structured parts including error classification,
                root cause analysis, remediation steps (P0/P1/P2), reproduction steps, and monitoring recommendations.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 border border-gray-600 rounded-lg cursor-pointer hover:bg-gray-700/50 transition">
            <input
              type="radio"
              name="analysisType"
              value="specialized"
              checked={analysisType === "specialized"}
              onChange={() => setAnalysisType("specialized")}
              disabled={isAnalyzing}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-purple-400">Specialized Analyses Suite</div>
              <div className="text-sm text-gray-400 mt-1">
                Execute 8 focused analyses in sequence: Pattern Analysis, Recommendations, Memory Analysis,
                Database Analysis, Performance Analysis, Deep Root Cause Analysis, General Analysis, and Basic Analysis.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Drop Zone */}
      <div
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
            <>
              <Loader2 className="w-16 h-16 text-blue-400 mb-4 animate-spin" />
              <p className="text-xl font-semibold mb-2">
                Analyzing crash log...
              </p>
              <p className="text-gray-400">
                This may take 10-30 seconds
              </p>
            </>
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
        <h3 className="text-lg font-semibold mb-4 text-gray-300">
          Recent Analyses
        </h3>
        <div className="space-y-2">
          {/* Placeholder - will be replaced with actual history */}
          <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition cursor-pointer">
            <FileText className="w-5 h-5 text-red-400" />
            <div className="flex-1 text-left">
              <p className="font-medium">WCR_5-2_11-23-15.txt</p>
              <p className="text-sm text-gray-400">HIGH severity • 2 hours ago</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition cursor-pointer">
            <FileText className="w-5 h-5 text-yellow-400" />
            <div className="flex-1 text-left">
              <p className="font-medium">WCR_16-4_11-40-58.txt</p>
              <p className="text-sm text-gray-400">MEDIUM severity • Yesterday</p>
            </div>
          </div>
        </div>
      </div>

      {/* Paste Log Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-700">
              <div className="flex items-center gap-3">
                <ClipboardPaste className="w-6 h-6 text-purple-400" />
                <h2 className="text-2xl font-bold">Paste Log Content</h2>
              </div>
              <button
                onClick={() => {
                  setShowPasteModal(false);
                  setPastedContent("");
                }}
                className="p-2 hover:bg-gray-700 rounded-lg transition"
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
