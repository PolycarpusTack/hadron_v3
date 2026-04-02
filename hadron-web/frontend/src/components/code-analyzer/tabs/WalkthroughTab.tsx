import { useState } from "react";
import type { WalkthroughSection } from "../../../services/api";

export function WalkthroughTab({ sections }: { sections: WalkthroughSection[] }) {
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set([0]));

  const toggle = (idx: number) => {
    setExpandedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (sections.length === 0) {
    return <div className="py-8 text-center text-slate-400">No walkthrough sections.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-indigo-800 bg-indigo-900/20 p-5">
        <h3 className="mb-2 font-semibold text-indigo-300">Line-by-Line Code Walkthrough</h3>
        <p className="text-sm text-indigo-400">
          A detailed explanation of each code section for knowledge transfer and onboarding.
        </p>
      </div>

      {/* Sections */}
      {sections.map((section, idx) => (
        <div key={idx} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
          {/* Section header */}
          <button
            onClick={() => toggle(idx)}
            className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-700/50"
          >
            <div className="flex items-center gap-3">
              {section.lines && (
                <span className="rounded-lg bg-indigo-900/50 px-2.5 py-1 font-mono text-sm font-medium text-indigo-300">
                  Lines {section.lines}
                </span>
              )}
              <span className="font-semibold text-slate-200">{section.title}</span>
            </div>
            <span className="text-slate-500">{expandedIdx.has(idx) ? "−" : "+"}</span>
          </button>

          {expandedIdx.has(idx) && (
            <div className="border-t border-slate-700">
              {/* Code snippet */}
              {section.code && (
                <div className="bg-slate-900 p-4">
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm text-green-400">
                    <code>{section.code}</code>
                  </pre>
                </div>
              )}

              <div className="space-y-4 p-5">
                {/* What It Does */}
                {section.whatItDoes && (
                  <div className="rounded-lg border border-blue-800 bg-blue-900/20 p-4">
                    <h4 className="mb-2 font-medium text-blue-300">What It Does</h4>
                    <p className="text-sm text-slate-300">{section.whatItDoes}</p>
                  </div>
                )}

                {/* Why It Matters */}
                {section.whyItMatters && (
                  <div className="rounded-lg border border-violet-800 bg-violet-900/20 p-4">
                    <h4 className="mb-2 font-medium text-violet-300">Why It Matters</h4>
                    <p className="text-sm text-slate-300">{section.whyItMatters}</p>
                  </div>
                )}

                {/* Evidence */}
                {section.evidence && (
                  <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-4">
                    <h4 className="mb-2 font-medium text-slate-200">Evidence from Code</h4>
                    <p className="font-mono text-sm text-slate-400">{section.evidence}</p>
                  </div>
                )}

                {/* Dependencies */}
                {section.dependencies.length > 0 && (
                  <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-4">
                    <h4 className="mb-3 font-medium text-amber-300">External Dependencies</h4>
                    <div className="space-y-2">
                      {section.dependencies.map((dep, di) => (
                        <div key={di} className="flex items-start gap-2 text-sm">
                          <span className="rounded bg-amber-800 px-2 py-0.5 font-mono text-xs text-amber-200">
                            {dep.type}
                          </span>
                          <span className="font-medium text-amber-300">{dep.name}</span>
                          {dep.note && (
                            <span className="text-amber-400">— {dep.note}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Impact */}
                {section.impact && (
                  <div
                    className={`rounded-lg p-4 ${
                      section.impact.includes("CRITICAL") ||
                      section.impact.includes("CRASH") ||
                      section.impact.includes("BUG")
                        ? "border border-red-800 bg-red-900/20"
                        : "border border-orange-800 bg-orange-900/20"
                    }`}
                  >
                    <h4
                      className={`mb-2 font-medium ${
                        section.impact.includes("CRITICAL") ||
                        section.impact.includes("CRASH") ||
                        section.impact.includes("BUG")
                          ? "text-red-300"
                          : "text-orange-300"
                      }`}
                    >
                      Impact if Altered/Removed
                    </h4>
                    <p
                      className={`text-sm ${
                        section.impact.includes("CRITICAL") ||
                        section.impact.includes("CRASH") ||
                        section.impact.includes("BUG")
                          ? "text-red-400"
                          : "text-orange-400"
                      }`}
                    >
                      {section.impact}
                    </p>
                  </div>
                )}

                {/* Testability & Quality — two columns */}
                <div className="grid grid-cols-2 gap-4">
                  {section.testability && (
                    <div className="rounded-lg border border-green-800 bg-green-900/20 p-4">
                      <h4 className="mb-2 font-medium text-green-300">Testability</h4>
                      <p className="text-sm text-green-400">{section.testability}</p>
                    </div>
                  )}

                  {section.quality && (
                    <div
                      className={`rounded-lg p-4 ${
                        section.quality.includes("CRITICAL") ||
                        section.quality.includes("FLAW")
                          ? "border border-red-800 bg-red-900/20"
                          : "border border-slate-600 bg-slate-700/50"
                      }`}
                    >
                      <h4
                        className={`mb-2 font-medium ${
                          section.quality.includes("CRITICAL") ||
                          section.quality.includes("FLAW")
                            ? "text-red-300"
                            : "text-slate-200"
                        }`}
                      >
                        Code Quality
                      </h4>
                      <p
                        className={`text-sm ${
                          section.quality.includes("CRITICAL") ||
                          section.quality.includes("FLAW")
                            ? "text-red-400"
                            : "text-slate-400"
                        }`}
                      >
                        {section.quality}
                      </p>
                    </div>
                  )}
                </div>

                {/* ELI5 */}
                {section.eli5 && (
                  <div className="rounded-lg border border-pink-800 bg-gradient-to-r from-pink-900/20 to-purple-900/20 p-4">
                    <h4 className="mb-2 font-medium text-pink-300">
                      ELI5 (Explain Like I'm 5)
                    </h4>
                    <p className="text-sm italic text-pink-400">{section.eli5}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Disclaimer */}
      <div className="rounded-xl border border-amber-800 bg-amber-900/20 p-4">
        <h4 className="mb-2 font-medium text-amber-300">Disclaimer</h4>
        <p className="text-sm text-amber-400">
          This walkthrough was generated by AI. It is intended as a starting point for human review,
          not a final authority. All technical claims must be validated by qualified engineers.
        </p>
      </div>
    </div>
  );
}
