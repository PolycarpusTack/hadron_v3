import { useCallback, useEffect, useState } from "react";
import {
  api,
  type TeamAnalysisSummary,
  type PaginatedResponse,
} from "../../services/api";
import { SeverityBadge } from "../common/SeverityBadge";
import { useToast } from "../Toast";

export function TeamFeedView() {
  const toast = useToast();
  const [analyses, setAnalyses] = useState<TeamAnalysisSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    try {
      const resp: PaginatedResponse<TeamAnalysisSummary> =
        await api.getTeamAnalyses(limit, offset);
      setAnalyses(resp.data);
      setTotal(resp.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load team feed");
    } finally {
      setLoading(false);
    }
  }, [offset, toast]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Team Feed</h2>
        <span className="text-sm text-slate-400">{total} analyses</span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400">Loading...</div>
      ) : analyses.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          No team analyses yet
        </div>
      ) : (
        <div className="space-y-1">
          {analyses.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-slate-800"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-200">
                    {a.filename}
                  </span>
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                    {a.analystName}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                  <span>
                    {new Date(a.analyzedAt).toLocaleDateString()}
                  </span>
                  {a.errorType && (
                    <span className="truncate text-slate-500">
                      {a.errorType}
                    </span>
                  )}
                </div>
              </div>
              <div className="ml-3">
                <SeverityBadge severity={a.severity} />
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
  );
}
