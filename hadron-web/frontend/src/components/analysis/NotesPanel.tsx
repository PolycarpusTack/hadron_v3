import { useEffect, useState } from "react";
import { api, AnalysisNote } from "../../services/api";

interface NotesPanelProps {
  analysisId: number;
}

export function NotesPanel({ analysisId }: NotesPanelProps) {
  const [notes, setNotes] = useState<AnalysisNote[]>([]);
  const [newContent, setNewContent] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getAnalysisNotes(analysisId).then(setNotes).catch(console.error);
  }, [analysisId]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    try {
      const note = await api.createNote(analysisId, newContent.trim());
      setNotes((prev) => [note, ...prev]);
      setNewContent("");
    } catch (e) {
      console.error("Failed to add note:", e);
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editContent.trim()) return;
    try {
      const updated = await api.updateNote(id, editContent.trim());
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      setEditId(null);
    } catch (e) {
      console.error("Failed to update note:", e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      console.error("Failed to delete note:", e);
    }
  };

  return (
    <div className="border-t border-slate-700 pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-slate-400 hover:text-slate-200"
      >
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
        Notes ({notes.length})
      </button>

      {expanded && (
        <div className="space-y-2">
          {/* Add note */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Add a note..."
              className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={!newContent.trim()}
              className="rounded-md bg-blue-600/20 px-2 py-1 text-xs text-blue-400 hover:bg-blue-600/30 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {/* Notes list */}
          {notes.map((note) => (
            <div
              key={note.id}
              className="rounded-md bg-slate-900/50 px-3 py-2"
            >
              {editId === note.id ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUpdate(note.id);
                      if (e.key === "Escape") setEditId(null);
                    }}
                    autoFocus
                    className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-sm text-slate-200 focus:outline-none"
                  />
                  <button
                    onClick={() => handleUpdate(note.id)}
                    className="text-xs text-green-400"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="text-xs text-slate-400"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-300">{note.content}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>{note.userName}</span>
                    <span>&middot;</span>
                    <span>
                      {new Date(note.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => {
                        setEditId(note.id);
                        setEditContent(note.content);
                      }}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
