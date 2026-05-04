import { AlertTriangle, AlertCircle, Info, AlertOctagon } from "lucide-react";
import type { SystemWarning } from "../../types";
import { getWarningSeverityColor } from "../../utils/whatsOnParser";

interface SystemWarningsWidgetProps {
  warnings: SystemWarning[];
}

export default function SystemWarningsWidget({ warnings }: SystemWarningsWidgetProps) {
  if (!warnings || warnings.length === 0) return null;

  const getWarningIcon = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return <AlertOctagon className="w-5 h-5" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5" />;
      case "info":
        return <Info className="w-5 h-5" />;
      default:
        return <AlertCircle className="w-5 h-5" />;
    }
  };

  const getSeverityBgColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return "bg-red-500/10 border-red-500/30";
      case "warning":
        return "bg-yellow-500/10 border-yellow-500/30";
      case "info":
        return "bg-blue-500/10 border-blue-500/30";
      default:
        return "bg-gray-500/10 border-gray-500/30";
    }
  };

  // Sort warnings by severity (critical first)
  const sortedWarnings = [...warnings].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });

  const criticalCount = warnings.filter((w) => w.severity === "critical").length;
  const warningCount = warnings.filter((w) => w.severity === "warning").length;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          <h3 className="text-lg font-semibold">System Warnings</h3>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-semibold">
              {criticalCount} Critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs font-semibold">
              {warningCount} Warning
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {sortedWarnings.map((warning, index) => (
          <div
            key={index}
            className={`p-4 rounded-lg border ${getSeverityBgColor(warning.severity)}`}
          >
            <div className="flex items-start gap-3">
              <div className={getWarningSeverityColor(warning.severity)}>
                {getWarningIcon(warning.severity)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{warning.title}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-700 rounded text-gray-400 capitalize">
                    {warning.source}
                  </span>
                  {warning.contributedToCrash && (
                    <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded">
                      Contributed to crash
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-300">{warning.description}</p>
                {warning.recommendation && (
                  <div className="mt-2 p-2 bg-gray-900/50 rounded text-sm">
                    <span className="text-gray-400">Recommendation: </span>
                    <span className="text-gray-200">{warning.recommendation}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
