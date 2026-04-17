import { useState } from "react";
import { api, Analysis } from "../../services/api";
import { FileUploadZone } from "./FileUploadZone";
import { AnalysisResultCard } from "./AnalysisResultCard";
import { useToast } from "../Toast";

type AnalysisMode = "crash_log" | "code_review";

export function AnalyzeView() {
  const toast = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AnalysisMode>("crash_log");

  const handleFile = async (file: File) => {
    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const analysis = await api.uploadAndAnalyze(file);
      setResult(analysis);
      toast.success("Analysis complete");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handlePaste = async (content: string, filename: string) => {
    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const analysis = await api.analyzeContent(content, {
        filename,
        analysisMode: mode === "code_review" ? "code_review" : undefined,
      });
      setResult(analysis);
      toast.success("Analysis complete");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="mb-1 text-xl font-semibold text-white">
            {mode === "code_review" ? "Code Review" : "Analyze Crash Log"}
          </h2>
          <p className="text-sm text-slate-400">
            {mode === "code_review"
              ? "Paste code for AI-powered quality review"
              : "Upload or paste a crash log for AI-powered analysis"}
          </p>
        </div>
        <div className="flex gap-1 rounded-md bg-slate-800 p-0.5">
          <button
            onClick={() => setMode("crash_log")}
            className={`rounded px-3 py-1 text-sm transition-colors ${
              mode === "crash_log"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Crash Log
          </button>
          <button
            onClick={() => setMode("code_review")}
            className={`rounded px-3 py-1 text-sm transition-colors ${
              mode === "code_review"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Code Review
          </button>
        </div>
      </div>

      <FileUploadZone
        onFileSelected={handleFile}
        onContentPasted={handlePaste}
        disabled={analyzing}
      />

      {analyzing && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <span className="text-sm text-blue-300">
            Analyzing crash log...
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <AnalysisResultCard
          analysis={result}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
