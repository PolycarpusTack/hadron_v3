import { useEffect, useState } from "react";
import { api } from "../../services/api";

export function StyleGuidePanel() {
  const [content, setContent] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadGuide = async () => {
    setLoading(true);
    try {
      const guide = await api.getStyleGuide();
      setContent(guide.content);
      setIsCustom(guide.isCustom);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to load style guide" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGuide();
  }, []);

  const handleSave = async () => {
    setMessage(null);
    try {
      await api.updateStyleGuide(content);
      setIsCustom(true);
      setMessage({ type: "success", text: "Style guide saved successfully." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save style guide" });
    }
  };

  const handleReset = async () => {
    setMessage(null);
    try {
      await api.deleteStyleGuide();
      await loadGuide();
      setMessage({ type: "success", text: "Style guide reset to default." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to reset style guide" });
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">Loading style guide...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Release Notes Style Guide</h3>
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
          Define the tone, structure, and formatting rules used when generating release notes.
          Editing this content creates a custom guide; resetting restores the built-in default.
        </p>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200 focus:border-amber-500 focus:outline-none"
          placeholder="Enter style guide content..."
        />

        {/* Message */}
        {message && (
          <p
            className={`mt-3 text-sm ${
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
