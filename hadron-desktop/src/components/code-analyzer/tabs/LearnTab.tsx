import { BookOpen, Lightbulb } from "lucide-react";
import type { GlossaryTerm } from "../../../types";

export default function LearnTab({
  glossary,
  hasOptimizedCode,
  criticalCount,
}: {
  glossary: GlossaryTerm[];
  hasOptimizedCode: boolean;
  criticalCount: number;
}) {
  const steps: string[] = [];
  if (criticalCount > 0) {
    steps.push(`Address the ${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} first — they represent the highest risk`);
  }
  steps.push("Review all High and Medium severity issues in the Issues tab");
  if (hasOptimizedCode) {
    steps.push("Apply the optimized code suggestions after reviewing and testing the changes");
  }
  steps.push("Add unit tests covering the edge cases identified in the walkthrough");
  steps.push("Use the walkthrough notes as a starting point for inline code documentation");

  return (
    <div className="space-y-6">
      {/* Glossary */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Glossary
        </h3>
        <div className="space-y-3">
          {glossary.length > 0 ? (
            glossary.map((item, idx) => (
              <div key={idx} className="border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0">
                <dt className="font-medium text-gray-800 dark:text-gray-200">{item.term}</dt>
                <dd className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.definition}</dd>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No glossary terms identified for this code.</p>
          )}
        </div>
      </div>

      {/* Next Steps */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-4 flex items-center gap-2">
          <Lightbulb className="w-5 h-5" />
          Next Steps
        </h3>
        <ol className="space-y-2 text-sm text-blue-700 dark:text-blue-400 list-none">
          {steps.map((step, idx) => (
            <li key={idx}>{idx + 1}. {step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
