/**
 * Release Notes Compliance Checker
 * On-demand style guide validation with inline fix suggestions and screenshot placement hints.
 */

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronUp,
  Loader2,
  Check,
  Type,
  ListChecks,
} from "lucide-react";
import Button from "../ui/Button";
import { checkCompliance } from "../../services/release-notes";
import type {
  ComplianceReport,
  TerminologyViolation,
  StructureViolation,
  ScreenshotSuggestion,
} from "../../types";
import logger from "../../services/logger";

interface Props {
  content: string;
  onContentChange: (content: string) => void;
}

export default function ReleaseNotesCompliance({ content, onContentChange }: Props) {
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<Set<string>>(new Set());
  const [insertedScreenshots, setInsertedScreenshots] = useState<Set<string>>(new Set());

  // Collapsible sections
  const [showTerminology, setShowTerminology] = useState(true);
  const [showStructure, setShowStructure] = useState(true);
  const [showScreenshots, setShowScreenshots] = useState(true);

  const handleCheck = useCallback(async () => {
    if (!content.trim()) {
      setError("No content to check. Write or generate release notes first.");
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    setAppliedFixes(new Set());
    setInsertedScreenshots(new Set());

    try {
      const result = await checkCompliance(content);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      logger.error("Compliance check failed", { error: err });
    } finally {
      setLoading(false);
    }
  }, [content]);

  const handleApplyFix = useCallback(
    (violation: TerminologyViolation | StructureViolation, key: string) => {
      const searchText = "lineContext" in violation ? violation.lineContext : violation.section;
      if (!searchText) return;

      const idx = content.indexOf(searchText);
      if (idx === -1) {
        logger.warn("Could not find violation context in content", { searchText });
        return;
      }

      const updated = content.slice(0, idx) + violation.suggestedFix + content.slice(idx + searchText.length);
      onContentChange(updated);
      setAppliedFixes((prev) => new Set(prev).add(key));
    },
    [content, onContentChange],
  );

  const handleInsertScreenshot = useCallback(
    (suggestion: ScreenshotSuggestion, key: string) => {
      const placeholder = `\n\n${suggestion.inlinePlaceholder}\n`;

      // Try to find the ticket reference to insert after
      const ticketPattern = new RegExp(`\\(${suggestion.ticketKey.replace(/[-]/g, "\\-")}\\)`);
      const match = content.match(ticketPattern);

      let updated: string;
      if (match && match.index !== undefined) {
        // Insert after the paragraph containing the ticket reference
        const afterRef = match.index + match[0].length;
        const nextNewline = content.indexOf("\n", afterRef);
        const insertPos = nextNewline !== -1 ? nextNewline : afterRef;
        updated = content.slice(0, insertPos) + placeholder + content.slice(insertPos);
      } else {
        // Fallback: append at the end
        updated = content + placeholder;
      }

      onContentChange(updated);
      setInsertedScreenshots((prev) => new Set(prev).add(key));
    },
    [content, onContentChange],
  );

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 50) return "text-amber-400";
    return "text-red-400";
  };

  const scoreBarColor = (score: number) => {
    if (score >= 80) return "bg-green-400";
    if (score >= 50) return "bg-amber-400";
    return "bg-red-400";
  };

  return (
    <div className="space-y-4">
      {/* Check Button */}
      <div className="flex items-center justify-between">
        <Button
          variant="primary"
          onClick={handleCheck}
          disabled={loading || !content.trim()}
          icon={loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        >
          {loading ? "Checking..." : "Check Compliance"}
        </Button>

        {report && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {report.tokensUsed} tokens | ${report.cost.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!report && !loading && !error && (
        <div className="text-center py-12 text-gray-500">
          <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-gray-600" />
          <p className="text-sm">
            Run a compliance check to validate your draft against the WHATS'ON style guide.
          </p>
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="space-y-4">
          {/* Score */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">Compliance Score</span>
              <span className={`text-lg font-bold ${scoreColor(report.score)}`}>
                {Math.round(report.score)}/100
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${scoreBarColor(report.score)}`}
                style={{ width: `${Math.min(report.score, 100)}%` }}
              />
            </div>
          </div>

          {/* Terminology Violations */}
          <ComplianceSection
            title="Terminology"
            icon={<Type className="w-4 h-4" />}
            count={report.terminologyViolations.length}
            open={showTerminology}
            onToggle={() => setShowTerminology(!showTerminology)}
          >
            {report.terminologyViolations.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No terminology violations found.</p>
            ) : (
              report.terminologyViolations.map((v, i) => {
                const key = `term-${i}`;
                const applied = appliedFixes.has(key);
                return (
                  <ViolationCard
                    key={key}
                    icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                    context={v.lineContext}
                    violation={v.violation}
                    suggestedFix={v.suggestedFix}
                    ruleRef={v.ruleReference}
                    applied={applied}
                    onApply={() => handleApplyFix(v, key)}
                  />
                );
              })
            )}
          </ComplianceSection>

          {/* Structure Violations */}
          <ComplianceSection
            title="Structure"
            icon={<ListChecks className="w-4 h-4" />}
            count={report.structureViolations.length}
            open={showStructure}
            onToggle={() => setShowStructure(!showStructure)}
          >
            {report.structureViolations.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No structure violations found.</p>
            ) : (
              report.structureViolations.map((v, i) => {
                const key = `struct-${i}`;
                const applied = appliedFixes.has(key);
                return (
                  <ViolationCard
                    key={key}
                    icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                    context={v.section}
                    violation={v.violation}
                    suggestedFix={v.suggestedFix}
                    ruleRef={v.ruleReference}
                    applied={applied}
                    onApply={() => handleApplyFix(v, key)}
                  />
                );
              })
            )}
          </ComplianceSection>

          {/* Screenshot Suggestions */}
          <ComplianceSection
            title="Screenshots"
            icon={<Camera className="w-4 h-4" />}
            count={report.screenshotSuggestions.length}
            open={showScreenshots}
            onToggle={() => setShowScreenshots(!showScreenshots)}
          >
            {report.screenshotSuggestions.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No screenshot suggestions.</p>
            ) : (
              report.screenshotSuggestions.map((s, i) => {
                const key = `screen-${i}`;
                const inserted = insertedScreenshots.has(key);
                return (
                  <div
                    key={key}
                    className={`border border-gray-700 rounded-lg p-3 space-y-2 ${inserted ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Camera className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="text-xs font-mono text-amber-400">{s.ticketKey}</span>
                          <p className="text-sm text-gray-300 mt-0.5">{s.description}</p>
                          <p className="text-xs text-gray-500 mt-1">{s.placementHint}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleInsertScreenshot(s, key)}
                        disabled={inserted}
                        className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                      >
                        {inserted ? "Inserted" : "Insert Placeholder"}
                      </button>
                    </div>
                    <div className="bg-gray-900 rounded px-2 py-1 text-xs font-mono text-gray-400">
                      {s.inlinePlaceholder}
                    </div>
                  </div>
                );
              })
            )}
          </ComplianceSection>
        </div>
      )}
    </div>
  );
}

/** Collapsible section wrapper */
function ComplianceSection({
  title,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-gray-300">{title}</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full ${
              count === 0
                ? "bg-green-500/20 text-green-400"
                : "bg-amber-500/20 text-amber-400"
            }`}
          >
            {count}
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

/** Individual violation card with apply-fix button */
function ViolationCard({
  icon,
  context,
  violation,
  suggestedFix,
  ruleRef,
  applied,
  onApply,
}: {
  icon: React.ReactNode;
  context: string;
  violation: string;
  suggestedFix: string;
  ruleRef: string;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <div className={`border border-gray-700 rounded-lg p-3 space-y-2 ${applied ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {icon}
          <div>
            <p className="text-sm text-gray-300">{violation}</p>
            <p className="text-xs text-gray-500 mt-0.5">{ruleRef}</p>
          </div>
        </div>
        <button
          onClick={onApply}
          disabled={applied}
          className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
        >
          {applied ? (
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3" /> Applied
            </span>
          ) : (
            "Apply Fix"
          )}
        </button>
      </div>
      {!applied && (
        <>
          <div className="bg-red-500/5 border border-red-500/20 rounded px-2 py-1 text-xs font-mono text-red-400 line-through">
            {context}
          </div>
          <div className="bg-green-500/5 border border-green-500/20 rounded px-2 py-1 text-xs font-mono text-green-400">
            {suggestedFix}
          </div>
        </>
      )}
    </div>
  );
}
