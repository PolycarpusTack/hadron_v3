import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Upload, FileText, Loader2, ClipboardPaste, X, Clock, AlertCircle, ChevronRight, RotateCcw, Eye, ChevronDown, Shield } from "lucide-react";
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import { open } from "../lib/tauri-dialog-shim";
import { invoke } from "../lib/tauri-core-shim";
import { getCurrentWebview } from "../lib/tauri-window-shim";
import logger from "../services/logger";
import type { Analysis, AnalysisMode } from "../services/api";
import { formatDistanceToNow } from "date-fns";
import AnalysisProgressBar from "./AnalysisProgressBar";
import { AI_PROVIDERS, CURATED_MODELS, getCuratedModelsForProvider, getDefaultModelForProvider } from "../constants/providers";
import { STORAGE_KEYS, providerModelKey } from "../utils/config";
import { getModelSafeLimit, formatBytes } from "../utils/model-fit";

interface FileDropZoneProps {
  onFileSelect: (filePath: string, analysisType: string, analysisMode: AnalysisMode) => void;
  onBatchSelect?: (filePaths: string[], analysisType: string, analysisMode: AnalysisMode) => void;
  onOpenAnalysis?: (analysis: Analysis) => void;
  isAnalyzing: boolean;
  crashFile?: { path: string; name: string } | null;
  crashAnalysisResult?: { filename: string; severity: string } | null;
  onClearCrashAnalysisResult?: () => void;
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

export default function FileDropZone({ onFileSelect, onBatchSelect, onOpenAnalysis, isAnalyzing, crashFile, crashAnalysisResult, onClearCrashAnalysisResult }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dropRejectedMsg, setDropRejectedMsg] = useState<string | null>(null);
  const dropRejectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [analysisType, setAnalysisType] = useState<"comprehensive" | "quick">(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE);
    // Migrate old values to new types
    if (stored === "whatson" || stored === "complete" || stored === "specialized" || stored === "comprehensive") {
      return "comprehensive";
    }
    if (stored === "quick") {
      return "quick";
    }
    return "quick";
  });
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedContent, setPastedContent] = useState("");
  const [recentAnalyses, setRecentAnalyses] = useState<Analysis[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [showOptions, setShowOptions] = useState(false);
  const [provider, setProvider] = useState(() => localStorage.getItem(STORAGE_KEYS.AI_PROVIDER) || "openai");
  const [model, setModel] = useState(() => {
    const p = localStorage.getItem(STORAGE_KEYS.AI_PROVIDER) || "openai";
    return localStorage.getItem(STORAGE_KEYS.AI_MODEL) || getDefaultModelForProvider(p);
  });
  const [piiRedaction, setPiiRedaction] = useState(() => localStorage.getItem(STORAGE_KEYS.PII_REDACTION_ENABLED) === "true");

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

  // Refs for Tauri drag-drop callback (avoids stale closures)
  const analysisTypeRef = useRef(analysisType);
  const isAnalyzingRef = useRef(isAnalyzing);
  useEffect(() => { analysisTypeRef.current = analysisType; }, [analysisType]);
  useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);

  // Register Tauri native file-drop listener for real filesystem paths
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragging(true);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        if (isAnalyzingRef.current) return;

        const paths = event.payload.paths.filter((p) => {
          const lower = p.toLowerCase();
          return lower.endsWith(".txt") || lower.endsWith(".log");
        });

        if (paths.length === 0) {
          logger.warn("Dropped files have no supported extensions (.txt/.log)", { dropped: event.payload.paths });
          clearTimeout(dropRejectTimerRef.current);
          setDropRejectedMsg("Only .txt and .log files are supported");
          dropRejectTimerRef.current = setTimeout(() => setDropRejectedMsg(null), 4000);
          return;
        }

        const type = analysisTypeRef.current;
        const mode = type === "comprehensive" ? "deep_scan" : "quick";

        if (paths.length > 1 && onBatchSelect) {
          onBatchSelect(paths, type, mode as AnalysisMode);
        } else if (paths.length > 0) {
          onFileSelect(paths[0], type, mode as AnalysisMode);
        }
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => {
      cancelled = true;
      unlisten?.();
      clearTimeout(dropRejectTimerRef.current);
    };
  }, [onFileSelect, onBatchSelect]);

  // HTML5 handlers just prevent default browser behavior
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Actual file handling is done by Tauri's onDragDropEvent above
  }, []);

  const handleProviderChange = useCallback((newProvider: string) => {
    setProvider(newProvider);
    localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, newProvider);
    const savedModel = localStorage.getItem(providerModelKey(newProvider));
    const newModel = savedModel || getDefaultModelForProvider(newProvider);
    setModel(newModel);
    localStorage.setItem(STORAGE_KEYS.AI_MODEL, newModel);
  }, []);

  const handleModelChange = useCallback((newModel: string, currentProvider: string) => {
    setModel(newModel);
    localStorage.setItem(STORAGE_KEYS.AI_MODEL, newModel);
    localStorage.setItem(providerModelKey(currentProvider), newModel);
  }, []);

  const handlePiiToggle = useCallback(() => {
    setPiiRedaction(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.PII_REDACTION_ENABLED, String(next));
      return next;
    });
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
      clearTimeout(dropRejectTimerRef.current);
      setDropRejectedMsg("Failed to select file. Please try again.");
      dropRejectTimerRef.current = setTimeout(() => setDropRejectedMsg(null), 4000);
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
      clearTimeout(dropRejectTimerRef.current);
      setDropRejectedMsg("Failed to process pasted content. Please try again.");
      dropRejectTimerRef.current = setTimeout(() => setDropRejectedMsg(null), 4000);
    }
  }, [pastedContent, onFileSelect, isAnalyzing, analysisType]);

  // Memoized — limit + best-model suggestion for the current provider/model pair.
  // 560_000 bytes ≈ 200_000 tokens × 4 bytes × 0.7 safety — the threshold below which
  // logs are likely to be truncated.
  const fitWarningInfo = useMemo(() => {
    const limit = getModelSafeLimit(provider, model);
    if (limit >= 560_000) return null;
    const best = (CURATED_MODELS[provider] ?? [])
      .filter((m) => (m.context ?? 0) > 0)
      .sort((a, b) => (b.context ?? 0) - (a.context ?? 0))[0];
    return { limit, bestLabel: best?.label ?? "a larger-context model" };
  }, [provider, model]);

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
                Analyzing {crashFile?.name || 'crash log'}...
              </p>
              <div className="w-full max-w-md">
                <AnalysisProgressBar isAnalyzing={isAnalyzing} />
              </div>
            </div>
          ) : crashAnalysisResult ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="text-center mb-4">
                <p className="text-base font-semibold" style={{ color: 'var(--hd-text)' }}>
                  Analysis Complete
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--hd-text-muted)' }}>
                  {crashAnalysisResult.filename} — {crashAnalysisResult.severity} severity
                </p>
              </div>
              <Button
                onClick={onClearCrashAnalysisResult}
                variant="primary"
                size="md"
                icon={<RotateCcw />}
              >
                New Analysis
              </Button>
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
                    Recommended under 1MB · .txt and .log files
                  </p>
                  {dropRejectedMsg && (
                    <p className="text-xs mb-3 text-amber-400">{dropRejectedMsg}</p>
                  )}
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
                      onClick={() => { setAnalysisType("quick"); localStorage.setItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE, "quick"); }}
                    >
                      Quick ~10s
                    </button>
                    <button
                      className={`hd-segmented-btn ${analysisType === "comprehensive" ? "hd-segmented-btn-active" : ""}`}
                      onClick={() => { setAnalysisType("comprehensive"); localStorage.setItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE, "comprehensive"); }}
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

              {/* Analysis Options — inline provider / model / PII controls */}
              <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowOptions(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', width: '100%', textAlign: 'left',
                    fontSize: '12px', color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none',
                    cursor: 'pointer', padding: '2px 0',
                  }}
                >
                  <ChevronDown style={{ width: 13, height: 13, transform: showOptions ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
                  <span>Analysis Options</span>
                  {!showOptions && (
                    <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.25)', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                      {AI_PROVIDERS.find(p => p.value === provider)?.label ?? provider}
                      {' · '}
                      {(() => { const m = model.split('/').pop() ?? model; return m.length > 22 ? m.slice(0, 22) + '…' : m; })()}
                      {piiRedaction ? ' · PII on' : ''}
                    </span>
                  )}
                </button>

                {showOptions && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Provider + Model */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '5px' }}>
                          Provider
                        </label>
                        <select
                          value={provider}
                          onChange={e => handleProviderChange(e.target.value)}
                          disabled={isAnalyzing}
                          style={{
                            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px', padding: '6px 8px', fontSize: '12px', color: 'rgba(255,255,255,0.85)',
                            cursor: isAnalyzing ? 'not-allowed' : 'pointer', outline: 'none',
                          }}
                        >
                          {AI_PROVIDERS.map(p => (
                            <option key={p.value} value={p.value} style={{ background: '#1a1a1e' }}>{p.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '5px' }}>
                          Model
                        </label>
                        <select
                          value={model}
                          onChange={e => handleModelChange(e.target.value, provider)}
                          disabled={isAnalyzing}
                          style={{
                            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px', padding: '6px 8px', fontSize: '12px', color: 'rgba(255,255,255,0.85)',
                            cursor: isAnalyzing ? 'not-allowed' : 'pointer', outline: 'none',
                          }}
                        >
                          {getCuratedModelsForProvider(provider).map(m => (
                            <option key={m.id} value={m.id} style={{ background: '#1a1a1e' }}>
                              {m.label}{m.context ? ` (${Math.round(m.context / 1000)}K)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Fit warning — shown when current model has < 200K context */}
                    {fitWarningInfo && (
                      <div style={{
                        background: "rgba(245,158,11,0.08)",
                        border: "1px solid rgba(245,158,11,0.25)",
                        borderRadius: "6px",
                        padding: "8px 10px",
                      }}>
                        <p style={{ fontSize: "11px", fontWeight: 600, color: "#f59e0b", margin: "0 0 2px" }}>
                          ⚠ File may be truncated
                        </p>
                        <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", margin: 0 }}>
                          Current model handles ~{formatBytes(fitWarningInfo.limit)}. For large logs, consider {fitWarningInfo.bestLabel}.
                        </p>
                      </div>
                    )}

                    {/* PII Redaction */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '8px 10px',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Shield style={{ width: 13, height: 13, color: piiRedaction ? '#10b981' : 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', margin: 0, lineHeight: '1.4' }}>PII Redaction</p>
                          <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', margin: 0, lineHeight: '1.4' }}>
                            Strip emails, IPs, and identifiers before sending to AI
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handlePiiToggle}
                        aria-label={piiRedaction ? 'Disable PII redaction' : 'Enable PII redaction'}
                        style={{
                          width: '36px', height: '20px', borderRadius: '10px', border: 'none',
                          cursor: 'pointer', background: piiRedaction ? '#10b981' : 'rgba(255,255,255,0.12)',
                          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: '2px',
                          left: piiRedaction ? '18px' : '2px',
                          width: '16px', height: '16px', borderRadius: '50%',
                          background: 'white', transition: 'left 0.15s', display: 'block',
                        }} />
                      </button>
                    </div>
                  </div>
                )}
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
