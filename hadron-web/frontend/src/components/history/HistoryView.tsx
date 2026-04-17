import { useCallback, useEffect, useState } from "react";
import {
  api,
  AnalysisSummary,
  PaginatedResponse,
} from "../../services/api";
import { useDebounce } from "../../hooks/useDebounce";
import { SeverityBadge } from "../common/SeverityBadge";
import { AnalysisResultCard } from "../analysis/AnalysisResultCard";
import { SimilarAnalysesPanel } from "../analysis/SimilarAnalysesPanel";
import { useToast } from "../Toast";
import { ConfirmDialog } from "../ConfirmDialog";
import type { Analysis } from "../../services/api";

type Tab = "active" | "archived";

export function HistoryView() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("active");
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Analysis | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const debouncedSearch = useDebounce(search, 300);
  const limit = 50;

  const fetchAnalyses = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "archived") {
        const resp = await api.getArchivedAnalyses(limit, offset);
        setAnalyses(resp.data);
        setTotal(resp.total);
      } else if (debouncedSearch) {
        const results = await api.searchAnalyses(debouncedSearch);
        setAnalyses(results);
        setTotal(results.length);
      } else {
        const resp: PaginatedResponse<AnalysisSummary> =
          await api.getAnalyses(limit, offset);
        setAnalyses(resp.data);
        setTotal(resp.total);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load analyses");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, offset, tab, toast]);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

  useEffect(() => {
    setOffset(0);
    setSelectedId(null);
    setDetail(null);
    setSelected(new Set());
  }, [tab]);

  const handleView = async (id: number) => {
    setSelectedId(id);
    try {
      const analysis = await api.getAnalysis(id);
      setDetail(analysis);
    } catch (e) {
      console.error("Failed to fetch analysis:", e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      toast.success("Analysis archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive");
    }
  };

  const handleRestore = async (id: number) => {
    try {
      await api.restoreAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      toast.success("Analysis restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore");
    }
  };

  const handlePermanentDelete = async (id: number) => {
    try {
      await api.permanentDeleteAnalysis(id);
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      toast.success("Permanently deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleToggleFavorite = async (id: number) => {
    try {
      const result = await api.toggleFavorite(id);
      setAnalyses((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, isFavorite: result.isFavorite } : a,
        ),
      );
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === analyses.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(analyses.map((a) => a.id)));
    }
  };

  const handleBulk = async (op: string) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selected);
      await api.bulkOperation(ids, op);
      setSelected(new Set());
      fetchAnalyses();
      toast.success(`Bulk ${op} completed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk operation failed");
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="flex gap-6">
      {/* List */}
      <div className={`flex-1 ${detail ? "max-w-md" : ""}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">
            Analysis History
          </h2>
          <span className="text-sm text-slate-400">{total} analyses</span>
        </div>

        {/* Tab toggle */}
        <div className="mb-4 flex gap-1">
          <button
            onClick={() => setTab("active")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "active"
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setTab("archived")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "archived"
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            Archived
          </button>
        </div>

        {/* Search (active tab only) */}
        {tab === "active" && (
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Search analyses..."
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && tab === "active" && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-600/10 px-3 py-2">
            <span className="text-xs text-blue-400">
              {selected.size} selected
            </span>
            <button
              onClick={() => handleBulk("archive")}
              disabled={bulkLoading}
              className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600"
            >
              Archive
            </button>
            <button
              onClick={() => handleBulk("favorite")}
              disabled={bulkLoading}
              className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600"
            >
              Favorite
            </button>
            <button
              onClick={() => handleBulk("unfavorite")}
              disabled={bulkLoading}
              className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-600"
            >
              Unfavorite
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading...</div>
        ) : analyses.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            {tab === "archived"
              ? "No archived analyses"
              : search
                ? "No results found"
                : "No analyses yet"}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Select all */}
            {tab === "active" && analyses.length > 0 && (
              <label className="flex items-center gap-2 px-3 py-1 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={selected.size === analyses.length}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
                Select all
              </label>
            )}
            {analyses.map((a) => (
              <div
                key={a.id}
                onClick={() => handleView(a.id)}
                className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 transition-colors ${
                  selectedId === a.id
                    ? "bg-blue-600/20 border border-blue-500/30"
                    : "hover:bg-slate-800"
                }`}
              >
                {tab === "active" && (
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelect(a.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="mr-2 rounded"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">
                      {a.filename}
                    </span>
                    {a.isFavorite && (
                      <span className="text-yellow-400" title="Favorite">
                        &#9733;
                      </span>
                    )}
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
                <div className="ml-3 flex items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  {tab === "active" ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(a.id);
                        }}
                        className="text-slate-500 hover:text-yellow-400"
                        title="Toggle favorite"
                      >
                        {a.isFavorite ? "\u2605" : "\u2606"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(a.id);
                        }}
                        className="text-slate-500 hover:text-red-400"
                        title="Archive"
                      >
                        &times;
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestore(a.id);
                        }}
                        className="text-xs text-green-400 hover:text-green-300"
                        title="Restore"
                      >
                        Restore
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePermanentDelete(a.id);
                        }}
                        className="text-xs text-red-400 hover:text-red-300"
                        title="Permanently delete"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
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

      {/* Detail Panel */}
      {detail && (
        <div className="flex-1 space-y-4">
          <AnalysisResultCard
            analysis={detail}
            showGoldActions={tab === "active"}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
            }}
          />
          <SimilarAnalysesPanel analysisId={detail.id} />
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Archive Analysis"
        message="Are you sure you want to archive this analysis? You can restore it later from the Archived tab."
        confirmLabel="Archive"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget !== null) {
            handleDelete(deleteTarget);
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
