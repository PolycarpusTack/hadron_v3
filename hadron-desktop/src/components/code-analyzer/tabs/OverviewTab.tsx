import { AlertTriangle, Lightbulb, Shield } from "lucide-react";
import type { CodeAnalysisResult } from "../../../types";
import QualityGauge from "../shared/QualityGauge";

export default function OverviewTab({
  result,
  onNavigateToIssue,
}: {
  result: CodeAnalysisResult;
  onNavigateToIssue: (issueId: number) => void;
}) {
  const criticalIssues = result.issues.filter((i) => i.severity === "critical");

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
          <Lightbulb className="w-5 h-5" />
          What This Code Does
        </h3>
        <p className="text-gray-700 dark:text-gray-300">{result.summary}</p>
      </div>

      {/* Critical Issues */}
      {criticalIssues.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl p-5">
          <h3 className="font-semibold text-red-800 dark:text-red-300 mb-3 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Critical Issues Found
          </h3>
          <div className="space-y-2">
            {criticalIssues.map((issue) => (
              <div
                key={issue.id}
                onClick={() => onNavigateToIssue(issue.id)}
                className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-800 cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/30 transition"
              >
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-red-800 dark:text-red-300">{issue.title}</span>
                    <span className="text-xs text-red-600 dark:text-red-400">Line {issue.line}</span>
                  </div>
                  <p className="text-sm text-red-700 dark:text-red-400">{issue.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quality Overview */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Quality Overview</h3>
        <div className="grid grid-cols-5 gap-4">
          <QualityGauge score={result.qualityScores.overall} label="Overall" />
          <QualityGauge score={result.qualityScores.security} label="Security" />
          <QualityGauge score={result.qualityScores.performance} label="Performance" />
          <QualityGauge score={result.qualityScores.maintainability} label="Maintainability" />
          <QualityGauge score={result.qualityScores.bestPractices} label="Best Practices" />
        </div>
      </div>
    </div>
  );
}
