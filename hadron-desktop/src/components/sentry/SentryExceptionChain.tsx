/**
 * Sentry Exception Chain
 * Displays individual exceptions with their stacktraces in a chain view
 */

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Code } from "lucide-react";

interface SentryFrame {
  filename?: string;
  function?: string;
  lineNo?: number;
  colNo?: number;
  contextLine?: string;
  preContext?: string[];
  postContext?: string[];
  inApp?: boolean;
  module?: string;
}

interface SentryException {
  exception_type?: string;
  value?: string;
  module?: string;
  stacktrace?: {
    frames?: SentryFrame[];
  };
}

interface SentryExceptionChainProps {
  exceptions: SentryException[];
  rawStackTrace?: string;
}

export default function SentryExceptionChain({
  exceptions,
  rawStackTrace,
}: SentryExceptionChainProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    exceptions.length > 0 ? 0 : null
  );

  if (exceptions.length === 0 && !rawStackTrace) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Code className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <p>No stack trace available</p>
      </div>
    );
  }

  // Fallback to raw stack trace if no parsed exceptions
  if (exceptions.length === 0 && rawStackTrace) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto">
          {rawStackTrace}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {exceptions.map((exc, i) => {
        const isExpanded = expandedIndex === i;
        const frames = exc.stacktrace?.frames || [];
        // Reverse frames for most-recent-first display
        const displayFrames = [...frames].reverse();

        return (
          <div
            key={i}
            className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden"
          >
            {/* Exception Header */}
            <button
              onClick={() => setExpandedIndex(isExpanded ? null : i)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-800/80 transition"
            >
              <AlertCircle
                className={`w-4 h-4 flex-shrink-0 ${
                  i === 0 ? "text-red-400" : "text-orange-400"
                }`}
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-red-300">
                  {exc.exception_type || "Exception"}
                </span>
                {exc.module && (
                  <span className="text-xs text-gray-500 ml-2">
                    in {exc.module}
                  </span>
                )}
                {exc.value && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {exc.value}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-500">
                {frames.length} frame{frames.length !== 1 ? "s" : ""}
              </span>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>

            {/* Frames */}
            {isExpanded && displayFrames.length > 0 && (
              <div className="border-t border-gray-700/50">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 text-left">
                        <th className="px-4 py-1.5 font-medium w-8"></th>
                        <th className="px-2 py-1.5 font-medium">Function</th>
                        <th className="px-2 py-1.5 font-medium">File</th>
                        <th className="px-2 py-1.5 font-medium w-16">Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayFrames.map((frame, j) => (
                        <tr
                          key={j}
                          className={`border-t border-gray-800 ${
                            frame.inApp
                              ? "bg-blue-500/5"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-1.5">
                            {frame.inApp ? (
                              <span className="text-[9px] font-bold text-blue-400 bg-blue-500/20 px-1 rounded">
                                APP
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold text-gray-500 bg-gray-700/50 px-1 rounded">
                                LIB
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-gray-300">
                            {frame.function || "<unknown>"}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-gray-400 max-w-[300px] truncate">
                            {frame.filename || "?"}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-gray-500">
                            {frame.lineNo || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Chain indicator */}
      {exceptions.length > 1 && (
        <p className="text-xs text-gray-500 text-center">
          Exception chain: {exceptions.length} exceptions
          ({exceptions[0]?.exception_type || "root"} was raised first)
        </p>
      )}
    </div>
  );
}
