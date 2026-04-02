import type { GlossaryTerm } from "../../../services/api";

export function LearnTab({
  glossary,
  hasOptimizedCode,
  criticalCount,
}: {
  glossary: GlossaryTerm[];
  hasOptimizedCode: boolean;
  criticalCount: number;
}) {
  const nextSteps: string[] = [];
  if (criticalCount > 0) {
    nextSteps.push(
      `Address ${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} first`,
    );
  }
  if (hasOptimizedCode) {
    nextSteps.push("Review the optimized code in the Optimized tab");
  }
  nextSteps.push("Review all issues by severity in the Issues tab");

  return (
    <div className="space-y-6">
      {glossary.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Glossary</h3>
          <div className="space-y-2">
            {glossary.map((g, i) => (
              <div
                key={i}
                className="rounded-md border border-slate-700 bg-slate-800/50 p-3"
              >
                <span className="font-medium text-slate-200">{g.term}</span>
                <p className="mt-1 text-sm text-slate-400">{g.definition}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Next Steps</h3>
        <ul className="space-y-2">
          {nextSteps.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-slate-400"
            >
              <span className="mt-0.5 text-blue-400">&#8226;</span>
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
