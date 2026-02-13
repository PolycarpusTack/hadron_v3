/**
 * Release Notes Insights
 * Quality score, module breakdown, coverage, breaking changes, suggestions.
 */

import { useMemo } from "react";
import {
  BarChart3,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Layers,
} from "lucide-react";
import type { ReleaseNotesAiInsights } from "../../types";

interface Props {
  insightsJson: string | null;
  ticketCount: number;
  tokensUsed: number;
  cost: number;
  durationMs: number | null;
}

export default function ReleaseNotesInsights({
  insightsJson,
  ticketCount,
  tokensUsed,
  cost,
  durationMs,
}: Props) {
  const insights = useMemo<ReleaseNotesAiInsights | null>(() => {
    if (!insightsJson) return null;
    try {
      return JSON.parse(insightsJson);
    } catch {
      return null;
    }
  }, [insightsJson]);

  const qualityColor = useMemo(() => {
    if (!insights) return "text-gray-500";
    if (insights.qualityScore >= 80) return "text-green-400";
    if (insights.qualityScore >= 60) return "text-amber-400";
    return "text-red-400";
  }, [insights]);

  const qualityBg = useMemo(() => {
    if (!insights) return "bg-gray-500/20";
    if (insights.qualityScore >= 80) return "bg-green-500/20";
    if (insights.qualityScore >= 60) return "bg-amber-500/20";
    return "bg-red-500/20";
  }, [insights]);

  const sortedModules = useMemo(() => {
    if (!insights?.moduleBreakdown) return [];
    return Object.entries(insights.moduleBreakdown).sort(
      ([, a], [, b]) => b - a,
    );
  }, [insights]);

  return (
    <div className="space-y-4">
      {/* Generation Stats */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3">
          Generation Stats
        </h4>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-lg font-bold text-white">{ticketCount}</p>
            <p className="text-xs text-gray-500">Tickets</p>
          </div>
          <div>
            <p className="text-lg font-bold text-white">
              {tokensUsed.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Tokens</p>
          </div>
          <div>
            <p className="text-lg font-bold text-white">
              ${cost.toFixed(4)}
            </p>
            <p className="text-xs text-gray-500">Cost</p>
          </div>
          <div>
            <p className="text-lg font-bold text-white">
              {durationMs ? `${(durationMs / 1000).toFixed(1)}s` : "—"}
            </p>
            <p className="text-xs text-gray-500">Duration</p>
          </div>
        </div>
      </div>

      {!insights ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No AI insights available for this draft.
        </div>
      ) : (
        <>
          {/* Quality Score */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                Quality Score
              </h4>
              <span className={`text-2xl font-bold ${qualityColor}`}>
                {insights.qualityScore}
                <span className="text-sm text-gray-500">/100</span>
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${qualityBg.replace("/20", "")}`}
                style={{ width: `${Math.min(insights.qualityScore, 100)}%` }}
              />
            </div>
            {insights.ticketCoverage > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                <CheckCircle2 className="w-3 h-3 inline mr-1" />
                {Math.round(insights.ticketCoverage * 100)}% ticket coverage
              </p>
            )}
          </div>

          {/* Module Breakdown */}
          {sortedModules.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                Module Breakdown
              </h4>
              <div className="space-y-2">
                {sortedModules.map(([module, count]) => {
                  const pct =
                    ticketCount > 0
                      ? Math.round((count / ticketCount) * 100)
                      : 0;
                  return (
                    <div key={module}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-gray-300 truncate max-w-[200px]">
                          {module}
                        </span>
                        <span className="text-gray-500">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5">
                        <div
                          className="bg-amber-400 h-1.5 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Breaking Changes */}
          {insights.breakingChanges.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
              <h4 className="text-xs font-semibold text-red-400 uppercase mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Breaking Changes ({insights.breakingChanges.length})
              </h4>
              <ul className="space-y-1">
                {insights.breakingChanges.map((change, i) => (
                  <li key={i} className="text-sm text-red-300 flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">-</span>
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {insights.suggestions.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                Suggestions
              </h4>
              <ul className="space-y-1.5">
                {insights.suggestions.map((suggestion, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-300 flex items-start gap-2"
                  >
                    <span className="text-amber-400 mt-0.5">{i + 1}.</span>
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
