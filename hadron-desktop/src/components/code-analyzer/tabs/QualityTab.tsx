import type { CodeQualityScores, CodeIssue } from "../../../types";

export default function QualityTab({
  scores,
  issues,
  onFilterToSeverity,
}: {
  scores: CodeQualityScores;
  issues: CodeIssue[];
  onFilterToSeverity: (severity: string) => void;
}) {
  const issuesBySeverity = {
    critical: issues.filter((i) => i.severity === "critical").length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };

  return (
    <div className="space-y-6">
      {/* Main Scores */}
      <div className="grid grid-cols-5 gap-6">
        <div className="text-center p-6 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <div
            className={`text-5xl font-bold mb-2 ${
              scores.overall >= 70 ? "text-green-600" : scores.overall >= 50 ? "text-yellow-600" : "text-red-600"
            }`}
          >
            {scores.overall}
          </div>
          <p className="text-gray-600 dark:text-gray-400">Overall</p>
        </div>

        <div className="col-span-4 grid grid-cols-2 gap-4">
          {Object.entries(scores)
            .filter(([key]) => key !== "overall")
            .map(([key, value]) => {
              const labels: Record<string, string> = {
                security: "Security",
                performance: "Performance",
                maintainability: "Maintainability",
                bestPractices: "Best Practices",
              };
              return (
                <div key={key} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{labels[key]}</span>
                    <span
                      className={`font-bold ${
                        value >= 70 ? "text-green-600" : value >= 50 ? "text-yellow-600" : "text-red-600"
                      }`}
                    >
                      {value}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full">
                    <div
                      className={`h-full rounded-full ${
                        value >= 70 ? "bg-green-500" : value >= 50 ? "bg-yellow-500" : "bg-red-500"
                      }`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Issue Breakdown — each card navigates to Issues tab filtered to that severity */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">Issue Breakdown</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Click a count to view filtered issues</p>
        <div className="grid grid-cols-4 gap-4">
          {(
            [
              { key: "critical", label: "Critical", count: issuesBySeverity.critical, bg: "bg-red-50 dark:bg-red-900/20", text: "text-red-600 dark:text-red-400", sub: "text-red-700 dark:text-red-400" },
              { key: "high",     label: "High",     count: issuesBySeverity.high,     bg: "bg-orange-50 dark:bg-orange-900/20", text: "text-orange-600 dark:text-orange-400", sub: "text-orange-700 dark:text-orange-400" },
              { key: "medium",   label: "Medium",   count: issuesBySeverity.medium,   bg: "bg-yellow-50 dark:bg-yellow-900/20", text: "text-yellow-600 dark:text-yellow-400", sub: "text-yellow-700 dark:text-yellow-400" },
              { key: "low",      label: "Low",      count: issuesBySeverity.low,      bg: "bg-blue-50 dark:bg-blue-900/20", text: "text-blue-600 dark:text-blue-400", sub: "text-blue-700 dark:text-blue-400" },
            ] as const
          ).map(({ key, label, count, bg, text, sub }) => (
            <button
              key={key}
              onClick={() => count > 0 && onFilterToSeverity(key)}
              disabled={count === 0}
              className={`text-center p-4 ${bg} rounded-lg transition ${count > 0 ? "hover:opacity-80 cursor-pointer" : "opacity-60 cursor-default"}`}
            >
              <div className={`text-2xl font-bold ${text}`}>{count}</div>
              <p className={`text-sm ${sub}`}>{label}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
