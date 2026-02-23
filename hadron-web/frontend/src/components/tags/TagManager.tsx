import { useEffect, useState } from "react";
import { api, Tag } from "../../services/api";
import { useToast } from "../Toast";
import { TagBadge } from "./TagBadge";

const TAG_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];

export function TagManager() {
  const toast = useToast();
  const [tags, setTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    api.listTags().then(setTags).catch((e) => toast.error(e.message));
  }, [toast]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const tag = await api.createTag(newName.trim(), newColor);
      setTags((prev) => [...prev, tag]);
      setNewName("");
      toast.success("Tag created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create tag");
    }
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    try {
      const updated = await api.updateTag(id, { name: editName.trim() });
      setTags((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setEditId(null);
      toast.success("Tag updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update tag");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteTag(id);
      setTags((prev) => prev.filter((t) => t.id !== id));
      toast.success("Tag deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete tag");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Manage Tags</h3>

      {/* Create form */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New tag name..."
          className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
        >
          {TAG_COLORS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </div>

      {/* Tag list */}
      <div className="rounded-lg border border-slate-700 bg-slate-800">
        {tags.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No tags yet. Create one above.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Tag</th>
                <th className="px-4 py-3">Usage</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.id} className="border-b border-slate-700/50 last:border-0">
                  <td className="px-4 py-3">
                    {editId === tag.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdate(tag.id);
                          if (e.key === "Escape") setEditId(null);
                        }}
                        autoFocus
                        className="rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-sm text-slate-200 focus:outline-none"
                      />
                    ) : (
                      <TagBadge tag={tag} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {tag.usageCount} analyses
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {editId === tag.id ? (
                        <>
                          <button
                            onClick={() => handleUpdate(tag.id)}
                            className="text-xs text-green-400 hover:text-green-300"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="text-xs text-slate-400 hover:text-slate-300"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditId(tag.id);
                              setEditName(tag.name);
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(tag.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
