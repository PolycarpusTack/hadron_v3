import { useState } from "react";
import { SeverityBadge } from "../common/SeverityBadge";
import { CreateJiraTicketDialog } from "../jira/CreateJiraTicketDialog";
import { TagSelector } from "../tags/TagSelector";
import { NotesPanel } from "./NotesPanel";
import { FeedbackButtons } from "../feedback/FeedbackButtons";
import { GoldBadge } from "../gold/GoldBadge";
import { ExportDialog } from "../export/ExportDialog";
import { api } from "../../services/api";
import { useToast } from "../Toast";
import type { Analysis } from "../../services/api";

interface AnalysisResultCardProps {
  analysis: Analysis;
  onClose?: () => void;
  showGoldActions?: boolean;
}

export function AnalysisResultCard({
  analysis,
  onClose,
  showGoldActions,
}: AnalysisResultCardProps) {
  const toast = useToast();
  const [showJira, setShowJira] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [goldStatus, setGoldStatus] = useState<string | null>(null);

  const fixes = Array.isArray(analysis.suggestedFixes)
    ? analysis.suggestedFixes
    : [];

  const handlePromoteGold = async () => {
    try {
      const gold = await api.promoteToGold(analysis.id);
      setGoldStatus(gold.verificationStatus);
      toast.success("Promoted to gold standard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to promote");
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-white">
              {analysis.filename}
            </h3>
            {goldStatus && <GoldBadge status={goldStatus} />}
          </div>
          <p className="text-sm text-slate-400">
            Analyzed {new Date(analysis.analyzedAt).toLocaleString()}
            {analysis.analysisDurationMs && (
              <span> &middot; {(analysis.analysisDurationMs / 1000).toFixed(1)}s</span>
            )}
          </p>
          {analysis.errorSignature && (
            <p className="mt-0.5 font-mono text-xs text-slate-500">
              Signature: {analysis.errorSignature.slice(0, 12)}...
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={analysis.severity} />
          {analysis.confidence && (
            <span className="rounded-md bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
              {analysis.confidence} confidence
            </span>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 text-slate-400 hover:text-slate-200"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="mb-4">
        <TagSelector analysisId={analysis.id} />
      </div>

      {/* Error Info */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        {analysis.errorType && (
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">
              Error Type
            </dt>
            <dd className="mt-1 font-mono text-sm text-red-400">
              {analysis.errorType}
            </dd>
          </div>
        )}
        {analysis.component && (
          <div>
            <dt className="text-xs font-medium uppercase text-slate-500">
              Component
            </dt>
            <dd className="mt-1 text-sm text-slate-200">
              {analysis.component}
            </dd>
          </div>
        )}
      </div>

      {analysis.errorMessage && (
        <div className="mb-4">
          <dt className="text-xs font-medium uppercase text-slate-500">
            Error Message
          </dt>
          <dd className="mt-1 text-sm text-slate-300">
            {analysis.errorMessage}
          </dd>
        </div>
      )}

      {/* Root Cause */}
      {analysis.rootCause && (
        <div className="mb-4">
          <dt className="mb-1 text-xs font-medium uppercase text-slate-500">
            Root Cause
          </dt>
          <dd className="rounded-md bg-slate-900 p-3 text-sm text-slate-200">
            {analysis.rootCause}
          </dd>
        </div>
      )}

      {/* Suggested Fixes */}
      {fixes.length > 0 && (
        <div className="mb-4">
          <dt className="mb-2 text-xs font-medium uppercase text-slate-500">
            Suggested Fixes
          </dt>
          <ol className="list-inside list-decimal space-y-1">
            {fixes.map((fix, i) => (
              <li key={i} className="text-sm text-slate-300">
                {String(fix)}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Feedback */}
      <div className="mb-4">
        <FeedbackButtons analysisId={analysis.id} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-t border-slate-700 pt-4">
        <button
          onClick={() => setShowJira(true)}
          className="rounded-md bg-blue-600/20 px-3 py-1.5 text-sm text-blue-400 transition-colors hover:bg-blue-600/30"
        >
          Create Jira Ticket
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-600"
        >
          Export
        </button>
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-600"
        >
          {showNotes ? "Hide Notes" : "Notes"}
        </button>
        {showGoldActions && !goldStatus && (
          <button
            onClick={handlePromoteGold}
            className="rounded-md bg-yellow-600/20 px-3 py-1.5 text-sm text-yellow-400 transition-colors hover:bg-yellow-600/30"
          >
            Promote to Gold
          </button>
        )}
      </div>

      {/* Notes panel (collapsible) */}
      {showNotes && (
        <div className="mt-4">
          <NotesPanel analysisId={analysis.id} />
        </div>
      )}

      {showJira && (
        <CreateJiraTicketDialog
          open={showJira}
          analysis={analysis}
          onClose={() => setShowJira(false)}
        />
      )}

      {showExport && (
        <ExportDialog
          analysisId={analysis.id}
          filename={analysis.filename}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
