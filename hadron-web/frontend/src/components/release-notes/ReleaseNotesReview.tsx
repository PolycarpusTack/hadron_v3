import { useState, useEffect } from 'react';
import { api, type ChecklistItem } from '../../services/api';

interface ReleaseNotesReviewProps {
  noteId: number;
  status: string | null;
  noteOwnerId: string;
  currentUserId: string;
  currentUserRole: string;
  onStatusChange: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-600 text-slate-200',
  in_review: 'bg-blue-600 text-blue-100',
  approved: 'bg-amber-600 text-amber-100',
  published: 'bg-green-600 text-green-100',
  archived: 'bg-slate-600 text-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  approved: 'Approved',
  published: 'Published',
  archived: 'Archived',
};

export function ReleaseNotesReview({
  noteId,
  status,
  noteOwnerId,
  currentUserId,
  currentUserRole,
  onStatusChange,
}: ReleaseNotesReviewProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOwner = currentUserId === noteOwnerId;
  const role = currentUserRole;

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getReleaseNoteChecklist(noteId)
      .then((resp) => {
        setChecklist(resp.items);
        setComplete(resp.complete);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Failed to load checklist'),
      )
      .finally(() => setLoading(false));
  }, [noteId]);

  const handleToggle = async (index: number) => {
    const updated = checklist.map((item, i) =>
      i === index ? { ...item, checked: !item.checked } : item,
    );
    setChecklist(updated);
    setComplete(updated.every((item) => item.checked));
    try {
      await api.updateReleaseNoteChecklist(noteId, updated);
    } catch {
      // Reload from server on error to get authoritative state
      try {
        const data = await api.getReleaseNoteChecklist(noteId);
        setChecklist(data.items);
        setComplete(data.complete);
      } catch (reloadErr) {
        setError(reloadErr instanceof Error ? reloadErr.message : 'Failed to sync checklist');
      }
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setError(null);
    try {
      await api.updateReleaseNoteStatus(noteId, newStatus);
      onStatusChange();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : `Failed to update status to ${newStatus}`,
      );
    }
  };

  const checkedCount = checklist.filter((item) => item.checked).length;
  const totalCount = checklist.length;
  const percentage = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  const barColor =
    percentage === 100
      ? 'bg-green-500'
      : percentage >= 50
      ? 'bg-amber-500'
      : 'bg-red-500';

  const normalizedStatus = status ?? 'draft';
  const badgeClass = STATUS_BADGE[normalizedStatus] ?? STATUS_BADGE.draft;
  const badgeLabel = STATUS_LABELS[normalizedStatus] ?? normalizedStatus;

  return (
    <div className="space-y-5">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-400">Status:</span>
        <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      {/* Checklist section */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Review Checklist</h3>
          <span className="text-xs text-slate-400">{percentage}% complete</span>
        </div>

        {/* Completion bar */}
        <div className="mb-4 h-1.5 w-full rounded-full bg-slate-700">
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {loading ? (
          <div className="py-4 text-center text-sm text-slate-400">Loading checklist...</div>
        ) : checklist.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-500">No checklist items configured.</div>
        ) : (
          <ul className="space-y-2">
            {checklist.map((item, index) => (
              <li key={index} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={`checklist-${noteId}-${index}`}
                  checked={item.checked}
                  onChange={() => handleToggle(index)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-600 bg-slate-700 accent-amber-500"
                />
                <label
                  htmlFor={`checklist-${noteId}-${index}`}
                  className={`cursor-pointer text-sm ${
                    item.checked ? 'text-slate-500 line-through' : 'text-slate-200'
                  }`}
                >
                  {item.item}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-md border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Status action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Submit for Review — owner, draft */}
        {normalizedStatus === 'draft' && isOwner && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleStatusChange('in_review')}
              disabled={!complete}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Submit for Review
            </button>
            {!complete && (
              <span className="text-xs text-slate-500">Complete all checklist items first</span>
            )}
          </div>
        )}

        {/* Approve — lead or admin, in_review */}
        {normalizedStatus === 'in_review' && (role === 'lead' || role === 'admin') && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleStatusChange('approved')}
              disabled={!complete}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve
            </button>
            {!complete && (
              <span className="text-xs text-slate-500">Complete all checklist items first</span>
            )}
          </div>
        )}

        {/* Return to Draft — owner, in_review */}
        {normalizedStatus === 'in_review' && isOwner && (
          <button
            onClick={() => handleStatusChange('draft')}
            className="rounded-md bg-slate-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-500"
          >
            Return to Draft
          </button>
        )}

        {/* Publish — admin, approved */}
        {normalizedStatus === 'approved' && role === 'admin' && (
          <button
            onClick={() => handleStatusChange('published')}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
          >
            Publish
          </button>
        )}

        {/* Archive — owner or admin, any non-archived status */}
        {normalizedStatus !== 'archived' && (isOwner || role === 'admin') && (
          <button
            onClick={() => handleStatusChange('archived')}
            className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-600"
          >
            Archive
          </button>
        )}
      </div>
    </div>
  );
}
