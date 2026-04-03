import { useEffect, useState } from "react";
import { api, SentryConfigStatus } from "../../services/api";
import { useToast } from "../Toast";

export function SentryConfigPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [baseUrl, setBaseUrl] = useState("https://sentry.io");
  const [organization, setOrganization] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [configured, setConfigured] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const loadConfig = async () => {
    try {
      const status: SentryConfigStatus = await api.getSentryConfigStatus();
      setBaseUrl(status.baseUrl || "https://sentry.io");
      setOrganization(status.organization || "");
      setConfigured(status.configured);
      setHasToken(status.hasAuthToken);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load Sentry config");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    try {
      const update: { baseUrl?: string; organization?: string; authToken?: string } = {
        baseUrl,
        organization,
      };
      if (authToken) update.authToken = authToken;

      await api.updateSentryConfig(update);
      setAuthToken("");
      await loadConfig();
      toast.success("Sentry configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save Sentry config");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await api.testSentryConnection({ baseUrl, organization, authToken: authToken || '' });
      if (result.connected) {
        toast.success("Sentry connection successful");
      } else {
        toast.error("Connection failed: unable to reach Sentry");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">
        Loading Sentry configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Sentry Configuration</h3>
          {configured ? (
            <span className="rounded-full bg-emerald-500/20 px-3 py-0.5 text-xs font-medium text-emerald-400">
              Configured
            </span>
          ) : (
            <span className="rounded-full bg-slate-600/50 px-3 py-0.5 text-xs font-medium text-slate-400">
              Not configured
            </span>
          )}
        </div>
        <p className="mb-6 text-sm text-slate-400">
          Connect Hadron to your Sentry instance to browse issues and run deep AI analysis.
          Auth tokens are encrypted at rest and never returned to the client.
        </p>

        <div className="space-y-4">
          {/* Base URL */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Base URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder="https://sentry.io"
            />
            <p className="mt-1 text-xs text-slate-500">
              Use your self-hosted URL if applicable, e.g. https://sentry.example.com
            </p>
          </div>

          {/* Organization Slug */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Organization Slug
            </label>
            <input
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder="my-organization"
            />
            <p className="mt-1 text-xs text-slate-500">
              Found in your Sentry org settings URL: sentry.io/organizations/&lt;slug&gt;/
            </p>
          </div>

          {/* Auth Token */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Auth Token
            </label>
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder={
                hasToken
                  ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (configured)"
                  : "sntrys_..."
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              Create an internal integration token with{" "}
              <span className="font-mono">event:read</span> and{" "}
              <span className="font-mono">project:read</span> scopes.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || (!hasToken && !authToken)}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
