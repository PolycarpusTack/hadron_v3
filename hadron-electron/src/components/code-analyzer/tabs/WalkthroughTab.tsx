import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  ExternalLink,
  Lightbulb,
  Zap,
} from "lucide-react";
import type { WalkthroughSection } from "../../../types";

export default function WalkthroughTab({ sections }: { sections: WalkthroughSection[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleSection = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
        <h3 className="font-semibold text-indigo-800 dark:text-indigo-300 mb-2 flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Line-by-Line Code Walkthrough
        </h3>
        <p className="text-indigo-700 dark:text-indigo-400 text-sm">
          A detailed explanation of each code section for knowledge transfer and onboarding.
        </p>
      </div>

      {/* Sections */}
      {sections.map((section, idx) => (
        <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800">
          {/* Section Header */}
          <div
            onClick={() => toggleSection(idx)}
            className="px-5 py-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-mono font-medium">
                Lines {section.lines}
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{section.title}</span>
            </div>
            {expanded.has(idx) ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
          </div>

          {/* Section Content */}
          {expanded.has(idx) && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              {/* Code Snippet */}
              <div className="bg-gray-900 p-4">
                <pre className="text-sm text-green-400 font-mono overflow-x-auto whitespace-pre-wrap">
                  {section.code}
                </pre>
              </div>

              <div className="p-5 space-y-4">
                {/* What It Does */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" />
                    What It Does
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300">{section.whatItDoes}</p>
                </div>

                {/* Why It Matters */}
                <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4">
                  <h4 className="font-medium text-violet-800 dark:text-violet-300 mb-2 flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Why It Matters
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300">{section.whyItMatters}</p>
                </div>

                {/* Evidence */}
                <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                  <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2">Evidence from Code</h4>
                  <p className="text-gray-600 dark:text-gray-400 text-sm font-mono">{section.evidence}</p>
                </div>

                {/* Dependencies */}
                {section.dependencies.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <h4 className="font-medium text-amber-800 dark:text-amber-300 mb-3 flex items-center gap-2">
                      <ExternalLink className="w-4 h-4" />
                      External Dependencies
                    </h4>
                    <div className="space-y-2">
                      {section.dependencies.map((dep, di) => (
                        <div key={di} className="flex items-start gap-2 text-sm">
                          <span className="px-2 py-0.5 bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 rounded font-mono text-xs">
                            {dep.type}
                          </span>
                          <span className="font-medium text-amber-900 dark:text-amber-300">{dep.name}</span>
                          <span className="text-amber-700 dark:text-amber-400">- {dep.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Impact */}
                <div
                  className={`rounded-lg p-4 ${
                    section.impact.includes("CRITICAL") || section.impact.includes("CRASH") || section.impact.includes("BUG")
                      ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                      : "bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800"
                  }`}
                >
                  <h4
                    className={`font-medium mb-2 flex items-center gap-2 ${
                      section.impact.includes("CRITICAL") || section.impact.includes("CRASH") || section.impact.includes("BUG")
                        ? "text-red-800 dark:text-red-300"
                        : "text-orange-800 dark:text-orange-300"
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Impact if Altered/Removed
                  </h4>
                  <p
                    className={`text-sm ${
                      section.impact.includes("CRITICAL") || section.impact.includes("CRASH") || section.impact.includes("BUG")
                        ? "text-red-700 dark:text-red-400"
                        : "text-orange-700 dark:text-orange-400"
                    }`}
                  >
                    {section.impact}
                  </p>
                </div>

                {/* Two columns: Testability & Quality */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <h4 className="font-medium text-green-800 dark:text-green-300 mb-2 flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      Testability
                    </h4>
                    <p className="text-green-700 dark:text-green-400 text-sm">{section.testability}</p>
                  </div>

                  <div
                    className={`rounded-lg p-4 ${
                      section.quality.includes("CRITICAL") || section.quality.includes("FLAW")
                        ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                        : "bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600"
                    }`}
                  >
                    <h4
                      className={`font-medium mb-2 flex items-center gap-2 ${
                        section.quality.includes("CRITICAL") || section.quality.includes("FLAW")
                          ? "text-red-800 dark:text-red-300"
                          : "text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      <Code className="w-4 h-4" />
                      Code Quality
                    </h4>
                    <p
                      className={`text-sm ${
                        section.quality.includes("CRITICAL") || section.quality.includes("FLAW")
                          ? "text-red-700 dark:text-red-400"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {section.quality}
                    </p>
                  </div>
                </div>

                {/* ELI5 */}
                <div className="bg-gradient-to-r from-pink-50 to-purple-50 dark:from-pink-900/20 dark:to-purple-900/20 border border-pink-200 dark:border-pink-800 rounded-lg p-4">
                  <h4 className="font-medium text-pink-800 dark:text-pink-300 mb-2 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" />
                    ELI5 (Explain Like I'm 5)
                  </h4>
                  <p className="text-pink-700 dark:text-pink-400 text-sm italic">{section.eli5}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Disclaimer */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        <h4 className="font-medium text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Disclaimer
        </h4>
        <p className="text-amber-700 dark:text-amber-400 text-sm">
          This walkthrough was generated by AI. It is intended as a starting point for human review, not a final
          authority. All technical claims must be validated by qualified engineers.
        </p>
      </div>
    </div>
  );
}
