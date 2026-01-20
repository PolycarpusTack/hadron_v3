import { useState, useEffect, useRef } from "react";
import {
  Code,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Shield,
  Zap,
  BookOpen,
  Lightbulb,
  ExternalLink,
  Trash2,
  FileCode,
  Upload,
} from "lucide-react";
import type {
  CodeAnalysisResult,
  CodeAnalyzerTab,
  CodeIssue,
  WalkthroughSection,
  CodeQualityScores,
  GlossaryTerm,
  CodeInput,
} from "../types";
import logger from "../services/logger";

// ============================================================================
// Props Interface
// ============================================================================

interface CodeAnalyzerViewProps {
  onAnalyze: (code: string, filename: string, language: string) => Promise<CodeAnalysisResult>;
  isAnalyzing: boolean;
  analysisResult: CodeAnalysisResult | null;
  codeInput: CodeInput | null;
  activeTab: CodeAnalyzerTab;
  onTabChange: (tab: CodeAnalyzerTab) => void;
  onSetInput: (input: CodeInput) => void;
  onClear: () => void;
}

// ============================================================================
// Language Detection
// ============================================================================

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  sql: "SQL",
  tsx: "React",
  jsx: "React",
  ts: "TypeScript",
  js: "JavaScript",
  st: "Smalltalk",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  md: "Markdown",
  rb: "Ruby",
};

function detectLanguage(code: string, filename: string): string {
  // Check file extension first
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && LANGUAGE_EXTENSIONS[ext]) {
    return LANGUAGE_EXTENSIONS[ext];
  }

  // Pattern-based detection
  if (/SELECT\s+.+\s+FROM\s+/i.test(code)) return "SQL";
  if (/import\s+React|from\s+['"]react['"]/i.test(code)) return "React";
  if (/def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/i.test(code)) return "Python";
  if (/\|\s*\w+\s*\||\w+\s*>>\s*\w+|ifTrue:|ifFalse:/i.test(code)) return "Smalltalk";
  if (/fn\s+\w+|let\s+mut|impl\s+/i.test(code)) return "Rust";
  if (/func\s+\w+|package\s+main/i.test(code)) return "Go";
  if (/<\w+[^>]*>|<\/\w+>/i.test(code)) return "XML";

  return "Plaintext";
}

// ============================================================================
// Sub-Components
// ============================================================================

// Severity Badge
function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[severity] || colors.medium}`}>
      {severity.toUpperCase()}
    </span>
  );
}

// Category Badge
function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    security: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    performance: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    "best-practice": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  const labels: Record<string, string> = {
    security: "Security",
    performance: "Performance",
    error: "Error",
    "best-practice": "Best Practice",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[category] || colors["best-practice"]}`}>
      {labels[category] || category}
    </span>
  );
}

// Quality Gauge
function QualityGauge({ score, label }: { score: number; label: string }) {
  const getColor = (s: number) => {
    if (s >= 70) return "text-green-500";
    if (s >= 50) return "text-yellow-500";
    return "text-red-500";
  };

  const getBgColor = (s: number) => {
    if (s >= 70) return "stroke-green-500";
    if (s >= 50) return "stroke-yellow-500";
    return "stroke-red-500";
  };

  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90">
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-gray-200 dark:text-gray-700"
          />
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className={getBgColor(score)}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-bold ${getColor(score)}`}>{score}</span>
        </div>
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 mt-1">{label}</span>
    </div>
  );
}

// ============================================================================
// Tab Components
// ============================================================================

// Overview Tab
function OverviewTab({
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

// Walkthrough Tab
function WalkthroughTab({ sections }: { sections: WalkthroughSection[] }) {
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

// Issues Tab
function IssuesTab({
  issues,
  highlightIssueId,
}: {
  issues: CodeIssue[];
  highlightIssueId?: number;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set(highlightIssueId ? [highlightIssueId] : []));
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const toggleIssue = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyFix = (issue: CodeIssue) => {
    navigator.clipboard.writeText(issue.fix);
    setCopied(issue.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredIssues = issues.filter((issue) => {
    if (severityFilter && issue.severity !== severityFilter) return false;
    if (categoryFilter && issue.category !== categoryFilter) return false;
    return true;
  });

  // Sort by severity
  const sortedIssues = [...filteredIssues].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Severity:</span>
          <select
            value={severityFilter || ""}
            onChange={(e) => setSeverityFilter(e.target.value || null)}
            className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
          >
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Category:</span>
          <select
            value={categoryFilter || ""}
            onChange={(e) => setCategoryFilter(e.target.value || null)}
            className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
          >
            <option value="">All</option>
            <option value="security">Security</option>
            <option value="performance">Performance</option>
            <option value="error">Error</option>
            <option value="best-practice">Best Practice</option>
          </select>
        </div>
      </div>

      {/* Issues */}
      {sortedIssues.map((issue) => (
        <div key={issue.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div
            onClick={() => toggleIssue(issue.id)}
            className={`px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center justify-between ${
              issue.severity === "critical"
                ? "bg-red-50 dark:bg-red-900/20"
                : issue.severity === "high"
                ? "bg-orange-50 dark:bg-orange-900/20"
                : "bg-white dark:bg-gray-800"
            }`}
          >
            <div className="flex items-center gap-3">
              {issue.severity === "critical" ? (
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              )}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{issue.title}</span>
                  <SeverityBadge severity={issue.severity} />
                  <CategoryBadge category={issue.category} />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Line {issue.line}</p>
              </div>
            </div>
            {expanded.has(issue.id) ? (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-gray-400" />
            )}
          </div>

          {expanded.has(issue.id) && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-4">
              {/* Description */}
              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4">
                <h4 className="font-medium text-violet-800 dark:text-violet-300 mb-2 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" />
                  What's Wrong
                </h4>
                <p className="text-gray-700 dark:text-gray-300">{issue.description}</p>
              </div>

              {/* Technical Details */}
              <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2">Technical Details</h4>
                <p className="text-gray-600 dark:text-gray-400 text-sm font-mono">{issue.technical}</p>
              </div>

              {/* Suggested Fix */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-green-800 dark:text-green-300 flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Suggested Fix
                  </h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyFix(issue);
                    }}
                    className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
                  >
                    {copied === issue.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied === issue.id ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="text-sm text-green-800 dark:text-green-300 font-mono bg-green-100 dark:bg-green-900/30 p-3 rounded overflow-x-auto">
                  {issue.fix}
                </pre>
              </div>

              {/* Complexity & Impact */}
              <div className="flex gap-4">
                <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <span className="text-xs text-blue-600 dark:text-blue-400">Complexity</span>
                  <p className="font-medium text-blue-800 dark:text-blue-300">{issue.complexity}</p>
                </div>
                {issue.impact && (
                  <div className="flex-1 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                    <span className="text-xs text-orange-600 dark:text-orange-400">Real-World Impact</span>
                    <p className="font-medium text-orange-800 dark:text-orange-300">{issue.impact}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {sortedIssues.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No issues match the current filters.
        </div>
      )}
    </div>
  );
}

// Optimized Tab
function OptimizedTab({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!code) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No optimized code available for this analysis.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Improvements Made */}
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
        <h3 className="font-semibold text-green-800 dark:text-green-300 mb-3 flex items-center gap-2">
          <Check className="w-5 h-5" />
          Improvements Applied
        </h3>
        <div className="flex flex-wrap gap-2">
          <span className="px-2 py-1 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded text-sm flex items-center gap-1">
            <Shield className="w-4 h-4" /> Security
          </span>
          <span className="px-2 py-1 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded text-sm flex items-center gap-1">
            <Zap className="w-4 h-4" /> Performance
          </span>
          <span className="px-2 py-1 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded text-sm flex items-center gap-1">
            <Check className="w-4 h-4" /> Best Practices
          </span>
        </div>
      </div>

      {/* Optimized Code */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
          <span className="text-gray-300 text-sm font-mono">optimized_code</span>
          <button
            onClick={copyCode}
            className="text-gray-400 hover:text-white flex items-center gap-1 text-sm"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? " Copied!" : " Copy"}
          </button>
        </div>
        <pre className="p-4 text-sm text-green-400 font-mono overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>
    </div>
  );
}

// Quality Tab
function QualityTab({ scores, issues }: { scores: CodeQualityScores; issues: CodeIssue[] }) {
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

      {/* Issue Breakdown */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Issue Breakdown</h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{issuesBySeverity.critical}</div>
            <p className="text-sm text-red-700 dark:text-red-400">Critical</p>
          </div>
          <div className="text-center p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{issuesBySeverity.high}</div>
            <p className="text-sm text-orange-700 dark:text-orange-400">High</p>
          </div>
          <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{issuesBySeverity.medium}</div>
            <p className="text-sm text-yellow-700 dark:text-yellow-400">Medium</p>
          </div>
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{issuesBySeverity.low}</div>
            <p className="text-sm text-blue-700 dark:text-blue-400">Low</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Learn Tab
function LearnTab({ glossary }: { glossary: GlossaryTerm[] }) {
  return (
    <div className="space-y-6">
      {/* Glossary */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Glossary
        </h3>
        <div className="space-y-3">
          {glossary.map((item, idx) => (
            <div key={idx} className="border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0">
              <dt className="font-medium text-gray-800 dark:text-gray-200">{item.term}</dt>
              <dd className="text-sm text-gray-600 dark:text-gray-400 mt-1">{item.definition}</dd>
            </div>
          ))}
        </div>
      </div>

      {/* Next Steps */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-4 flex items-center gap-2">
          <Lightbulb className="w-5 h-5" />
          Next Steps
        </h3>
        <ul className="space-y-2 text-sm text-blue-700 dark:text-blue-400">
          <li>1. Review and address Critical and High severity issues first</li>
          <li>2. Apply the optimized code suggestions after testing</li>
          <li>3. Add unit tests covering the identified edge cases</li>
          <li>4. Consider the walkthrough notes for code documentation</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function CodeAnalyzerView({
  onAnalyze,
  isAnalyzing,
  analysisResult,
  codeInput,
  activeTab,
  onTabChange,
  onSetInput,
  onClear,
}: CodeAnalyzerViewProps) {
  const [input, setInput] = useState("");
  const [filename, setFilename] = useState("code.txt");
  const [language, setLanguage] = useState("Auto-detect");
  const [highlightIssueId, setHighlightIssueId] = useState<number | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore input if we have it in state
  useEffect(() => {
    if (codeInput) {
      setInput(codeInput.content);
      setFilename(codeInput.filename);
      setLanguage(codeInput.language);
    }
  }, [codeInput]);

  const handleAnalyze = async () => {
    if (!input.trim()) return;

    const detectedLang = language === "Auto-detect" ? detectLanguage(input, filename) : language;
    onSetInput({ content: input, filename, language: detectedLang });

    try {
      await onAnalyze(input, filename, detectedLang);
    } catch (error) {
      logger.error("Code analysis failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleClear = () => {
    setInput("");
    setFilename("code.txt");
    setLanguage("Auto-detect");
    onClear();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setInput(content);
        setFilename(file.name);
        setLanguage(detectLanguage(content, file.name));
      };
      reader.readAsText(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setInput(content);
        setFilename(file.name);
        setLanguage(detectLanguage(content, file.name));
      };
      reader.readAsText(file);
    }
  };

  const navigateToIssue = (issueId: number) => {
    setHighlightIssueId(issueId);
    onTabChange("issues");
  };

  const tabs: { id: CodeAnalyzerTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "walkthrough", label: "Walkthrough" },
    { id: "issues", label: `Issues${analysisResult ? ` (${analysisResult.issues.length})` : ""}` },
    { id: "optimized", label: "Optimized" },
    { id: "quality", label: "Quality" },
    { id: "learn", label: "Learn" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-violet-500/10 rounded-lg">
            <Code className="w-6 h-6 text-violet-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Code Analyzer</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Analyze code for issues, get walkthroughs, and learn best practices
            </p>
          </div>
        </div>
      </div>

      {/* Input Section (only show if no result) */}
      {!analysisResult && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <label className="block text-sm font-medium">Paste or drop your code:</label>
            <div className="flex items-center gap-2">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="px-3 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded text-sm"
              >
                <option>Auto-detect</option>
                <option>SQL</option>
                <option>React</option>
                <option>TypeScript</option>
                <option>JavaScript</option>
                <option>Smalltalk</option>
                <option>Python</option>
                <option>Rust</option>
                <option>Go</option>
                <option>XML</option>
                <option>Plaintext</option>
              </select>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="filename.ext"
                className="px-3 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono w-40"
              />
            </div>
          </div>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="relative"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste code here, or drag & drop a file..."
              className="w-full h-64 px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none font-mono text-sm"
              disabled={isAnalyzing}
            />
            {!input && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-gray-400">
                  <Upload className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">Drop a file here or paste code above</p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleAnalyze}
              disabled={!input.trim() || isAnalyzing}
              className="flex items-center gap-2 px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition"
            >
              {isAnalyzing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <FileCode className="w-4 h-4" />
                  Analyze Code
                </>
              )}
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isAnalyzing}
              className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Browse
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              accept=".sql,.tsx,.jsx,.ts,.js,.st,.py,.rs,.go,.java,.xml,.html,.css,.json,.yaml,.yml,.md,.rb,.txt"
            />

            <button
              onClick={handleClear}
              disabled={isAnalyzing}
              className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Results Section */}
      {analysisResult && (
        <>
          {/* Action Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Analyzed: <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{codeInput?.filename}</span>
              </span>
              <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 rounded text-xs">
                {codeInput?.language}
              </span>
            </div>
            <button
              onClick={handleClear}
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              New Analysis
            </button>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-violet-600 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20"
                      : "border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6 max-h-[600px] overflow-y-auto">
              {activeTab === "overview" && (
                <OverviewTab result={analysisResult} onNavigateToIssue={navigateToIssue} />
              )}
              {activeTab === "walkthrough" && <WalkthroughTab sections={analysisResult.walkthrough} />}
              {activeTab === "issues" && (
                <IssuesTab issues={analysisResult.issues} highlightIssueId={highlightIssueId} />
              )}
              {activeTab === "optimized" && (
                <OptimizedTab code={analysisResult.optimizedCode} />
              )}
              {activeTab === "quality" && (
                <QualityTab scores={analysisResult.qualityScores} issues={analysisResult.issues} />
              )}
              {activeTab === "learn" && <LearnTab glossary={analysisResult.glossary} />}
            </div>
          </div>
        </>
      )}

      {/* Tips (only show when no input) */}
      {!input && !analysisResult && (
        <div className="bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4">
          <h4 className="font-semibold mb-2 text-sm">Supported Languages:</h4>
          <div className="flex flex-wrap gap-2">
            {["SQL", "React/TSX", "TypeScript", "JavaScript", "Smalltalk", "Python", "Rust", "Go", "XML"].map((lang) => (
              <span key={lang} className="px-2 py-1 bg-white dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400">
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
