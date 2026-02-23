import { useState } from "react";
import { api, AnalysisSummary } from "../../services/api";
import { SeverityBadge } from "../common/SeverityBadge";
import { useToast } from "../Toast";

export function AdvancedSearchPanel() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [results, setResults] = useState<AnalysisSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const toggleSeverity = (s: string) => {
    setSeverity((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    try {
      const resp = await api.advancedSearch({
        q: q || undefined,
        severity: severity.length > 0 ? severity : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        isFavorite: isFavorite || undefined,
        limit: 50,
        offset: 0,
      });
      setResults(resp.data);
      setTotal(resp.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold text-white">Advanced Search</h2>

      {/* Filters */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Search text
          </label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Full-text search across analyses..."
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Severity
            </label>
            <div className="flex flex-wrap gap-1">
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
                <button
                  key={s}
                  onClick={() => toggleSeverity(s)}
                  className={`rounded px-2 py-0.5 text-xs transition-colors ${
                    severity.includes(s)
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Date from
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Date to
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={isFavorite}
              onChange={(e) => setIsFavorite(e.target.checked)}
              className="rounded"
            />
            Favorites only
          </label>
          <button
            onClick={handleSearch}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="py-8 text-center text-slate-400">Searching...</div>
      ) : searched ? (
        <div>
          <p className="mb-2 text-sm text-slate-400">
            {total} result{total !== 1 ? "s" : ""} found
          </p>
          <div className="space-y-1">
            {results.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-slate-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">
                    {a.filename}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span>
                      {new Date(a.analyzedAt).toLocaleDateString()}
                    </span>
                    {a.errorType && <span>{a.errorType}</span>}
                    {a.component && <span>{a.component}</span>}
                  </div>
                </div>
                <SeverityBadge severity={a.severity} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
