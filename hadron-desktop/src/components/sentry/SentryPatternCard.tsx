/**
 * Sentry Pattern Card
 * Rich display for detected patterns with evidence and remediation guidance
 */

import { AlertTriangle, Zap, Database, MemoryStick, AlertCircle, Brain, Shield } from "lucide-react";

interface DetectedPattern {
  patternType: string;
  confidence: number;
  evidence: string[];
}

interface SentryPatternCardProps {
  patterns: DetectedPattern[];
  aiPatternType?: string;
  aiSeverity?: string;
  aiComponent?: string;
  errorType?: string;
}

const PATTERN_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    borderColor: string;
    description: string;
    remediation: string[];
  }
> = {
  deadlock: {
    label: "Deadlock",
    icon: <AlertTriangle className="w-5 h-5" />,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    description:
      "Two or more operations are waiting for each other to release resources, causing a permanent block.",
    remediation: [
      "Enforce consistent lock ordering across all code paths",
      "Add lock timeout with retry logic",
      "Consider using optimistic concurrency control",
      "Review database transaction isolation levels",
    ],
  },
  n_plus_one: {
    label: "N+1 Query",
    icon: <Database className="w-5 h-5" />,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/20",
    description:
      "A query pattern where N additional queries are executed for each result of the initial query, causing performance degradation.",
    remediation: [
      "Use eager loading / joins to fetch related data in a single query",
      "Implement batch loading for collections",
      "Add query monitoring to detect regressions",
      "Consider using a DataLoader pattern for GraphQL APIs",
    ],
  },
  memory_leak: {
    label: "Memory Leak",
    icon: <MemoryStick className="w-5 h-5" />,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
    description:
      "Memory is being allocated but never released, eventually exhausting available resources.",
    remediation: [
      "Profile heap usage to identify growing allocations",
      "Check for unclosed resources (connections, streams, handles)",
      "Review event listener registration — ensure cleanup on unmount",
      "Add memory limits and circuit breakers for long-running processes",
    ],
  },
  unhandled_promise: {
    label: "Unhandled Promise",
    icon: <Zap className="w-5 h-5" />,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/20",
    description:
      "An asynchronous operation rejected but no error handler was attached to catch it.",
    remediation: [
      "Add .catch() handlers to all promises",
      "Use try/catch with async/await",
      "Add a global unhandledrejection handler for safety",
      "Review promise chains for missing error propagation",
    ],
  },
};

const DEFAULT_PATTERN = {
  label: "Unknown Pattern",
  icon: <AlertCircle className="w-5 h-5" />,
  color: "text-gray-400",
  bgColor: "bg-gray-500/10",
  borderColor: "border-gray-500/20",
  description: "A pattern was detected but its type is not recognized.",
  remediation: ["Review the evidence below for investigation clues"],
};

export default function SentryPatternCard({
  patterns,
  aiPatternType,
  aiSeverity,
  aiComponent,
  errorType,
}: SentryPatternCardProps) {
  const hasAutomatedPatterns = patterns.length > 0;
  const hasAiClassification = !!aiPatternType;

  // Empty state: no patterns AND no AI classification
  if (!hasAutomatedPatterns && !hasAiClassification) {
    return (
      <div className="text-center py-8 text-gray-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <p>No patterns detected</p>
        <p className="text-xs mt-1">
          Pattern detection runs automatically for deadlocks, N+1 queries, memory leaks, and
          unhandled promises
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* AI Classification Card - always shown when aiPatternType exists */}
      {hasAiClassification && (
        <div className={`border rounded-lg overflow-hidden ${
          aiPatternType !== "generic"
            ? "bg-emerald-500/10 border-emerald-500/20"
            : "bg-blue-500/10 border-blue-500/20"
        }`}>
          <div className="px-4 py-3 flex items-center gap-3">
            <Brain className={`w-5 h-5 ${
              aiPatternType !== "generic" ? "text-emerald-400" : "text-blue-400"
            }`} />
            <div className="flex-1">
              <h4 className={`font-semibold ${
                aiPatternType !== "generic" ? "text-emerald-400" : "text-blue-400"
              }`}>
                AI Pattern Classification
              </h4>
              <p className="text-sm text-gray-300 mt-1">
                {aiPatternType !== "generic" ? (
                  <>
                    The AI analysis classified this issue as a{" "}
                    <span className="font-semibold text-emerald-300">
                      {PATTERN_CONFIG[aiPatternType]?.label || aiPatternType}
                    </span>{" "}
                    pattern.
                  </>
                ) : (
                  <>
                    The AI classified this as a <span className="font-semibold text-blue-300">general error</span> —
                    no specific recurring pattern (deadlock, N+1, memory leak, etc.) was identified.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Context details */}
          {(errorType || aiComponent || aiSeverity) && (
            <div className="px-4 py-3 border-t border-gray-700/30 flex flex-wrap gap-3 text-xs">
              {errorType && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800/50 rounded-lg">
                  <Shield className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-400">Type:</span>
                  <span className="text-gray-200 font-mono">{errorType}</span>
                </span>
              )}
              {aiComponent && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800/50 rounded-lg">
                  <span className="text-gray-400">Component:</span>
                  <span className="text-gray-200 font-mono">{aiComponent}</span>
                </span>
              )}
              {aiSeverity && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium ${
                  aiSeverity.toLowerCase() === "critical" ? "bg-red-500/20 text-red-400" :
                  aiSeverity.toLowerCase() === "high" ? "bg-orange-500/20 text-orange-400" :
                  aiSeverity.toLowerCase() === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                  "bg-blue-500/20 text-blue-400"
                }`}>
                  Severity: {aiSeverity}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Automated pattern scan summary */}
      {hasAiClassification && !hasAutomatedPatterns && (
        <div className="px-4 py-3 bg-gray-800/30 border border-gray-700/50 rounded-lg text-xs text-gray-500 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Automated pattern scan: no deadlock, N+1 query, memory leak, or unhandled promise patterns detected
        </div>
      )}

      {patterns.map((pattern, i) => {
        const config = PATTERN_CONFIG[pattern.patternType] || DEFAULT_PATTERN;
        return (
          <div
            key={i}
            className={`${config.bgColor} border ${config.borderColor} rounded-lg overflow-hidden`}
          >
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={config.color}>{config.icon}</div>
                <div>
                  <h4 className={`font-semibold ${config.color}`}>{config.label}</h4>
                  <p className="text-xs text-gray-400 mt-0.5">{config.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <span className="text-xs text-gray-500">Confidence</span>
                  <div className={`text-lg font-bold ${config.color}`}>
                    {Math.round(pattern.confidence * 100)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Evidence */}
            {pattern.evidence.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-700/30">
                <h5 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                  Evidence
                </h5>
                <ul className="space-y-1">
                  {pattern.evidence.map((ev, j) => (
                    <li key={j} className="text-xs text-gray-300 flex items-start gap-2">
                      <span className="text-gray-500 mt-0.5">-</span>
                      <span className="font-mono">{ev}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Remediation */}
            <div className="px-4 py-3 border-t border-gray-700/30 bg-gray-900/30">
              <h5 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                Recommended Actions
              </h5>
              <ol className="space-y-1.5">
                {config.remediation.map((step, j) => (
                  <li key={j} className="text-xs text-gray-300 flex items-start gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-[10px] font-bold mt-0.5">
                      {j + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        );
      })}
    </div>
  );
}
