import { useEffect, useState } from "react";
import { api, EmbeddingStatus, BackfillResult } from "../../services/api";
import { useToast } from "../Toast";

export function EmbeddingsPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.getEmbeddingStatus();
      setStatus(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load embedding status";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBackfill = async () => {
    setBackfilling(true);
    setResult(null);
    setError(null);
    try {
      const r = await api.backfillEmbeddings();
      setResult(r);
      toast.success(`Backfill complete: ${r.processed} processed`);
      await loadStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Backfill failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBackfilling(false);
    }
  };

  const coverageColor = (pct: number) => {
    if (pct >= 80) return "bg-emerald-500";
    if (pct >= 40) return "bg-amber-500";
    return "bg-red-500";
  };

  const coverageTextColor = (pct: number) => {
    if (pct >= 80) return "text-emerald-400";
    if (pct >= 40) return "text-amber-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Embedding Coverage</h3>
          <button
            onClick={loadStatus}
            disabled={loading || backfilling}
            className="rounded-md border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <p className="mb-6 text-sm text-slate-400">
          Analyses must be embedded before they can be surfaced by hybrid or semantic search.
          Use Backfill to generate embeddings for any analyses that are missing them.
        </p>

        {loading && !status ? (
          <div className="py-4 text-center text-sm text-slate-400">Loading status...</div>
        ) : status ? (
          <div className="space-y-4">
            {/* Stats */}
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-slate-300">
                  {status.embedded} of {status.totalAnalyses} analyses have embeddings
                </span>
                <span className={`font-semibold ${coverageTextColor(status.coverage)}`}>
                  {status.coverage.toFixed(1)}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${coverageColor(status.coverage)}`}
                  style={{ width: `${Math.min(status.coverage, 100)}%` }}
                />
              </div>
            </div>

            {/* Backfill result */}
            {result && (
              <div className="rounded-md border border-teal-700/50 bg-teal-900/20 px-4 py-3 text-sm text-teal-300">
                Backfill complete — Processed: {result.processed}, Skipped: {result.skipped}, Errors: {result.errors}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-md border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Action */}
            <div>
              <button
                onClick={handleBackfill}
                disabled={backfilling || loading}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {backfilling ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Backfilling...
                  </span>
                ) : (
                  "Backfill Embeddings"
                )}
              </button>
              {status.totalAnalyses - status.embedded > 0 && !backfilling && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {status.totalAnalyses - status.embedded} analyses without embeddings
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
