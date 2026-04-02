import type { CodeAnalysisResult } from "../../../services/api";
import { QualityGauge } from "../shared/QualityGauge";
import { SeverityBadge } from "../shared/SeverityBadge";

export function OverviewTab({
  result,
  onNavigateToIssue,
}: {
  result: CodeAnalysisResult;
  onNavigateToIssue: (id: number) => void;
}) {
  const criticalIssues = result.issues.filter(
    (i) => i.severity === "critical" || i.severity === "high",
  );

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Summary</h3>
        <p className="text-sm text-slate-400">{result.summary || "No summary available."}</p>
      </div>

      {/* Critical Issues */}
      {criticalIssues.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-400">
            {criticalIssues.length} Critical/High Issue{criticalIssues.length > 1 ? "s" : ""}
          </h3>
          <ul className="space-y-2">
            {criticalIssues.map((issue) => (
              <li key={issue.id}>
                <button
                  onClick={() => onNavigateToIssue(issue.id)}
                  className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm text-slate-300 hover:bg-slate-700/50"
                >
                  <SeverityBadge severity={issue.severity} />
                  <span>
                    Line {issue.line}: {issue.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quality Scores */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <h3 className="mb-4 text-sm font-semibold text-slate-300">Code Quality</h3>
        <div className="flex flex-wrap items-end justify-center gap-6">
          <QualityGauge score={result.qualityScores.overall} size={100} label="Overall" />
          <QualityGauge score={result.qualityScores.security} label="Security" />
          <QualityGauge score={result.qualityScores.performance} label="Performance" />
          <QualityGauge score={result.qualityScores.maintainability} label="Maintainability" />
          <QualityGauge score={result.qualityScores.bestPractices} label="Best Practices" />
        </div>
      </div>
    </div>
  );
}
