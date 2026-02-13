/**
 * Release Notes Review
 * 12-item interactive checklist, auto-detected statuses, status workflow buttons.
 */

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  getReleaseNotes,
  updateStatus,
  updateChecklist,
} from "../../services/release-notes";
import type { ReleaseNotesDraft, ReleaseNotesChecklistItem, ReleaseNotesStatus } from "../../types";

interface Props {
  draftId: number;
}

const DEFAULT_CHECKLIST: ReleaseNotesChecklistItem[] = [
  { id: "title", label: "Title is concise and searchable", checked: false },
  { id: "label", label: "Correctly labelled as feature or bug", checked: false },
  { id: "fix_version", label: "Base fix version correctly entered", checked: false },
  { id: "ticket_linked", label: "Base ticket linked (JIRA Cloud: both sides)", checked: false },
  { id: "keywords", label: "Keywords entered (including UPGRADE if needed)", checked: false },
  { id: "admin_checkbox", label: "Administration checkbox set if applicable", checked: false },
  { id: "module", label: "WHATS'ON module entered", checked: false },
  { id: "epic_grouping", label: "In the appropriate epic", checked: false },
  { id: "epic_sentences", label: "Features adapted into sentences in epic", checked: false },
  { id: "reason", label: "Purpose of the feature/fix is clear", checked: false },
  { id: "screenshots", label: "Screenshots use deployed images (no DEV)", checked: false },
  { id: "terminology", label: "Correct WHATS'ON terminology used", checked: false },
];

const STATUS_FLOW: Record<string, { next: ReleaseNotesStatus; label: string; color: string }> = {
  draft: { next: "in_review", label: "Submit for Review", color: "bg-blue-500 hover:bg-blue-400" },
  in_review: { next: "approved", label: "Approve", color: "bg-green-500 hover:bg-green-400" },
  approved: { next: "published", label: "Publish", color: "bg-amber-500 hover:bg-amber-400" },
  published: { next: "archived", label: "Archive", color: "bg-gray-500 hover:bg-gray-400" },
};

export default function ReleaseNotesReview({ draftId }: Props) {
  const [draft, setDraft] = useState<ReleaseNotesDraft | null>(null);
  const [checklist, setChecklist] = useState<ReleaseNotesChecklistItem[]>(DEFAULT_CHECKLIST);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDraft();
  }, [draftId]);

  const loadDraft = async () => {
    setLoading(true);
    try {
      const data = await getReleaseNotes(draftId);
      if (data) {
        setDraft(data);
        if (data.checklistState) {
          try {
            const saved = JSON.parse(data.checklistState) as ReleaseNotesChecklistItem[];
            setChecklist(saved);
          } catch {
            setChecklist(DEFAULT_CHECKLIST);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleChecklistToggle = useCallback(
    async (itemId: string) => {
      const updated = checklist.map((item) =>
        item.id === itemId ? { ...item, checked: !item.checked } : item,
      );
      setChecklist(updated);

      try {
        await updateChecklist(draftId, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save checklist", err);
      }
    },
    [checklist, draftId],
  );

  const handleStatusChange = useCallback(
    async (newStatus: ReleaseNotesStatus) => {
      setUpdatingStatus(true);
      setError(null);
      try {
        await updateStatus(draftId, newStatus);
        await loadDraft();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUpdatingStatus(false);
      }
    },
    [draftId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
      </div>
    );
  }

  if (!draft) return null;

  const completedCount = checklist.filter((c) => c.checked).length;
  const progress = Math.round((completedCount / checklist.length) * 100);
  const statusAction = STATUS_FLOW[draft.status];

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Status Bar */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={draft.status} />
          <div>
            <h3 className="text-sm font-medium text-white">{draft.title}</h3>
            <p className="text-xs text-gray-500">
              Version {draft.version} | {draft.ticketCount} tickets
              {draft.reviewedBy && ` | Reviewed by ${draft.reviewedBy}`}
            </p>
          </div>
        </div>

        {statusAction && (
          <button
            onClick={() => handleStatusChange(statusAction.next)}
            disabled={updatingStatus}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${statusAction.color} disabled:opacity-50`}
          >
            {updatingStatus ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {statusAction.label}
          </button>
        )}
      </div>

      {/* Checklist */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-gray-300">Review Checklist</h4>
          <span className="text-xs text-gray-500">
            {completedCount}/{checklist.length} ({progress}%)
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-700 rounded-full h-1.5 mb-4">
          <div
            className={`h-1.5 rounded-full transition-all ${
              progress === 100 ? "bg-green-400" : "bg-amber-400"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="space-y-2">
          {checklist.map((item) => (
            <button
              key={item.id}
              onClick={() => handleChecklistToggle(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700/50 transition-colors text-left"
            >
              {item.checked ? (
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-gray-600 flex-shrink-0" />
              )}
              <span
                className={`text-sm ${
                  item.checked ? "text-gray-500 line-through" : "text-gray-300"
                }`}
              >
                {item.label}
              </span>
              {item.autoDetected && (
                <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                  Auto
                </span>
              )}
            </button>
          ))}
        </div>

        {progress < 100 && draft.status !== "draft" && (
          <div className="mt-4 flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            Some checklist items are incomplete.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-500/20 text-gray-400",
    in_review: "bg-blue-500/20 text-blue-400",
    approved: "bg-green-500/20 text-green-400",
    published: "bg-amber-500/20 text-amber-400",
    archived: "bg-gray-500/20 text-gray-500",
  };

  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${colors[status] || colors.draft}`}
    >
      {status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
    </span>
  );
}
