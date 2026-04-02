import type { CodeIssue, CodeQualityScores } from "../../../services/api";
import { QualityGauge } from "../shared/QualityGauge";

function MetricBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped < 40 ? "bg-red-500" : clamped < 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300">{clamped}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-700">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/5 text-red-400",
  high: "border-orange-500/30 bg-orange-500/5 text-orange-400",
  medium: "border-yellow-500/30 bg-yellow-500/5 text-yellow-400",
  low: "border-blue-500/30 bg-blue-500/5 text-blue-400",
};

export function QualityTab({
  scores,
  issues,
  onFilterToSeverity,
}: {
  scores: CodeQualityScores;
  issues: CodeIssue[];
  onFilterToSeverity: (severity: string) => void;
}) {
  const countBySeverity = SEVERITY_ORDER.map((sev) => ({
    severity: sev,
    count: issues.filter((i) => i.severity === sev).length,
  }));

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <div className="flex justify-center rounded-lg border border-slate-700 bg-slate-800 p-6">
        <QualityGauge score={scores.overall} size={120} label="Overall Quality" />
      </div>

      {/* Metric Bars */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <h3 className="mb-4 text-sm font-semibold text-slate-300">Metrics</h3>
        <div className="space-y-3">
          <MetricBar label="Security" value={scores.security} />
          <MetricBar label="Performance" value={scores.performance} />
          <MetricBar label="Maintainability" value={scores.maintainability} />
          <MetricBar label="Best Practices" value={scores.bestPractices} />
        </div>
      </div>

      {/* Issue Breakdown */}
      {issues.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Issue Breakdown</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {countBySeverity.map(({ severity, count }) => (
              <button
                key={severity}
                onClick={() => count > 0 && onFilterToSeverity(severity)}
                disabled={count === 0}
                className={`rounded-md border p-3 text-center transition-colors ${
                  count > 0
                    ? `${SEVERITY_COLORS[severity]} cursor-pointer hover:opacity-80`
                    : "border-slate-700 text-slate-600"
                }`}
              >
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs capitalize">{severity}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
