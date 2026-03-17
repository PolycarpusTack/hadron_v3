import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  BarChart3,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Database,
  RefreshCw,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import { exportGoldAnswersJsonl } from "../services/gold-answers";
import { exportSummariesBundle } from "../services/summaries";
import { exportGoldJsonl } from "../services/api";
import { save as tauriSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

interface DashboardStats {
  scanDay: number;
  scanWeek: number;
  scanMonth: number;
  scanTotal: number;
  severityCritical: number;
  severityHigh: number;
  severityMedium: number;
  severityLow: number;
  goldPending: number;
  goldVerified: number;
  goldRejected: number;
  goldTotal: number;
}

interface IntelligenceDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

type Period = "day" | "week" | "month";
type View = "overview" | "review-queue";

export default function IntelligenceDashboard({ isOpen, onClose }: IntelligenceDashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>("week");
  const [view, setView] = useState<View>("overview");
  const [isExportingGold, setIsExportingGold] = useState(false);
  const [isExportingRag, setIsExportingRag] = useState(false);
  const [isExportingFineTune, setIsExportingFineTune] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<DashboardStats>("get_dashboard_stats");
      setStats(data);
    } catch (e) {
      console.error("Failed to load dashboard stats:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadStats();
      setView("overview");
    }
  }, [isOpen, loadStats]);

  const scanCount = stats
    ? period === "day" ? stats.scanDay
    : period === "week" ? stats.scanWeek
    : stats.scanMonth
    : 0;

  const severityTotal = stats
    ? stats.severityCritical + stats.severityHigh + stats.severityMedium + stats.severityLow
    : 0;

  const handleExportGold = async () => {
    setIsExportingGold(true);
    setExportMsg(null);
    try {
      const jsonl = await exportGoldAnswersJsonl({});
      const filePath = await tauriSave({
        defaultPath: `gold-answers-${new Date().toISOString().split("T")[0]}.jsonl`,
        filters: [{ name: "JSONL", extensions: ["jsonl"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, jsonl);
        setExportMsg("Gold answers exported");
      }
    } catch (e) {
      setExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExportingGold(false);
      setTimeout(() => setExportMsg(null), 4000);
    }
  };

  const handleExportRag = async () => {
    setIsExportingRag(true);
    setExportMsg(null);
    try {
      const bundle = await exportSummariesBundle({});
      const filePath = await tauriSave({
        defaultPath: `summaries-rag-${new Date().toISOString().split("T")[0]}.jsonl`,
        filters: [{ name: "JSONL", extensions: ["jsonl"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, bundle);
        setExportMsg("RAG summaries exported");
      }
    } catch (e) {
      setExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExportingRag(false);
      setTimeout(() => setExportMsg(null), 4000);
    }
  };

  const handleExportFineTune = async () => {
    setIsExportingFineTune(true);
    setExportMsg(null);
    try {
      const result = await exportGoldJsonl();
      if (result.totalExported === 0) {
        setExportMsg("No verified gold analyses to export");
        return;
      }
      const filePath = await tauriSave({
        defaultPath: `hadron-finetune-${new Date().toISOString().split("T")[0]}.jsonl`,
        filters: [{ name: "JSONL", extensions: ["jsonl"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, result.jsonlContent);
        setExportMsg(`Exported ${result.totalExported} gold analyses for fine-tuning`);
      }
    } catch (e) {
      setExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExportingFineTune(false);
      setTimeout(() => setExportMsg(null), 4000);
    }
  };

  const handleReviewQueueClose = () => {
    setView("overview");
    // Refresh stats after reviewing
    loadStats();
  };

  const hasPending = (stats?.goldPending ?? 0) > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth={view === "review-queue" ? "max-w-6xl" : "max-w-2xl"}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: 'var(--hd-surface)', border: '1px solid var(--hd-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--hd-border)' }}>
          <div className="flex items-center gap-3">
            {view === "review-queue" && (
              <button
                onClick={handleReviewQueueClose}
                className="p-1 rounded-lg transition hover:bg-white/5 mr-1"
                style={{ color: 'var(--hd-text-muted)' }}
                title="Back to overview"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <BarChart3 className="w-5 h-5" style={{ color: 'var(--hd-accent)' }} />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--hd-text)' }}>
              {view === "overview" ? "Intelligence Dashboard" : "Gold Review Queue"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {view === "overview" && (
              <button
                onClick={loadStats}
                disabled={loading}
                className="p-1.5 rounded-lg transition hover:bg-white/5"
                style={{ color: 'var(--hd-text-muted)' }}
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition hover:bg-white/5"
              style={{ color: 'var(--hd-text-muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {view === "overview" ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">

            {/* ── Scan Activity ── */}
            <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--hd-border-subtle)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4" style={{ color: 'var(--hd-accent)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--hd-text)' }}>Scan Activity</span>
                </div>
                {/* Period toggle */}
                <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--hd-border-subtle)' }}>
                  {(["day", "week", "month"] as Period[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className="px-3 py-1 text-xs font-medium transition"
                      style={{
                        background: period === p ? 'var(--hd-accent)' : 'transparent',
                        color: period === p ? '#fff' : 'var(--hd-text-muted)',
                      }}
                    >
                      {p === "day" ? "24h" : p === "week" ? "7d" : "30d"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Big number */}
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-bold tabular-nums" style={{ color: 'var(--hd-text)' }}>
                  {loading ? "..." : scanCount}
                </span>
                <span className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>
                  scans {period === "day" ? "today" : period === "week" ? "this week" : "this month"}
                </span>
                <span className="ml-auto text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                  {stats?.scanTotal ?? 0} total
                </span>
              </div>

              {/* Severity bar */}
              {stats && severityTotal > 0 && (
                <div>
                  <div className="flex gap-0.5 h-2.5 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {stats.severityCritical > 0 && (
                      <div className="bg-red-500 rounded-l-full" style={{ width: `${(stats.severityCritical / severityTotal) * 100}%` }} title={`Critical: ${stats.severityCritical}`} />
                    )}
                    {stats.severityHigh > 0 && (
                      <div className="bg-orange-500" style={{ width: `${(stats.severityHigh / severityTotal) * 100}%` }} title={`High: ${stats.severityHigh}`} />
                    )}
                    {stats.severityMedium > 0 && (
                      <div className="bg-yellow-500" style={{ width: `${(stats.severityMedium / severityTotal) * 100}%` }} title={`Medium: ${stats.severityMedium}`} />
                    )}
                    {stats.severityLow > 0 && (
                      <div className="bg-green-500 rounded-r-full" style={{ width: `${(stats.severityLow / severityTotal) * 100}%` }} title={`Low: ${stats.severityLow}`} />
                    )}
                  </div>
                  <div className="flex gap-4 text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                    {stats.severityCritical > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{stats.severityCritical} critical</span>}
                    {stats.severityHigh > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" />{stats.severityHigh} high</span>}
                    {stats.severityMedium > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />{stats.severityMedium} medium</span>}
                    {stats.severityLow > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{stats.severityLow} low</span>}
                  </div>
                </div>
              )}
              {stats && severityTotal === 0 && !loading && (
                <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>No scans in the last 30 days</p>
              )}
            </div>

            {/* ── Gold Answer Pipeline ── */}
            <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--hd-border-subtle)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium" style={{ color: 'var(--hd-text)' }}>Gold Answer Pipeline</span>
                <span className="ml-auto text-xs font-mono" style={{ color: 'var(--hd-text-dim)' }}>
                  {stats?.goldTotal ?? 0} total
                </span>
              </div>

              {/* Pipeline cards */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {/* Pending — clickable when items exist */}
                <button
                  onClick={() => hasPending && setView("review-queue")}
                  disabled={!hasPending}
                  className={`rounded-lg p-3 text-center transition-all ${
                    hasPending
                      ? "cursor-pointer ring-1 ring-amber-400/40 hover:ring-amber-400/70 hover:scale-[1.02]"
                      : "cursor-default"
                  }`}
                  style={{
                    background: hasPending
                      ? 'rgba(245,158,11,0.15)'
                      : 'rgba(245,158,11,0.08)',
                    border: hasPending
                      ? '1px solid rgba(245,158,11,0.4)'
                      : '1px solid rgba(245,158,11,0.2)',
                  }}
                  title={hasPending ? "Open review queue" : undefined}
                >
                  <Clock className={`w-4 h-4 mx-auto mb-1 text-amber-400 ${hasPending ? "animate-pulse" : ""}`} />
                  <div className="text-2xl font-bold tabular-nums text-amber-400">
                    {loading ? "..." : stats?.goldPending ?? 0}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--hd-text-dim)' }}>Pending</div>
                  {hasPending && (
                    <div className="text-[10px] mt-1 text-amber-400/70 font-medium">Review &rarr;</div>
                  )}
                </button>

                {/* Verified */}
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-green-400" />
                  <div className="text-2xl font-bold tabular-nums text-green-400">
                    {loading ? "..." : stats?.goldVerified ?? 0}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--hd-text-dim)' }}>Verified</div>
                </div>

                {/* Rejected */}
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <XCircle className="w-4 h-4 mx-auto mb-1 text-red-400" />
                  <div className="text-2xl font-bold tabular-nums text-red-400">
                    {loading ? "..." : stats?.goldRejected ?? 0}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--hd-text-dim)' }}>Rejected</div>
                </div>
              </div>

              {/* Export actions */}
              <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--hd-border-subtle)' }}>
                <span className="text-xs mr-auto" style={{ color: 'var(--hd-text-dim)' }}>Export:</span>
                <Button
                  size="sm"
                  onClick={handleExportFineTune}
                  disabled={isExportingFineTune || (stats?.goldVerified ?? 0) === 0}
                  loading={isExportingFineTune}
                  icon={<Download />}
                  className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-400"
                >
                  Fine-Tune
                </Button>
                <Button
                  size="sm"
                  onClick={handleExportGold}
                  disabled={isExportingGold || (stats?.goldTotal ?? 0) === 0}
                  loading={isExportingGold}
                  icon={<Download />}
                  className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-400"
                >
                  Gold JSONL
                </Button>
                <Button
                  size="sm"
                  onClick={handleExportRag}
                  disabled={isExportingRag}
                  loading={isExportingRag}
                  icon={<Download />}
                  className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400"
                >
                  RAG Bundle
                </Button>
              </div>

              {/* Export message */}
              {exportMsg && (
                <p className={`text-xs mt-2 ${exportMsg.includes("failed") || exportMsg.includes("No ") ? "text-red-400" : "text-green-400"}`}>
                  {exportMsg}
                </p>
              )}
            </div>
          </div>
        ) : (
          /* ── Gold Review Queue (embedded) ── */
          <div className="flex-1 overflow-hidden">
            <GoldReviewQueueEmbed />
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Thin wrapper that renders GoldReviewQueue inline (no own modal/backdrop)
 * instead of as a standalone fullscreen overlay.
 */
function GoldReviewQueueEmbed() {
  // We import the component but render its contents without the fixed overlay.
  // Since GoldReviewQueue renders its own fixed overlay, we use a lightweight
  // inline version here instead.
  const [pending, setPending] = useState<import("../types").GoldAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"pending" | "rejected">("pending");

  useEffect(() => {
    loadItems(viewMode);
  }, [viewMode]);

  const loadItems = async (mode: "pending" | "rejected") => {
    setLoading(true);
    setError(null);
    try {
      const result = mode === "pending"
        ? await invoke<import("../types").GoldAnalysis[]>("get_pending_gold_analyses")
        : await invoke<import("../types").GoldAnalysis[]>("get_rejected_gold_analyses");
      setPending(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (id: number) => {
    setProcessing(id);
    try {
      await invoke("verify_gold_analysis", { goldAnalysisId: id, verifiedBy: "manual" });
      await loadItems(viewMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id: number) => {
    setProcessing(id);
    try {
      await invoke("reject_gold_analysis", { goldAnalysisId: id, verifiedBy: "manual" });
      await loadItems(viewMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const handleReopen = async (id: number) => {
    setProcessing(id);
    try {
      await invoke("reopen_gold_analysis", { goldAnalysisId: id });
      await loadItems(viewMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(null);
    }
  };

  const parseSuggestedFixes = (fixes: string): string[] => {
    try {
      const parsed = JSON.parse(fixes);
      return Array.isArray(parsed) ? parsed : [fixes];
    } catch {
      return [fixes];
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header with mode toggle */}
      <div className="flex items-center gap-2 px-6 py-3" style={{ borderBottom: '1px solid var(--hd-border-subtle)' }}>
        <span className="text-xs mr-1" style={{ color: 'var(--hd-text-dim)' }}>Show:</span>
        {(["pending", "rejected"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className="px-3 py-1 rounded text-xs font-medium transition"
            style={{
              background: viewMode === m
                ? m === "pending" ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)'
                : 'transparent',
              color: viewMode === m
                ? m === "pending" ? 'rgb(147,197,253)' : 'rgb(252,165,165)'
                : 'var(--hd-text-muted)',
              border: viewMode === m
                ? m === "pending" ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(239,68,68,0.3)'
                : '1px solid var(--hd-border-subtle)',
            }}
          >
            {m === "pending" ? "Pending" : "Rejected"}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums" style={{ color: 'var(--hd-text-dim)' }}>
          {pending.length} {pending.length === 1 ? "item" : "items"}
        </span>
        <button
          onClick={() => loadItems(viewMode)}
          disabled={loading}
          className="p-1 rounded transition hover:bg-white/5"
          style={{ color: 'var(--hd-text-muted)' }}
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(252,165,165)' }}>
            {error}
          </div>
        )}

        {!loading && !error && pending.length === 0 && (
          <div className="text-center py-12">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--hd-text-dim)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>
              {viewMode === "pending" ? "No pending reviews" : "No rejected reviews"}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--hd-text-dim)' }}>
              {viewMode === "pending" ? "All gold analyses have been reviewed" : "No rejected gold analyses"}
            </p>
          </div>
        )}

        {!loading && !error && pending.length > 0 && (
          <div className="space-y-3">
            {pending.map((analysis) => (
              <div
                key={analysis.id}
                className="rounded-lg p-4 transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: viewMode === "rejected"
                    ? '1px solid rgba(239,68,68,0.25)'
                    : '1px solid var(--hd-border-subtle)',
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--hd-text)' }}>
                        {analysis.errorSignature}
                      </h3>
                      {viewMode === "rejected" && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 text-red-400 flex-shrink-0">
                          Rejected
                        </span>
                      )}
                      {analysis.severity && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/10 flex-shrink-0" style={{ color: 'var(--hd-text-muted)' }}>
                          {analysis.severity}
                        </span>
                      )}
                    </div>
                    {analysis.component && (
                      <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                        {analysis.component}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] ml-3 flex-shrink-0" style={{ color: 'var(--hd-text-dim)' }}>
                    {new Date(analysis.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="space-y-2 mt-3">
                  <div>
                    <h4 className="text-[11px] font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--hd-text-dim)' }}>Root Cause</h4>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--hd-text-muted)' }}>{analysis.rootCause}</p>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--hd-text-dim)' }}>Suggested Fixes</h4>
                    <ul className="space-y-0.5">
                      {parseSuggestedFixes(analysis.suggestedFixes).map((fix, idx) => (
                        <li key={idx} className="text-xs flex items-start" style={{ color: 'var(--hd-text-muted)' }}>
                          <span className="text-blue-400 mr-1.5">-</span>
                          <span className="flex-1">{fix}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--hd-border-subtle)' }}>
                  {viewMode === "rejected" ? (
                    <Button
                      onClick={() => handleReopen(analysis.id)}
                      disabled={processing === analysis.id}
                      variant="primary"
                      size="sm"
                      loading={processing === analysis.id}
                      className="flex-1 justify-center"
                    >
                      Reopen for Review
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => handleVerify(analysis.id)}
                        disabled={processing === analysis.id}
                        variant="success"
                        size="sm"
                        loading={processing === analysis.id}
                        icon={<CheckCircle2 />}
                        className="flex-1 justify-center"
                      >
                        Verify
                      </Button>
                      <Button
                        onClick={() => handleReject(analysis.id)}
                        disabled={processing === analysis.id}
                        variant="danger"
                        size="sm"
                        loading={processing === analysis.id}
                        icon={<XCircle />}
                        className="flex-1 justify-center"
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
