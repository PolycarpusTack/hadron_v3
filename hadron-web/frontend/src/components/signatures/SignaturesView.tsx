import { useCallback, useEffect, useState } from "react";
import {
  api,
  AnalysisSummary,
  CrashSignatureInfo,
  PaginatedResponse,
} from "../../services/api";
import { SeverityBadge } from "../common/SeverityBadge";
import { useToast } from "../Toast";

const STATUSES = ["new", "investigating", "fix_in_progress", "fixed", "wont_fix", "duplicate"];

export function SignaturesView() {
  const toast = useToast();
  const [sigs, setSigs] = useState<CrashSignatureInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const limit = 50;

  const fetchSigs = useCallback(async () => {
    setLoading(true);
    try {
      const resp: PaginatedResponse<CrashSignatureInfo> =
        await api.listSignatures(limit, offset);
      setSigs(resp.data);
      setTotal(resp.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load signatures");
    } finally {
      setLoading(false);
    }
  }, [offset, toast]);

  useEffect(() => {
    fetchSigs();
  }, [fetchSigs]);

  const handleSelect = async (hash: string) => {
    setSelected(hash);
    try {
      const a = await api.getSignatureAnalyses(hash);
      setAnalyses(a);
    } catch (e) {
      console.error("Failed to load signature analyses:", e);
    }
  };

  const handleStatusChange = async (hash: string, status: string) => {
    try {
      await api.updateSignatureStatus(hash, status);
      setSigs((prev) =>
        prev.map((s) => (s.hash === hash ? { ...s, status } : s)),
      );
      toast.success("Status updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="flex gap-6">
      <div className={`flex-1 ${selected ? "max-w-lg" : ""}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">
            Crash Signatures
          </h2>
          <span className="text-sm text-slate-400">{total} signatures</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading...</div>
        ) : sigs.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            No signatures yet. They are auto-generated from crash analyses.
          </div>
        ) : (
          <div className="space-y-1">
            {sigs.map((sig) => (
              <div
                key={sig.hash}
                onClick={() => handleSelect(sig.hash)}
                className={`cursor-pointer rounded-md px-3 py-2.5 transition-colors ${
                  selected === sig.hash
                    ? "border border-blue-500/30 bg-blue-600/20"
                    : "hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-slate-200">
                    {sig.hash}
                  </span>
                  <span className="text-xs text-slate-400">
                    {sig.occurrenceCount}x
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {sig.canonical}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      sig.status === "fixed"
                        ? "bg-green-500/20 text-green-400"
                        : sig.status === "investigating"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-slate-600/50 text-slate-400"
                    }`}
                  >
                    {sig.status.replace(/_/g, " ")}
                  </span>
                  {sig.linkedTicketId && (
                    <span className="text-xs text-blue-400">
                      {sig.linkedTicketId}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="flex-1 space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">
              Signature Details
            </h3>
            {sigs
              .filter((s) => s.hash === selected)
              .map((sig) => (
                <div key={sig.hash} className="space-y-3">
                  <div>
                    <dt className="text-xs text-slate-500">Hash</dt>
                    <dd className="font-mono text-sm text-slate-200">
                      {sig.hash}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Canonical Form</dt>
                    <dd className="text-sm text-slate-300">{sig.canonical}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Status</dt>
                    <dd>
                      <select
                        value={sig.status}
                        onChange={(e) =>
                          handleStatusChange(sig.hash, e.target.value)
                        }
                        className="mt-1 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">First seen</dt>
                      <dd className="text-slate-300">
                        {new Date(sig.firstSeenAt).toLocaleDateString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Last seen</dt>
                      <dd className="text-slate-300">
                        {new Date(sig.lastSeenAt).toLocaleDateString()}
                      </dd>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">
              Related Analyses ({analyses.length})
            </h3>
            {analyses.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-slate-700"
              >
                <span className="truncate text-slate-300">{a.filename}</span>
                <SeverityBadge severity={a.severity} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
