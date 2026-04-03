import { useEffect, useState } from "react";
import { api, StyleGuideResponse } from "../../services/api";

export function ReleaseNotesStyleGuide() {
  const [guide, setGuide] = useState<StyleGuideResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStyleGuide()
      .then(setGuide)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load style guide"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="py-6 text-center text-sm text-slate-400">Loading style guide...</div>;
  }

  if (error) {
    return <div className="py-6 text-center text-sm text-red-400">{error}</div>;
  }

  if (!guide) return null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-lg font-semibold text-white">Release Notes Style Guide</h3>
        {guide.isCustom ? (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-400">
            Custom
          </span>
        ) : (
          <span className="rounded-full bg-slate-600/50 px-2.5 py-0.5 text-xs font-medium text-slate-400">
            Default
          </span>
        )}
      </div>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-900 p-4 text-sm text-slate-300">
        {guide.content}
      </pre>
    </div>
  );
}
