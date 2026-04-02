import { useEffect, useState } from "react";
import { api, AiConfigStatus } from "../../services/api";
import { useToast } from "../Toast";

export function AiConfigPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<AiConfigStatus | null>(null);

  // Form state
  const [provider, setProvider] = useState("openai");
  const [modelOpenai, setModelOpenai] = useState("gpt-4o");
  const [modelAnthropic, setModelAnthropic] = useState("claude-sonnet-4-20250514");
  const [apiKeyOpenai, setApiKeyOpenai] = useState("");
  const [apiKeyAnthropic, setApiKeyAnthropic] = useState("");

  useEffect(() => {
    api
      .getAiConfigStatus()
      .then((c) => {
        setConfig(c);
        setProvider(c.provider);
        setModelOpenai(c.modelOpenai);
        setModelAnthropic(c.modelAnthropic);
      })
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load AI config"),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const update: Record<string, string> = {
        provider,
        modelOpenai,
        modelAnthropic,
      };
      if (apiKeyOpenai) update.apiKeyOpenai = apiKeyOpenai;
      if (apiKeyAnthropic) update.apiKeyAnthropic = apiKeyAnthropic;

      await api.updateAiConfig(update);

      const updated = await api.getAiConfigStatus();
      setConfig(updated);
      setApiKeyOpenai("");
      setApiKeyAnthropic("");
      toast.success("AI configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await api.testAiConfig();
      if (result.success) {
        toast.success(`Connection successful (${result.provider} / ${result.model})`);
      } else {
        toast.error(`Connection failed: ${result.error}`);
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
        Loading AI configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        <h3 className="mb-4 text-lg font-semibold text-white">
          AI Provider Configuration
        </h3>
        <p className="mb-4 text-sm text-slate-400">
          Configure a server-side AI API key so users don't need to provide their
          own. Keys are encrypted at rest.
        </p>

        {/* Provider selector */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            Active Provider
          </label>
          <div className="flex gap-3">
            {(["openai", "anthropic"] as const).map((p) => (
              <label
                key={p}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors ${
                  provider === p
                    ? "border-blue-500 bg-blue-500/10 text-blue-400"
                    : "border-slate-600 text-slate-400 hover:border-slate-500"
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  className="sr-only"
                />
                {p === "openai" ? "OpenAI" : "Anthropic"}
              </label>
            ))}
          </div>
        </div>

        {/* OpenAI section */}
        <div className="mb-4 rounded-md border border-slate-700 p-4">
          <h4 className="mb-2 text-sm font-medium text-slate-300">OpenAI</h4>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-400">Model</label>
            <input
              type="text"
              value={modelOpenai}
              onChange={(e) => setModelOpenai(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder="gpt-4o"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">API Key</label>
            <input
              type="password"
              value={apiKeyOpenai}
              onChange={(e) => setApiKeyOpenai(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder={
                config?.hasOpenaiKey
                  ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (configured)"
                  : "sk-..."
              }
            />
          </div>
        </div>

        {/* Anthropic section */}
        <div className="mb-4 rounded-md border border-slate-700 p-4">
          <h4 className="mb-2 text-sm font-medium text-slate-300">Anthropic</h4>
          <div className="mb-3">
            <label className="mb-1 block text-xs text-slate-400">Model</label>
            <input
              type="text"
              value={modelAnthropic}
              onChange={(e) => setModelAnthropic(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder="claude-sonnet-4-20250514"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">API Key</label>
            <input
              type="password"
              value={apiKeyAnthropic}
              onChange={(e) => setApiKeyAnthropic(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              placeholder={
                config?.hasAnthropicKey
                  ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (configured)"
                  : "sk-ant-..."
              }
            />
          </div>
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
            onClick={handleTest}
            disabled={testing || (!config?.hasOpenaiKey && !config?.hasAnthropicKey)}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
