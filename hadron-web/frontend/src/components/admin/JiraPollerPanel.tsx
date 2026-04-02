import { useEffect, useRef, useState } from "react";
import { api, PollerConfigStatus } from "../../services/api";
import { useToast } from "../Toast";

export function JiraPollerPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [config, setConfig] = useState<PollerConfigStatus | null>(null);

  // Form fields
  const [enabled, setEnabled] = useState(false);
  const [jqlFilter, setJqlFilter] = useState("");
  const [intervalMins, setIntervalMins] = useState(30);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConfig = async () => {
    try {
      const c = await api.getPollerConfig();
      setConfig(c);
      setEnabled(c.enabled);
      setJqlFilter(c.jqlFilter);
      setIntervalMins(c.intervalMins);
      setBaseUrl(c.jiraBaseUrl);
      setEmail(c.jiraEmail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load poller config");
    }
  };

  useEffect(() => {
    loadConfig().finally(() => setLoading(false));

    intervalRef.current = setInterval(() => {
      api.getPollerConfig().then(setConfig).catch(() => {
        // silently ignore auto-refresh errors
      });
    }, 15000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updatePollerConfig({
        enabled,
        jqlFilter,
        intervalMins,
        jiraBaseUrl: baseUrl,
        jiraEmail: email,
        jiraApiToken: apiToken || undefined,
      });
      const updated = await api.getPollerConfig();
      setConfig(updated);
      setApiToken("");
      toast.success("Poller configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleStartStop = async () => {
    setToggling(true);
    try {
      if (config?.running) {
        await api.stopPoller();
        toast.success("Poller stopped");
      } else {
        await api.startPoller();
        toast.success("Poller started");
      }
      const updated = await api.getPollerConfig();
      setConfig(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to toggle poller");
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">
        Loading poller configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <h3 className="mb-4 text-lg font-semibold text-white">
          Poller Status
        </h3>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                config?.running ? "bg-green-400" : "bg-slate-500"
              }`}
            />
            <span
              className={`text-sm font-medium ${
                config?.running ? "text-green-400" : "text-slate-400"
              }`}
            >
              {config?.running ? "Running" : "Stopped"}
            </span>
          </div>

          {config?.lastPolledAt && (
            <div className="text-sm text-slate-400">
              <span className="text-slate-500">Last polled:</span>{" "}
              <span className="text-slate-300">
                {new Date(config.lastPolledAt).toLocaleString()}
              </span>
            </div>
          )}

          {config && (
            <div className="text-sm text-slate-400">
              <span className="text-slate-500">Interval:</span>{" "}
              <span className="text-slate-300">{config.intervalMins} min</span>
            </div>
          )}
        </div>
      </div>

      {/* Configuration Card */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <h3 className="mb-4 text-lg font-semibold text-white">
          JIRA Poller Configuration
        </h3>
        <p className="mb-5 text-sm text-slate-400">
          Configure the background JIRA poller that periodically fetches and
          triages new tickets matching the JQL filter.
        </p>

        {/* JIRA Credentials */}
        <div className="mb-5 rounded-md border border-slate-700 p-4">
          <h4 className="mb-3 text-sm font-medium text-slate-300">
            JIRA Credentials
          </h4>

          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-400">
              Base URL
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder="https://your-org.atlassian.net"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              API Token
            </label>
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder={
                config?.hasApiToken
                  ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (configured)"
                  : "Enter JIRA API token"
              }
            />
          </div>
        </div>

        {/* JQL Filter */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            JQL Filter
          </label>
          <input
            type="text"
            value={jqlFilter}
            onChange={(e) => setJqlFilter(e.target.value)}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            placeholder='project = "PROJ" AND created >= -1d ORDER BY created DESC'
          />
          <p className="mt-1 text-xs text-slate-500">
            JQL query used to find tickets for automatic triage.
          </p>
        </div>

        {/* Interval */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            Poll Interval (minutes)
          </label>
          <input
            type="number"
            min={5}
            value={intervalMins}
            onChange={(e) =>
              setIntervalMins(Math.max(5, parseInt(e.target.value, 10) || 5))
            }
            className="w-32 rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">Minimum 5 minutes.</p>
        </div>

        {/* Enable toggle */}
        <div className="mb-5">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-300">
              Enable automatic polling
            </span>
          </label>
          <p className="mt-1 ml-7 text-xs text-slate-500">
            When enabled, the poller will run at the configured interval.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>

          <button
            onClick={handleStartStop}
            disabled={toggling}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              config?.running
                ? "border border-red-500 text-red-400 hover:bg-red-500/10"
                : "border border-green-500 text-green-400 hover:bg-green-500/10"
            }`}
          >
            {toggling
              ? config?.running
                ? "Stopping..."
                : "Starting..."
              : config?.running
                ? "Stop Poller"
                : "Start Poller"}
          </button>
        </div>
      </div>
    </div>
  );
}
