import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { useToast } from "../Toast";

export function ConfluenceConfigPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [spaceKey, setSpaceKey] = useState("");
  const [parentPageId, setParentPageId] = useState("");
  const [configured, setConfigured] = useState(false);

  const loadConfig = async () => {
    try {
      const config = await api.getConfluenceConfig();
      setSpaceKey(config.spaceKey || "");
      setParentPageId(config.parentPageId || "");
      setConfigured(config.configured);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load Confluence config");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateConfluenceConfig({ spaceKey, parentPageId });
      await loadConfig();
      toast.success("Confluence configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save Confluence config");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">
        Loading Confluence configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Confluence Configuration</h3>
          {configured ? (
            <span className="rounded-full bg-amber-500/20 px-3 py-0.5 text-xs font-medium text-amber-400">
              Configured
            </span>
          ) : (
            <span className="rounded-full bg-slate-600/50 px-3 py-0.5 text-xs font-medium text-slate-400">
              Not configured
            </span>
          )}
        </div>
        <p className="mb-6 text-sm text-slate-400">
          Configure Confluence integration to publish release notes directly to your Confluence space.
          Credentials are managed server-side via environment variables.
        </p>

        <div className="space-y-4">
          {/* Space Key */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Space Key
            </label>
            <input
              type="text"
              value={spaceKey}
              onChange={(e) => setSpaceKey(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-amber-500 focus:outline-none"
              placeholder="e.g. ENG"
            />
            <p className="mt-1 text-xs text-slate-500">
              The key of the Confluence space where pages will be published.
            </p>
          </div>

          {/* Parent Page ID */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Parent Page ID
            </label>
            <input
              type="text"
              value={parentPageId}
              onChange={(e) => setParentPageId(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-amber-500 focus:outline-none"
              placeholder="e.g. 123456789"
            />
            <p className="mt-1 text-xs text-slate-500">
              The numeric ID of the parent page under which release notes will be created.
              Find it in the page URL: /pages/&lt;id&gt;/...
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}
