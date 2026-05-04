import { Wrench, ChevronDown, ChevronRight, Code } from "lucide-react";
import { useState } from "react";
import type { WhatsOnSuggestedFix } from "../../types";
import { getComplexityColor, getPriorityColor } from "../../utils/whatsOnParser";

interface SuggestedFixCardProps {
  fix: WhatsOnSuggestedFix;
}

export default function SuggestedFixCard({ fix }: SuggestedFixCardProps) {
  const [expandedChanges, setExpandedChanges] = useState<Set<number>>(new Set([0]));

  const toggleChange = (index: number) => {
    const newExpanded = new Set(expandedChanges);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedChanges(newExpanded);
  };

  const getRiskColor = (risk: string) => {
    switch (risk.toLowerCase()) {
      case "low":
        return "text-green-400";
      case "medium":
        return "text-yellow-400";
      case "high":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Wrench className="w-5 h-5 text-emerald-400" />
          <h3 className="text-lg font-semibold">Suggested Fix</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-semibold ${getComplexityColor(fix.complexity)}`}>
            {fix.complexity}
          </span>
          <span className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300">
            ~{fix.estimatedEffort}
          </span>
          <span className={`text-xs ${getRiskColor(fix.riskLevel)}`}>
            {fix.riskLevel} risk
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary */}
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <p className="font-semibold text-emerald-400">{fix.summary}</p>
        </div>

        {/* Reasoning */}
        <div>
          <h4 className="text-sm font-semibold text-gray-400 mb-2">Reasoning</h4>
          <p className="text-gray-300">{fix.reasoning}</p>
        </div>

        {/* Explanation */}
        {fix.explanation && (
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-2">Detailed Explanation</h4>
            <p className="text-gray-300">{fix.explanation}</p>
          </div>
        )}

        {/* Code Changes */}
        {fix.codeChanges && fix.codeChanges.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-400 mb-3">Code Changes</h4>
            <div className="space-y-3">
              {fix.codeChanges.map((change, index) => (
                <div key={index} className="bg-gray-900 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleChange(index)}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition"
                  >
                    <div className="flex items-center gap-3">
                      {expandedChanges.has(index) ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                      <Code className="w-4 h-4 text-blue-400" />
                      <span className="font-mono text-sm">{change.file}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getPriorityColor(change.priority)}`}>
                      {change.priority}
                    </span>
                  </button>

                  {expandedChanges.has(index) && (
                    <div className="px-4 pb-4 border-t border-gray-800">
                      <p className="text-sm text-gray-300 mt-3 mb-3">{change.description}</p>

                      {change.before && (
                        <div className="mb-3">
                          <span className="text-xs text-red-400 font-semibold">Before:</span>
                          <pre className="mt-1 p-3 bg-red-500/10 border border-red-500/20 rounded text-sm font-mono overflow-x-auto">
                            <code>{change.before}</code>
                          </pre>
                        </div>
                      )}

                      {change.after && (
                        <div>
                          <span className="text-xs text-green-400 font-semibold">After:</span>
                          <pre className="mt-1 p-3 bg-green-500/10 border border-green-500/20 rounded text-sm font-mono overflow-x-auto">
                            <code>{change.after}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
