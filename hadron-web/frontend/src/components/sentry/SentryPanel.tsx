import { useState } from "react";
import { useToast } from "../Toast";

interface SentryConfig {
  baseUrl: string;
  authToken: string;
  orgSlug: string;
}

interface SentryProject {
  slug: string;
  name: string;
}

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  status: string;
}

export function SentryPanel() {
  const toast = useToast();
  const [config, setConfig] = useState<SentryConfig>({
    baseUrl: "https://sentry.io",
    authToken: "",
    orgSlug: "",
  });
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<SentryProject[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sentry/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Connection failed");
      setConnected(true);
      toast.success("Connected to Sentry");
      // Fetch projects
      const projRes = await fetch("/api/sentry/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (projRes.ok) {
        const data = await projRes.json();
        setProjects(data);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection failed");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchIssues = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sentry/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, projectSlug: selectedProject }),
      });
      if (!res.ok) throw new Error("Failed to fetch issues");
      const data = await res.json();
      setIssues(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to fetch issues");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Sentry Integration</h3>

      {/* Connection config */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Sentry URL
            </label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) =>
                setConfig({ ...config, baseUrl: e.target.value })
              }
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Organization Slug
            </label>
            <input
              type="text"
              value={config.orgSlug}
              onChange={(e) =>
                setConfig({ ...config, orgSlug: e.target.value })
              }
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Auth Token
          </label>
          <input
            type="password"
            value={config.authToken}
            onChange={(e) =>
              setConfig({ ...config, authToken: e.target.value })
            }
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
          />
        </div>
        <button
          onClick={handleTest}
          disabled={loading || !config.authToken || !config.orgSlug}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Connecting..." : connected ? "Reconnect" : "Connect"}
        </button>
      </div>

      {/* Project selector + issues */}
      {connected && projects.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleFetchIssues}
              disabled={!selectedProject || loading}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Load Issues
            </button>
          </div>

          {issues.length > 0 && (
            <div className="space-y-1">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-slate-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">
                      {issue.title}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {issue.culprit} &middot; {issue.count} events
                    </div>
                  </div>
                  <span
                    className={`ml-2 rounded px-2 py-0.5 text-xs ${
                      issue.status === "resolved"
                        ? "bg-green-500/20 text-green-400"
                        : issue.status === "ignored"
                          ? "bg-slate-600 text-slate-400"
                          : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {issue.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
