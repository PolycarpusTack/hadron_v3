import { AiInsights } from "../../services/api";

interface Props {
  insights: AiInsights;
}

export function ReleaseNotesInsights({ insights }: Props) {
  const { qualityScore, ticketCoverage, moduleBreakdown, breakingChanges, suggestions } = insights;

  const scoreColor =
    qualityScore >= 70
      ? "text-emerald-400"
      : qualityScore >= 40
        ? "text-yellow-400"
        : "text-red-400";

  const coverageColor =
    ticketCoverage >= 70
      ? "bg-emerald-500"
      : ticketCoverage >= 40
        ? "bg-yellow-500"
        : "bg-red-500";

  const sortedModules = Object.entries(moduleBreakdown).sort(([, a], [, b]) => b - a);
  const maxCount = sortedModules.length > 0 ? sortedModules[0][1] : 1;

  return (
    <div className="space-y-4">
      {/* Quality Score */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <div className="flex items-end gap-3">
          <span className={`text-5xl font-bold tabular-nums ${scoreColor}`}>
            {qualityScore}
          </span>
          <span className="mb-1 text-sm text-slate-400">Quality Score</span>
        </div>
      </div>

      {/* Ticket Coverage */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-300">Ticket Coverage</span>
          <span className="font-semibold text-slate-200">{ticketCoverage}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className={`h-full rounded-full transition-all ${coverageColor}`}
            style={{ width: `${Math.min(ticketCoverage, 100)}%` }}
          />
        </div>
      </div>

      {/* Module Breakdown */}
      {sortedModules.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <h4 className="mb-3 text-sm font-medium text-slate-300">Module Breakdown</h4>
          <div className="space-y-2">
            {sortedModules.map(([module, count]) => (
              <div key={module} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-xs text-slate-400" title={module}>
                  {module}
                </span>
                <div className="flex flex-1 items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs tabular-nums text-slate-400">
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breaking Changes */}
      {breakingChanges.length > 0 && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-4">
          <h4 className="mb-2 text-sm font-semibold text-red-400">Breaking Changes</h4>
          <ul className="space-y-1">
            {breakingChanges.map((change, i) => (
              <li key={i} className="text-sm text-red-300">
                {change}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-4">
          <h4 className="mb-2 text-sm font-semibold text-amber-400">Suggestions</h4>
          <ul className="list-disc space-y-1 pl-4">
            {suggestions.map((s, i) => (
              <li key={i} className="text-sm text-amber-300">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
