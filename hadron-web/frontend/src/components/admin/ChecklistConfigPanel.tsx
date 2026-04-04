import { useEffect, useState } from "react";
import { api, ChecklistConfigResponse } from "../../services/api";

export function ChecklistConfigPanel() {
  const [items, setItems] = useState<string[]>([]);
  const [isCustom, setIsCustom] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config: ChecklistConfigResponse = await api.getChecklistConfig();
      setItems(config.items);
      setIsCustom(config.isCustom);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to load checklist config" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleAddItem = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    setItems((prev) => [...prev, trimmed]);
    setNewItem("");
  };

  const handleDeleteItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setMessage(null);
    try {
      await api.updateChecklistConfig(items);
      setIsCustom(true);
      setMessage({ type: "success", text: "Checklist configuration saved." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save checklist config" });
    }
  };

  const handleReset = async () => {
    setMessage(null);
    try {
      await api.deleteChecklistConfig();
      await loadConfig();
      setMessage({ type: "success", text: "Checklist reset to default." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to reset checklist" });
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">Loading checklist configuration...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Release Notes Checklist</h3>
          {isCustom ? (
            <span className="rounded-full bg-amber-500/20 px-3 py-0.5 text-xs font-medium text-amber-400">
              Custom
            </span>
          ) : (
            <span className="rounded-full bg-slate-600/50 px-3 py-0.5 text-xs font-medium text-slate-400">
              Default
            </span>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-400">
          Manage the checklist items presented when reviewing generated release notes.
          Saving creates a custom list; resetting restores the built-in default.
        </p>

        {/* Item list */}
        <ul className="mb-4 space-y-2">
          {items.map((item, index) => (
            <li
              key={index}
              className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
            >
              <span className="text-sm text-slate-200">{item}</span>
              <button
                onClick={() => handleDeleteItem(index)}
                className="ml-3 text-red-400 hover:text-red-300 text-sm font-bold leading-none"
                aria-label="Remove item"
              >
                &times;
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-3 text-center text-sm text-slate-500">No items. Add one below.</li>
          )}
        </ul>

        {/* Item count */}
        <p className="mb-4 text-xs text-slate-500">{items.length} item{items.length !== 1 ? "s" : ""}</p>

        {/* Add item row */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
            placeholder="New checklist item..."
            className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-amber-500 focus:outline-none"
          />
          <button
            onClick={handleAddItem}
            disabled={!newItem.trim()}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* Message */}
        {message && (
          <p
            className={`mt-4 text-sm ${
              message.type === "success" ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {message.text}
          </p>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            Save
          </button>
          <button
            onClick={handleReset}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}
