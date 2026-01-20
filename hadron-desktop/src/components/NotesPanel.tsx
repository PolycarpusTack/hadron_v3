/**
 * NotesPanel - Panel for managing notes on an analysis
 */

import { useState, useEffect, useCallback, memo } from "react";
import { MessageSquare, Plus, Edit2, Trash2, Save, X } from "lucide-react";
import { format } from "date-fns";
import {
  getNotesForAnalysis,
  addNoteToAnalysis,
  updateNote,
  deleteNote,
} from "../services/api";
import type { AnalysisNote } from "../types";
import logger from "../services/logger";

interface NotesPanelProps {
  analysisId: number;
  onNotesChange?: (count: number) => void;
}

export const NotesPanel = memo(function NotesPanel({
  analysisId,
  onNotesChange,
}: NotesPanelProps) {
  const [notes, setNotes] = useState<AnalysisNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Load notes on mount
  useEffect(() => {
    loadNotes();
  }, [analysisId]);

  const loadNotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getNotesForAnalysis(analysisId);
      setNotes(data);
      onNotesChange?.(data.length);
    } catch (err) {
      logger.error("Failed to load notes", { analysisId, error: err });
      setError("Failed to load notes");
    } finally {
      setLoading(false);
    }
  };

  // Add a new note
  const handleAddNote = useCallback(async () => {
    if (!newNoteContent.trim()) return;

    setSaving(true);
    try {
      const note = await addNoteToAnalysis(analysisId, newNoteContent.trim());
      setNotes((prev) => [note, ...prev]);
      setNewNoteContent("");
      setIsAdding(false);
      onNotesChange?.(notes.length + 1);
    } catch (err) {
      logger.error("Failed to add note", { analysisId, error: err });
      setError("Failed to add note");
    } finally {
      setSaving(false);
    }
  }, [analysisId, newNoteContent, notes.length, onNotesChange]);

  // Start editing a note
  const startEdit = useCallback((note: AnalysisNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  }, []);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  // Save edited note
  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editContent.trim()) return;

    setSaving(true);
    try {
      const updated = await updateNote(editingId, editContent.trim());
      setNotes((prev) =>
        prev.map((n) => (n.id === editingId ? updated : n))
      );
      setEditingId(null);
      setEditContent("");
    } catch (err) {
      logger.error("Failed to update note", { noteId: editingId, error: err });
      setError("Failed to update note");
    } finally {
      setSaving(false);
    }
  }, [editingId, editContent]);

  // Delete a note
  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("Delete this note?")) return;

      try {
        await deleteNote(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        onNotesChange?.(notes.length - 1);
      } catch (err) {
        logger.error("Failed to delete note", { noteId: id, error: err });
        setError("Failed to delete note");
      }
    },
    [notes.length, onNotesChange]
  );

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-400">
        Loading notes...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold">Notes ({notes.length})</h3>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-2 py-1 text-sm rounded
                     bg-blue-600 hover:bg-blue-500 transition"
          >
            <Plus className="w-4 h-4" />
            Add Note
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="p-2 text-sm text-red-400 bg-red-500/10 rounded border border-red-500/20">
          {error}
        </div>
      )}

      {/* Add note form */}
      {isAdding && (
        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <textarea
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            placeholder="Add a note..."
            rows={3}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2
                     focus:outline-none focus:border-blue-500 resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewNoteContent("");
              }}
              className="px-3 py-1 text-sm text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAddNote}
              disabled={!newNoteContent.trim() || saving}
              className="flex items-center gap-1 px-3 py-1 text-sm rounded
                       bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                       disabled:cursor-not-allowed transition"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="p-6 text-center text-gray-500 bg-gray-800/30 rounded-lg">
          No notes yet. Add one to keep track of important details!
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="p-3 bg-gray-800/50 rounded-lg border border-gray-700"
            >
              {editingId === note.id ? (
                // Edit mode
                <div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2
                             focus:outline-none focus:border-blue-500 resize-none"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1 text-sm text-gray-400 hover:text-white transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editContent.trim() || saving}
                      className="flex items-center gap-1 px-3 py-1 text-sm rounded
                               bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                               disabled:cursor-not-allowed transition"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <div>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">
                    {note.content}
                  </p>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
                    <span className="text-xs text-gray-500">
                      {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      {note.updatedAt && (
                        <span className="ml-1 text-gray-600">
                          (edited {format(new Date(note.updatedAt), "MMM d")})
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(note)}
                        className="p-1 text-gray-400 hover:text-blue-400 transition"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(note.id)}
                        className="p-1 text-gray-400 hover:text-red-400 transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default NotesPanel;
