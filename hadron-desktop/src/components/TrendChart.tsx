/**
 * TrendChart - Simple bar chart for crash analysis trends
 * Uses CSS for rendering (no external chart library required)
 */

import { useState, useEffect, useMemo, memo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getTrendData, getTopErrorPatterns } from "../services/api";
import type { TrendDataPoint, ErrorPatternCount } from "../types";
import logger from "../services/logger";

interface TrendChartProps {
  period?: "day" | "week" | "month";
  rangeDays?: number;
}

// Color mapping for severity
const SEVERITY_COLORS = {
  critical: "#EF4444",
  high: "#F97316",
  medium: "#EAB308",
  low: "#3B82F6",
};

export const TrendChart = memo(function TrendChart({
  period = "day",
  rangeDays = 30,
}: TrendChartProps) {
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [errorPatterns, setErrorPatterns] = useState<ErrorPatternCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedView, setSelectedView] = useState<"severity" | "type">("severity");

  // Load data on mount
  useEffect(() => {
    loadData();
  }, [period, rangeDays]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [trends, patterns] = await Promise.all([
        getTrendData(period, rangeDays),
        getTopErrorPatterns(5),
      ]);
      setTrendData(trends);
      setErrorPatterns(patterns);
    } catch (err) {
      logger.error("Failed to load trend data", { error: err });
    } finally {
      setLoading(false);
    }
  };

  // Calculate max value for scaling
  const maxTotal = useMemo(() => {
    if (trendData.length === 0) return 1;
    return Math.max(...trendData.map((d) => d.total), 1);
  }, [trendData]);

  // Calculate totals and trend
  const stats = useMemo(() => {
    if (trendData.length === 0) {
      return { total: 0, critical: 0, trend: "stable" as const, trendPercent: 0 };
    }

    const total = trendData.reduce((sum, d) => sum + d.total, 0);
    const critical = trendData.reduce((sum, d) => sum + d.criticalCount, 0);

    // Compare first half to second half for trend
    const midpoint = Math.floor(trendData.length / 2);
    const firstHalf = trendData.slice(0, midpoint).reduce((sum, d) => sum + d.total, 0);
    const secondHalf = trendData.slice(midpoint).reduce((sum, d) => sum + d.total, 0);

    let trend: "up" | "down" | "stable" = "stable";
    let trendPercent = 0;

    if (firstHalf > 0) {
      trendPercent = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
      if (trendPercent > 10) trend = "up";
      else if (trendPercent < -10) trend = "down";
    }

    return { total, critical, trend, trendPercent };
  }, [trendData]);

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-400">
        Loading trends...
      </div>
    );
  }

  if (trendData.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 bg-gray-800/30 rounded-lg">
        No data available for the selected period
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-sm text-gray-400">Total Analyses</div>
        </div>
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <div className="text-2xl font-bold text-red-400">{stats.critical}</div>
          <div className="text-sm text-gray-400">Critical Issues</div>
        </div>
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2">
            {stats.trend === "up" && <TrendingUp className="w-5 h-5 text-red-400" />}
            {stats.trend === "down" && <TrendingDown className="w-5 h-5 text-green-400" />}
            {stats.trend === "stable" && <Minus className="w-5 h-5 text-gray-400" />}
            <span
              className={`text-2xl font-bold ${
                stats.trend === "up"
                  ? "text-red-400"
                  : stats.trend === "down"
                  ? "text-green-400"
                  : "text-gray-400"
              }`}
            >
              {stats.trendPercent > 0 ? "+" : ""}
              {stats.trendPercent}%
            </span>
          </div>
          <div className="text-sm text-gray-400">Trend</div>
        </div>
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <div className="text-2xl font-bold">
            ${trendData.reduce((sum, d) => sum + d.totalCost, 0).toFixed(2)}
          </div>
          <div className="text-sm text-gray-400">Total Cost</div>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedView("severity")}
          className={`px-3 py-1 rounded text-sm transition ${
            selectedView === "severity"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          By Severity
        </button>
        <button
          onClick={() => setSelectedView("type")}
          className={`px-3 py-1 rounded text-sm transition ${
            selectedView === "type"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          By Type
        </button>
      </div>

      {/* Bar Chart */}
      <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-400 mb-4">
          Crash Trend (Last {rangeDays} Days)
        </h3>
        <div className="flex items-end gap-1 h-32">
          {trendData.map((point) => {
            const height = (point.total / maxTotal) * 100;
            return (
              <div
                key={point.period}
                className="flex-1 flex flex-col items-center group relative"
              >
                {/* Stacked bar */}
                <div
                  className="w-full rounded-t transition-all"
                  style={{ height: `${height}%`, minHeight: point.total > 0 ? "4px" : "0" }}
                >
                  {selectedView === "severity" ? (
                    <div className="h-full w-full flex flex-col-reverse rounded-t overflow-hidden">
                      <div
                        className="w-full"
                        style={{
                          height: `${(point.lowCount / point.total) * 100}%`,
                          backgroundColor: SEVERITY_COLORS.low,
                        }}
                      />
                      <div
                        className="w-full"
                        style={{
                          height: `${(point.mediumCount / point.total) * 100}%`,
                          backgroundColor: SEVERITY_COLORS.medium,
                        }}
                      />
                      <div
                        className="w-full"
                        style={{
                          height: `${(point.highCount / point.total) * 100}%`,
                          backgroundColor: SEVERITY_COLORS.high,
                        }}
                      />
                      <div
                        className="w-full"
                        style={{
                          height: `${(point.criticalCount / point.total) * 100}%`,
                          backgroundColor: SEVERITY_COLORS.critical,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-full w-full flex flex-col-reverse rounded-t overflow-hidden">
                      <div
                        className="w-full bg-emerald-500"
                        style={{ height: `${(point.whatsonCount / point.total) * 100}%` }}
                      />
                      <div
                        className="w-full bg-blue-500"
                        style={{ height: `${(point.completeCount / point.total) * 100}%` }}
                      />
                      <div
                        className="w-full bg-purple-500"
                        style={{ height: `${(point.specializedCount / point.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Tooltip */}
                <div
                  className="absolute bottom-full mb-2 px-2 py-1 bg-gray-900 border border-gray-700
                            rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100
                            transition-opacity pointer-events-none z-10"
                >
                  <div className="font-semibold">{point.period}</div>
                  <div>Total: {point.total}</div>
                  {selectedView === "severity" ? (
                    <>
                      <div className="text-red-400">Critical: {point.criticalCount}</div>
                      <div className="text-orange-400">High: {point.highCount}</div>
                      <div className="text-yellow-400">Medium: {point.mediumCount}</div>
                      <div className="text-blue-400">Low: {point.lowCount}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-emerald-400">WHATS'ON: {point.whatsonCount}</div>
                      <div className="text-blue-400">Complete: {point.completeCount}</div>
                      <div className="text-purple-400">Specialized: {point.specializedCount}</div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 text-xs">
          {selectedView === "severity" ? (
            <>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: SEVERITY_COLORS.critical }} />
                <span>Critical</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: SEVERITY_COLORS.high }} />
                <span>High</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: SEVERITY_COLORS.medium }} />
                <span>Medium</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: SEVERITY_COLORS.low }} />
                <span>Low</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-emerald-500" />
                <span>WHATS'ON</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-blue-500" />
                <span>Complete</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-purple-500" />
                <span>Specialized</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Top Error Patterns */}
      {errorPatterns.length > 0 && (
        <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">
            Top Error Patterns
          </h3>
          <div className="space-y-2">
            {errorPatterns.map((pattern, index) => (
              <div
                key={pattern.signature}
                className="flex items-center justify-between p-2 bg-gray-800/50 rounded"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 text-sm">#{index + 1}</span>
                  <div>
                    <div className="font-medium">{pattern.errorType}</div>
                    {pattern.component && (
                      <div className="text-xs text-gray-400">{pattern.component}</div>
                    )}
                  </div>
                </div>
                <div className="text-sm font-semibold">{pattern.count} occurrences</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default TrendChart;
