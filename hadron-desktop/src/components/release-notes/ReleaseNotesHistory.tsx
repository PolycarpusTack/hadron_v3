/**
 * Release Notes History
 * Draft list with status badges, version chain, quick actions, filters.
 */

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Trash2,
  Loader2,
  RefreshCw,
  Filter,
  ExternalLink,
} from "lucide-react";
import {
  listReleaseNotes,
  deleteReleaseNotes,
} from "../../services/release-notes";
import type { ReleaseNotesSummary, ReleaseNotesStatus } from "../../types";
import logger from "../../services/logger";

interface Props {
  onOpenDraft: (id: number) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  in_review: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  approved: "bg-green-500/20 text-green-400 border-green-500/30",
  published: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  archived: "bg-gray-500/20 text-gray-500 border-gray-500/30",
};

export default function ReleaseNotesHistory({ onOpenDraft }: Props) {
  const [drafts, setDrafts] = useState<ReleaseNotesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [deleting, setDeleting] = useState<number | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listReleaseNotes(statusFilter || undefined);
      setDrafts(result);
    } catch (err) {
      logger.error("Failed to load release notes history", { error: err });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const handleDelete = useCallback(
    async (id: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("Delete this release notes draft?")) return;

      setDeleting(id);
      try {
        await deleteReleaseNotes(id);
        setDrafts((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        logger.error("Failed to delete release notes", { id, error: err });
      } finally {
        setDeleting(null);
      }
    },
    [],
  );

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:border-amber-400 outline-none"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <button
          onClick={loadDrafts}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-md transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* List */}
      {loading && drafts.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
          <span className="ml-2 text-gray-400 text-sm">Loading history...</span>
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No release notes found.</p>
          <p className="text-xs text-gray-600 mt-1">
            Generate your first release notes from the Generate tab.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => (
            <button
              key={draft.id}
              onClick={() => onOpenDraft(draft.id)}
              className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:bg-gray-800 hover:border-gray-600 transition-colors text-left group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-white truncate">
                      {draft.title}
                    </h4>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        STATUS_COLORS[draft.status] || STATUS_COLORS.draft
                      }`}
                    >
                      {draft.status.replace("_", " ")}
                    </span>
                    {draft.isManualEdit && (
                      <span className="text-[10px] text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                        edited
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{draft.fixVersion}</span>
                    <span>{draft.contentType}</span>
                    <span>{draft.ticketCount} tickets</span>
                    <span>v{draft.version}</span>
                    <span>{draft.aiModel}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    Created {formatDate(draft.createdAt)}
                    {draft.updatedAt !== draft.createdAt &&
                      ` | Updated ${formatDate(draft.updatedAt)}`}
                  </p>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-3">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDraft(draft.id);
                    }}
                    className="p-1.5 text-gray-500 hover:text-amber-400 rounded-md hover:bg-gray-700"
                    title="Open"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                  <span
                    onClick={(e) => handleDelete(draft.id, e)}
                    className="p-1.5 text-gray-500 hover:text-red-400 rounded-md hover:bg-gray-700"
                    title="Delete"
                  >
                    {deleting === draft.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
