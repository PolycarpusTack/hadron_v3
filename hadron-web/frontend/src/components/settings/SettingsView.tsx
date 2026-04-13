import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";
import { useToast } from "../Toast";

interface SettingsViewProps {
  apiKey: string;
  model: string;
  provider: string;
  onSettingsChange: (settings: {
    apiKey: string;
    model: string;
    provider: string;
  }) => void;
}

const PROVIDERS = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
];

const MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
  ],
};

export function SettingsView({
  apiKey,
  model,
  provider,
  onSettingsChange,
}: SettingsViewProps) {
  const toast = useToast();
  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const [localModel, setLocalModel] = useState(model);
  const [localProvider, setLocalProvider] = useState(provider);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverSettings, setServerSettings] = useState<Record<string, unknown>>(
    {},
  );

  useEffect(() => {
    api.getSettings().then((s) => {
      setServerSettings(s);
    }).catch((e) =>
      toast.error(
        e instanceof Error ? e.message : "Failed to load settings",
      ),
    );
  }, []);

  const handleSave = useCallback(async () => {
    onSettingsChange({
      apiKey: localApiKey,
      model: localModel,
      provider: localProvider,
    });

    // Save non-sensitive settings to server
    try {
      await api.updateSettings({
        ...serverSettings,
        model: localModel,
        provider: localProvider,
      });
      toast.success("Settings saved");
    } catch (e) {
      toast.error("Failed to save settings");
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [
    localApiKey,
    localModel,
    localProvider,
    serverSettings,
    onSettingsChange,
    toast,
  ]);

  const availableModels = MODELS[localProvider] || MODELS.openai;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-xl font-semibold text-white">Settings</h2>

      {/* AI Provider */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-4 text-sm font-medium text-slate-300">
          AI Provider
        </h3>

        <div className="mb-4">
          <label className="mb-1 block text-xs text-slate-400">Provider</label>
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setLocalProvider(p.id);
                  const models = MODELS[p.id];
                  if (models && !models.includes(localModel)) {
                    setLocalModel(models[0]);
                  }
                }}
                className={`rounded-md px-4 py-2 text-sm transition-colors ${
                  localProvider === p.id
                    ? "bg-blue-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs text-slate-400">Model</label>
          <select
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">API Key</label>
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              placeholder={`Enter ${localProvider === "anthropic" ? "Anthropic" : "OpenAI"} API key`}
              className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            API keys are stored in your browser only and sent per-request.
          </p>
        </div>
      </section>

      {/* OpenSearch Integration */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">
          OpenSearch Integration
        </h3>
        <p className="text-sm text-slate-400">
          OpenSearch is configured via the Admin panel.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          OpenSearch credentials (URL, index, username, password) are managed by an admin and are not editable here.
        </p>
      </section>

      {/* Jira Integration */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">
          Jira Integration
        </h3>
        <p className="text-sm text-slate-400">
          JIRA is configured via the Admin panel.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          JIRA credentials (URL, email, API token, project key) are managed by an admin under
          JIRA Poller settings and are not editable here.
        </p>
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Save Settings
        </button>
        {saved && (
          <span className="text-sm text-green-400">Settings saved</span>
        )}
      </div>
    </div>
  );
}
