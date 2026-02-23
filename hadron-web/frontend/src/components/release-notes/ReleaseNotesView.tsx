import { useCallback, useEffect, useState } from "react";
import { api, type ReleaseNote, type PaginatedResponse } from "../../services/api";
import { ReleaseNoteEditor } from "./ReleaseNoteEditor";
import { useToast } from "../Toast";

export function ReleaseNotesView() {
  const toast = useToast();
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null | "new">(null);

  const limit = 20;

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const resp: PaginatedResponse<ReleaseNote> = await api.getReleaseNotes(
        limit,
        offset,
      );
      setNotes(resp.data);
      setTotal(resp.total);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to load release notes",
      );
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  if (editingId !== null) {
    return (
      <div className="mx-auto max-w-4xl">
        <ReleaseNoteEditor
          noteId={editingId === "new" ? null : editingId}
          onSaved={() => {
            setEditingId(null);
            fetchNotes();
          }}
          onCancel={() => setEditingId(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Release Notes</h2>
          <p className="text-sm text-slate-400">{total} notes</p>
        </div>
        <button
          onClick={() => setEditingId("new")}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          New Release Note
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          No release notes yet
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setEditingId(note.id)}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 transition-colors hover:border-slate-600"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">
                    {note.title}
                  </span>
                  {note.version && (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                      v{note.version}
                    </span>
                  )}
                  {note.isPublished ? (
                    <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-xs text-green-400">
                      Published
                    </span>
                  ) : (
                    <span className="rounded bg-slate-600/50 px-1.5 py-0.5 text-xs text-slate-500">
                      Draft
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {note.format} &middot; Updated{" "}
                  {new Date(note.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <span className="text-slate-500">&rsaquo;</span>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-sm text-slate-400">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
