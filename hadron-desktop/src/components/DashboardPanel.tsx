import { useEffect, useMemo, useState } from "react";
import { X, Activity, Database, ChevronDown, ChevronRight } from "lucide-react";
import type { Analysis, DatabaseStatistics } from "../services/api";
import { getAnalysesForDashboard, getDatabaseStatistics } from "../services/api";
import { aggregateByField, countLast7Days, findSimilarAnalyses, formatDate } from "../utils/dashboard";
import PatternBrowser from "./PatternBrowser";

interface DashboardPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAnalysis: (analysis: Analysis) => void;
}

export default function DashboardPanel({ isOpen, onClose, onOpenAnalysis }: DashboardPanelProps) {
  const [stats, setStats] = useState<DatabaseStatistics | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPatternBrowser, setShowPatternBrowser] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardData() {
      setLoading(true);
      setError(null);

      try {
        const [dbStats, allAnalyses] = await Promise.all([
          getDatabaseStatistics(),
          getAnalysesForDashboard(),
        ]);

        if (cancelled) return;

        setStats(dbStats);
        setAnalyses(allAnalyses);

        if (allAnalyses.length > 0 && selectedBaseId === null) {
          setSelectedBaseId(allAnalyses[0].id);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load dashboard data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (isOpen) {
      loadDashboardData();
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const last7DaysCount = useMemo(() => countLast7Days(analyses), [analyses]);

  const topErrorTypes = useMemo(() => aggregateByField(analyses, "error_type").slice(0, 5), [analyses]);
  const topComponents = useMemo(() => aggregateByField(analyses, "component").slice(0, 5), [analyses]);

  const recentAnalyses = useMemo(() => analyses.slice(0, 20), [analyses]);
  const selectedBase = useMemo(
    () => (selectedBaseId != null ? analyses.find((a) => a.id === selectedBaseId) || null : null),
    [analyses, selectedBaseId]
  );
  const similarAnalyses = useMemo(
    () => findSimilarAnalyses(selectedBase, analyses),
    [selectedBase, analyses]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold">Diagnostics Dashboard</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {loading && (
            <div className="text-sm text-gray-400">
              Loading dashboard data...
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Overview */}
          {stats && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Overview</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">Total Analyses</div>
                  <div className="text-2xl font-bold">{stats.total_count}</div>
                </div>
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">Favorites</div>
                  <div className="text-2xl font-bold">{stats.favorite_count}</div>
                </div>
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">Last 7 Days</div>
                  <div className="text-2xl font-bold">{last7DaysCount}</div>
                </div>
              </div>

              <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                <div className="text-xs text-gray-400 mb-2">By Severity</div>
                <div className="flex flex-wrap gap-2">
                  {stats.severity_breakdown.map(([severity, count]) => (
                    <span
                      key={severity}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs bg-gray-800 text-gray-200"
                    >
                      <span
                        className={
                          severity === "CRITICAL"
                            ? "h-2 w-2 rounded-full bg-red-500"
                            : severity === "HIGH"
                            ? "h-2 w-2 rounded-full bg-orange-500"
                            : severity === "MEDIUM"
                            ? "h-2 w-2 rounded-full bg-yellow-500"
                            : "h-2 w-2 rounded-full bg-green-500"
                        }
                      />
                      <span className="font-semibold">{severity}</span>
                      <span className="text-gray-400">{count}</span>
                    </span>
                  ))}
                  {stats.severity_breakdown.length === 0 && (
                    <span className="text-xs text-gray-500">No severity data yet</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Top patterns */}
          {analyses.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Top Patterns</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">Top Error Types</span>
                    <span className="text-xs text-gray-500">{topErrorTypes.length} shown</span>
                  </div>
                  {topErrorTypes.length === 0 && (
                    <div className="text-xs text-gray-500">No error types yet</div>
                  )}
                  <ul className="space-y-2 text-sm">
                    {topErrorTypes.map((item) => (
                      <li
                        key={item.key}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{item.key}</span>
                          <span className="text-xs text-gray-500">
                            Last seen {formatDate(item.lastSeen)}
                          </span>
                        </div>
                        <span className="text-xs text-gray-300">
                          {item.count} crash{item.count !== 1 ? "es" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">Top Components</span>
                    <span className="text-xs text-gray-500">{topComponents.length} shown</span>
                  </div>
                  {topComponents.length === 0 && (
                    <div className="text-xs text-gray-500">No component data yet</div>
                  )}
                  <ul className="space-y-2 text-sm">
                    {topComponents.map((item) => (
                      <li
                        key={item.key}
                        className="flex items-center justify-between"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{item.key}</span>
                          <span className="text-xs text-gray-500">
                            Last seen {formatDate(item.lastSeen)}
                          </span>
                        </div>
                        <span className="text-xs text-gray-300">
                          {item.count} crash{item.count !== 1 ? "es" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Similar crashes */}
          {analyses.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Similar Crashes</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="text-sm font-semibold mb-2">Reference Crash</div>
                  <select
                    value={selectedBaseId ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedBaseId(value ? Number(value) : null);
                    }}
                    className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {recentAnalyses.map((analysis) => (
                      <option key={analysis.id} value={analysis.id}>
                        [{analysis.severity}] {analysis.filename} – {analysis.error_type}
                      </option>
                    ))}
                  </select>
                  {selectedBase && (
                    <div className="mt-3 text-xs text-gray-400">
                      Based on error type{" "}
                      <span className="font-semibold text-gray-200">
                        {selectedBase.error_type}
                      </span>
                      {selectedBase.component && (
                        <>
                          {" "}
                          in component{" "}
                          <span className="font-semibold text-gray-200">
                            {selectedBase.component}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">Similar Crashes</span>
                    <span className="text-xs text-gray-500">
                      {similarAnalyses.length} found
                    </span>
                  </div>
                  {similarAnalyses.length === 0 && (
                    <div className="text-xs text-gray-500">
                      No similar crashes yet. Try analyzing more logs.
                    </div>
                  )}
                  <ul className="space-y-2 text-sm">
                    {similarAnalyses.map((analysis) => (
                      <li key={analysis.id}>
                        <button
                          type="button"
                          onClick={() => onOpenAnalysis(analysis)}
                          className="w-full text-left bg-gray-900 hover:bg-gray-700 border border-gray-700 rounded-md px-3 py-2 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {analysis.filename}
                            </span>
                            <span className="text-xs text-gray-400">
                              {formatDate(analysis.analyzed_at)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-300">
                              {analysis.error_type}
                            </span>
                            <span className="text-xs text-gray-400">
                              {analysis.component || "Unknown component"}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Pattern Browser */}
          <div>
            <button
              onClick={() => setShowPatternBrowser(!showPatternBrowser)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold">Known Patterns</h3>
              </div>
              {showPatternBrowser ? (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-400" />
              )}
            </button>
            <p className="text-sm text-gray-400 mt-1 mb-3">
              Browse and filter crash patterns used for automatic detection
            </p>
            {showPatternBrowser && (
              <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                <PatternBrowser />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
