import { useState, useEffect, Suspense, lazy } from "react";
import { X, Settings, Save, Eye, EyeOff, Moon, Sun, Activity, AlertTriangle, XCircle, Download, RefreshCw, Check, AlertCircle, Clipboard, Info } from "lucide-react";
import { getCircuitState } from "../services/circuit-breaker";
import { getApiKey, storeApiKey, deleteApiKey } from "../services/secure-storage";
import { checkForUpdates } from "../services/updater";
import { listModels as listModelsAPI, testConnection as testConnectionAPI } from "../services/api";
import { invoke } from "@tauri-apps/api/core";

// Lazy load KeeperSettings since most users won't use it
const KeeperSettings = lazy(() => import("./KeeperSettings"));

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
  onSettingsChange?: () => void;
}

interface Settings {
  provider: string;
  apiKeys: {
    openai: string;
    anthropic: string;
    zai: string;
  };
  model: string;
  customModel: string;
  piiRedactionEnabled: boolean;
  activeProviders: Record<string, boolean>;
}

interface ModelOption {
  id: string;
  label: string;
  context?: number;
  category?: string;
}

const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultActive: true },
  { value: "anthropic", label: "Anthropic", defaultActive: true },
  { value: "ollama", label: "Ollama", defaultActive: true },
  { value: "zai", label: "Z.ai (GLM/Qwen)", defaultActive: true },
  { value: "vllm", label: "vLLM", defaultActive: false },
  { value: "llamacpp", label: "llama.cpp", defaultActive: false },
];

export default function SettingsPanel({
  isOpen,
  onClose,
  darkMode,
  onThemeChange,
  onSettingsChange,
}: SettingsPanelProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);

  const [showApiKeys, setShowApiKeys] = useState({
    openai: false,
    anthropic: false,
    zai: false,
  });

  const [cachedModels, setCachedModels] = useState<Record<string, ModelOption[]>>({});

  const [settings, setSettings] = useState<Settings>({
    provider: "openai",
    apiKeys: {
      openai: "",
      anthropic: "",
      zai: "",
    },
    model: "gpt-5.1",
    customModel: "",
    piiRedactionEnabled: false,
    activeProviders: AI_PROVIDERS.reduce((acc, p) => ({ ...acc, [p.value]: p.defaultActive }), {}),
  });

  // Helper to determine API key status
  const getKeyStatus = (provider: string, key: string): { icon: JSX.Element; color: string; label: string } => {
    if (!key || key.trim() === "") {
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        color: "text-gray-500",
        label: "No key"
      };
    }

    // Validate key format
    const validFormats: Record<string, RegExp> = {
      openai: /^sk-/,
      anthropic: /^sk-ant-/,
    };

    const format = validFormats[provider];
    const isValid = !format || format.test(key);

    if (isValid) {
      return {
        icon: <Check className="w-4 h-4" />,
        color: "text-green-500",
        label: "Configured"
      };
    }

    return {
      icon: <AlertTriangle className="w-4 h-4" />,
      color: "text-yellow-500",
      label: "Invalid format"
    };
  };

  // Network status listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load settings on mount
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  async function loadSettings() {
    const provider = localStorage.getItem("ai_provider") || "openai";

    // Load ALL API keys
    const openaiKey = await getApiKey("openai") || "";
    const anthropicKey = await getApiKey("anthropic") || "";
    const zaiKey = await getApiKey("zai") || "";

    const defaultModel =
      provider === "zai" ? "glm-4.6" :
      provider === "anthropic" ? "claude-sonnet-4.5" :
      provider === "ollama" ? "llama3.2:3b" :
      "gpt-5.1";
    const model = localStorage.getItem("ai_model") || defaultModel;
    const customModel = localStorage.getItem("ai_custom_model") || "";
    const piiRedactionEnabled = localStorage.getItem("pii_redaction_enabled") === "true";

    // Load active providers
    const savedActiveProviders = localStorage.getItem("active_providers");
    let activeProviders = AI_PROVIDERS.reduce((acc, p) => ({ ...acc, [p.value]: p.defaultActive }), {});
    if (savedActiveProviders) {
      try {
        activeProviders = JSON.parse(savedActiveProviders);
      } catch (e) {
        console.warn("Failed to parse active providers:", e);
      }
    }

    setSettings({
      provider,
      apiKeys: {
        openai: openaiKey,
        anthropic: anthropicKey,
        zai: zaiKey,
      },
      model,
      customModel,
      piiRedactionEnabled,
      activeProviders,
    });

    // Load cached models for current provider
    const cacheKey = `models_cache:${provider}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const cacheData = JSON.parse(cached);
        const age = Date.now() - cacheData.timestamp;
        if (age < 3600000) { // 1 hour
          setCachedModels(prev => ({
            ...prev,
            [provider]: cacheData.models
          }));
        }
      } catch (e) {
        console.warn("Failed to load cached models:", e);
      }
    }
  }

  const handleProviderChange = (newProvider: string) => {
    const defaultModel =
      newProvider === "zai" ? "glm-4.6" :
      newProvider === "anthropic" ? "claude-sonnet-4.5" :
      newProvider === "ollama" ? "llama3.2:3b" :
      "gpt-5.1";

    const savedModel = localStorage.getItem(`ai_model:${newProvider}`);

    setSettings({
      ...settings,
      provider: newProvider,
      model: savedModel || defaultModel,
    });
  };

  const handleToggleProvider = (providerValue: string) => {
    const newActiveProviders = {
      ...settings.activeProviders,
      [providerValue]: !settings.activeProviders[providerValue]
    };

    // Ensure at least one provider remains active
    const activeCount = Object.values(newActiveProviders).filter(Boolean).length;
    if (activeCount === 0) {
      alert("At least one provider must remain active");
      return;
    }

    setSettings({
      ...settings,
      activeProviders: newActiveProviders
    });
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Validate: at least one provider must be active
      const activeCount = Object.values(settings.activeProviders).filter(Boolean).length;
      if (activeCount === 0) {
        setSaveMessage("⚠️ At least one provider must be active");
        setIsSaving(false);
        return;
      }

      // Check API key formats (warnings only, don't block save)
      const warnings: string[] = [];
      if (settings.apiKeys.openai && !settings.apiKeys.openai.startsWith("sk-")) {
        warnings.push("OpenAI key format may be invalid (usually starts with 'sk-')");
      }
      if (settings.apiKeys.anthropic && !settings.apiKeys.anthropic.startsWith("sk-ant-")) {
        warnings.push("Anthropic key format may be invalid (usually starts with 'sk-ant-')");
      }

      if (warnings.length > 0) {
        console.warn("⚠️ API key format warnings:", warnings);
      }

      // Save provider and other settings to localStorage (non-sensitive)
      localStorage.setItem("ai_provider", settings.provider);

      // Save the actual model (custom if selected, otherwise the dropdown value)
      const modelToSave = settings.model === "custom" ? settings.customModel : settings.model;
      localStorage.setItem("ai_model", modelToSave);
      localStorage.setItem(`ai_model:${settings.provider}`, modelToSave);
      localStorage.setItem("ai_custom_model", settings.customModel);

      // Save PII redaction setting
      localStorage.setItem("pii_redaction_enabled", String(settings.piiRedactionEnabled));

      // Save active providers
      localStorage.setItem("active_providers", JSON.stringify(settings.activeProviders));

      // Save ALL API keys to encrypted storage
      if (settings.apiKeys.openai) {
        await storeApiKey("openai", settings.apiKeys.openai);
      }
      if (settings.apiKeys.anthropic) {
        await storeApiKey("anthropic", settings.apiKeys.anthropic);
      }
      if (settings.apiKeys.zai) {
        await storeApiKey("zai", settings.apiKeys.zai);
      }

      setSaveMessage("Settings saved successfully! (All API keys encrypted)");
      setTimeout(() => {
        setIsSaving(false);
        setSaveMessage(null);
        if (onSettingsChange) onSettingsChange();
      }, 1500);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Failed to save settings");
      setIsSaving(false);
    }
  };

  const handleClearApiKey = async (provider: string) => {
    if (confirm(`Are you sure you want to clear your ${provider.toUpperCase()} API key?`)) {
      setSettings({
        ...settings,
        apiKeys: {
          ...settings.apiKeys,
          [provider]: ""
        }
      });
      await deleteApiKey(provider);
      setSaveMessage(`${provider.toUpperCase()} API key cleared from encrypted storage`);
      setTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateMessage(null);

    try {
      const updateInfo = await checkForUpdates();
      if (updateInfo.available) {
        setUpdateMessage(
          `Update available: ${updateInfo.latestVersion} (current: ${updateInfo.currentVersion})`
        );
      } else {
        setUpdateMessage(
          `You're up to date (current version: ${updateInfo.currentVersion})`
        );
      }
    } catch (error) {
      setUpdateMessage(`Update check failed: ${error}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleRefreshModels = async () => {
    setIsRefreshingModels(true);
    setConnectionTestResult(null);
    setModelsMessage(null);

    try {
      // Ollama doesn't need an API key (local provider)
      const apiKey = settings.provider === "ollama"
        ? ""
        : settings.apiKeys[settings.provider as keyof typeof settings.apiKeys];

      if (settings.provider !== "ollama" && !apiKey) {
        setConnectionTestResult("⚠️ Please enter an API key first");
        setIsRefreshingModels(false);
        return;
      }

      const models = await listModelsAPI(settings.provider, apiKey);

      // Cache results
      const cacheData = {
        models: models,
        timestamp: Date.now()
      };
      localStorage.setItem(`models_cache:${settings.provider}`, JSON.stringify(cacheData));

      setCachedModels(prev => ({
        ...prev,
        [settings.provider]: models as ModelOption[]
      }));

      setConnectionTestResult(`✅ Found ${models.length} models for ${settings.provider}`);
      setModelsMessage(`Loaded ${models.length} models`);
    } catch (error) {
      setConnectionTestResult(`❌ Failed to fetch models: ${error}`);
    } finally {
      setIsRefreshingModels(false);
      setTimeout(() => setConnectionTestResult(null), 5000);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      // Ollama doesn't need an API key (local provider)
      const apiKey = settings.provider === "ollama"
        ? ""
        : settings.apiKeys[settings.provider as keyof typeof settings.apiKeys];

      if (settings.provider !== "ollama" && !apiKey) {
        setConnectionTestResult("⚠️ Please enter an API key first");
        setIsTestingConnection(false);
        return;
      }

      const result = await testConnectionAPI(settings.provider, apiKey);

      setConnectionTestResult(result.message);

      // If successful, auto-refresh models
      if (result.success && (result.models_count || 0) > 0) {
        handleRefreshModels();
      }
    } catch (error) {
      setConnectionTestResult(`❌ Connection test failed: ${error}`);
    } finally {
      setIsTestingConnection(false);
      setTimeout(() => setConnectionTestResult(null), 5000);
    }
  };

  const handleExportDiagnostics = async () => {
    try {
      const diagnostics = await invoke<string>("export_diagnostics");

      // Copy to clipboard
      await navigator.clipboard.writeText(diagnostics);

      setDiagnosticsMessage("✅ Diagnostics copied to clipboard!");
      setTimeout(() => setDiagnosticsMessage(null), 3000);
    } catch (error) {
      setDiagnosticsMessage(`❌ Failed to export diagnostics: ${error}`);
      setTimeout(() => setDiagnosticsMessage(null), 5000);
    }
  };

  if (!isOpen) return null;

  const currentModels = cachedModels[settings.provider] || [];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Network Status Banner */}
          {!isOnline && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-yellow-300">Offline Mode</p>
                <p className="text-sm text-gray-400">
                  Some features (cloud AI providers, updates) unavailable. Ollama will work if running locally.
                </p>
              </div>
            </div>
          )}

          {/* Provider Activation */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold mb-3">
              Active Providers
              <span className="ml-2 text-xs text-gray-400">
                ({Object.values(settings.activeProviders).filter(Boolean).length} active)
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {AI_PROVIDERS.map((provider) => {
                const circuitState = getCircuitState(provider.value);
                const stateColor =
                  circuitState === "healthy" ? "text-green-400" :
                  circuitState === "degraded" ? "text-yellow-400" :
                  "text-red-400";
                const stateIcon =
                  circuitState === "healthy" ? <Check className="w-4 h-4" /> :
                  circuitState === "degraded" ? <AlertTriangle className="w-4 h-4" /> :
                  <XCircle className="w-4 h-4" />;

                return (
                  <div
                    key={provider.value}
                    className={`p-3 rounded-lg border ${
                      settings.activeProviders[provider.value]
                        ? "bg-blue-500/10 border-blue-500/30"
                        : "bg-gray-900/50 border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{provider.label}</span>
                      <input
                        type="checkbox"
                        checked={settings.activeProviders[provider.value]}
                        onChange={() => handleToggleProvider(provider.value)}
                        className="w-4 h-4 rounded"
                      />
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs ${stateColor}`}>
                      {stateIcon}
                      <span>{circuitState}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Primary AI Provider */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              Primary AI Provider
            </label>
            <select
              value={settings.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
            >
              {AI_PROVIDERS.filter(p => settings.activeProviders[p.value]).map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
            <div className="mt-2 space-y-1">
              {settings.provider === "openai" && (
                <p className="text-xs text-gray-400">
                  Requires API key from{" "}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    platform.openai.com
                  </a>
                </p>
              )}
              {settings.provider === "anthropic" && (
                <p className="text-xs text-gray-400">
                  Requires API key from{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              )}
              {settings.provider === "zai" && (
                <p className="text-xs text-gray-400">
                  Requires API key from{" "}
                  <a
                    href="https://open.bigmodel.cn"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    z.ai
                  </a>
                </p>
              )}
              {settings.provider === "ollama" && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <Info className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-blue-300 mb-1">Ollama (Local)</p>
                      <p className="text-xs text-gray-400">
                        No API key required. Ollama runs locally at <code className="bg-gray-900 px-1 py-0.5 rounded text-blue-400">http://127.0.0.1:11434</code>.
                        Make sure Ollama is installed and running before using this provider.
                      </p>
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:underline mt-1 inline-block"
                      >
                        Download Ollama 
                      </a>
                    </div>
                  </div>
                </div>
              )}
              {(settings.provider === "vllm" || settings.provider === "llamacpp") && (
                <p className="text-xs text-gray-400">
                  Advanced local deployment option. Configure endpoint in settings.
                </p>
              )}
            </div>

            {/* Connection Test */}
            <button
              onClick={handleTestConnection}
              disabled={
                isTestingConnection ||
                (settings.provider !== 'ollama' && !settings.apiKeys[settings.provider as keyof typeof settings.apiKeys]) ||
                (settings.provider !== 'ollama' && !isOnline)
              }
              className="mt-3 w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2"
            >
              {isTestingConnection ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4" />
                  Test Connection
                </>
              )}
            </button>

            {connectionTestResult && (
              <div className={`mt-3 p-3 rounded-lg ${
                connectionTestResult.includes("")
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              }`}>
                {connectionTestResult}
              </div>
            )}
          </div>

          {/* API Keys Section - Only show for non-Ollama providers */}
          {settings.provider !== "ollama" && (
            <div className="space-y-4">
              <label className="block text-sm font-semibold mb-3">
                API Keys (Store keys for all providers)
              </label>

              {/* OpenAI API Key */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-400">
                    OpenAI API Key
                  </label>
                  <div className={`flex items-center gap-1.5 text-xs ${getKeyStatus("openai", settings.apiKeys.openai).color}`}>
                    {getKeyStatus("openai", settings.apiKeys.openai).icon}
                    <span>{getKeyStatus("openai", settings.apiKeys.openai).label}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showApiKeys.openai ? "text" : "password"}
                      value={settings.apiKeys.openai}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: { ...settings.apiKeys, openai: e.target.value }
                      })}
                      placeholder="sk-..."
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => setShowApiKeys({ ...showApiKeys, openai: !showApiKeys.openai })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
                    >
                      {showApiKeys.openai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleClearApiKey("openai")}
                    disabled={!settings.apiKeys.openai}
                    className="px-4 py-3 bg-red-600/20 hover:bg-red-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-red-400 disabled:text-gray-500 rounded-lg transition"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Keys are encrypted locally using OS keychain/credential manager
                </p>
              </div>

              {/* Anthropic API Key */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-400">
                    Anthropic API Key
                  </label>
                  <div className={`flex items-center gap-1.5 text-xs ${getKeyStatus("anthropic", settings.apiKeys.anthropic).color}`}>
                    {getKeyStatus("anthropic", settings.apiKeys.anthropic).icon}
                    <span>{getKeyStatus("anthropic", settings.apiKeys.anthropic).label}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showApiKeys.anthropic ? "text" : "password"}
                      value={settings.apiKeys.anthropic}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: { ...settings.apiKeys, anthropic: e.target.value }
                      })}
                      placeholder="sk-ant-..."
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => setShowApiKeys({ ...showApiKeys, anthropic: !showApiKeys.anthropic })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
                    >
                      {showApiKeys.anthropic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleClearApiKey("anthropic")}
                    disabled={!settings.apiKeys.anthropic}
                    className="px-4 py-3 bg-red-600/20 hover:bg-red-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-red-400 disabled:text-gray-500 rounded-lg transition"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Keys are encrypted locally using OS keychain/credential manager
                </p>
              </div>

              {/* Z.ai API Key */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-400">
                    Z.ai (GLM) API Key
                  </label>
                  <div className={`flex items-center gap-1.5 text-xs ${getKeyStatus("zai", settings.apiKeys.zai).color}`}>
                    {getKeyStatus("zai", settings.apiKeys.zai).icon}
                    <span>{getKeyStatus("zai", settings.apiKeys.zai).label}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showApiKeys.zai ? "text" : "password"}
                      value={settings.apiKeys.zai}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: { ...settings.apiKeys, zai: e.target.value }
                      })}
                      placeholder="Enter your Z.ai API key"
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() => setShowApiKeys({ ...showApiKeys, zai: !showApiKeys.zai })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
                    >
                      {showApiKeys.zai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleClearApiKey("zai")}
                    disabled={!settings.apiKeys.zai}
                    className="px-4 py-3 bg-red-600/20 hover:bg-red-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-red-400 disabled:text-gray-500 rounded-lg transition"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Keys are encrypted locally using OS keychain/credential manager
                </p>
              </div>
            </div>
          )}

          {/* Keeper Secrets Manager Integration */}
          <Suspense fallback={
            <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />
                <span className="text-gray-400">Loading Keeper settings...</span>
              </div>
            </div>
          }>
            <KeeperSettings onConfigChange={onSettingsChange} />
          </Suspense>

          {/* Model Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold">
                AI Model
              </label>
              <button
                onClick={handleRefreshModels}
                disabled={
                  isRefreshingModels ||
                  (settings.provider !== 'ollama' && !settings.apiKeys[settings.provider as keyof typeof settings.apiKeys]) ||
                  (settings.provider !== 'ollama' && !isOnline)
                }
                className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded flex items-center gap-1 transition"
                title={
                  !isOnline && settings.provider !== 'ollama'
                    ? "Offline - cannot fetch models"
                    : "Fetch latest models from provider"
                }
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            <select
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
            >
              {currentModels.length > 0 ? (
                currentModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} {m.context ? `(${(m.context / 1000).toFixed(0)}K)` : ""}
                  </option>
                ))
              ) : (
                <>
                  {settings.provider === "openai" && <option value="gpt-5.1">GPT-5.1</option>}
                  {settings.provider === "anthropic" && <option value="claude-sonnet-4.5">Claude Sonnet 4.5</option>}
                  {settings.provider === "ollama" && <option value="llama3.2:3b">Llama 3.2 3B</option>}
                  {settings.provider === "zai" && <option value="glm-4.6">GLM-4.6</option>}
                </>
              )}
              <option value="custom">Custom Model...</option>
            </select>

            {settings.model === "custom" && (
              <input
                type="text"
                value={settings.customModel}
                onChange={(e) => setSettings({ ...settings, customModel: e.target.value })}
                placeholder="Enter custom model name"
                className="mt-2 w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
              />
            )}

            {modelsMessage && (
              <p className="text-xs text-green-400 mt-2">{modelsMessage}</p>
            )}
          </div>

          {/* PII Redaction */}
          <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
            <div>
              <label className="block text-sm font-semibold mb-1">
                PII Redaction
              </label>
              <p className="text-xs text-gray-400">
                Automatically redact email addresses, IP addresses, and API keys from crash logs
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.piiRedactionEnabled}
              onChange={(e) => setSettings({ ...settings, piiRedactionEnabled: e.target.checked })}
              className="w-5 h-5 rounded"
            />
          </div>

          {/* Theme Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Dark Mode
              </label>
              <p className="text-xs text-gray-400">
                Toggle between light and dark theme
              </p>
            </div>
            <button
              onClick={() => onThemeChange(!darkMode)}
              className="p-2 hover:bg-gray-700 rounded-lg transition"
            >
              {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </div>

          {/* Check for Updates */}
          <div>
            <button
              onClick={handleCheckForUpdates}
              disabled={isCheckingUpdate || !isOnline}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2"
            >
              {isCheckingUpdate ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Check for Updates
                </>
              )}
            </button>
            {updateMessage && (
              <div className={`mt-3 p-3 rounded-lg ${
                updateMessage.includes("")
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
              }`}>
                {updateMessage}
              </div>
            )}
          </div>

          {/* Export Diagnostics */}
          <div>
            <button
              onClick={handleExportDiagnostics}
              className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition flex items-center justify-center gap-2"
            >
              <Clipboard className="w-4 h-4" />
              Export Diagnostics
            </button>
            <p className="text-sm text-gray-400 mt-2">
              Copy system information for troubleshooting and support. Includes app version, settings, provider status, and database stats (API keys are not included).
            </p>
            {diagnosticsMessage && (
              <div className={`mt-3 p-3 rounded-lg ${
                diagnosticsMessage.includes("")
                  ? "bg-green-500/10 border border-green-500/20 text-green-400"
                  : "bg-red-500/10 border border-red-500/20 text-red-400"
              }`}>
                {diagnosticsMessage}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-700 flex gap-3">
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2 font-semibold"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Settings
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            Cancel
          </button>
        </div>

        {saveMessage && (
          <div className={`mx-6 mb-6 p-3 rounded-lg ${
            saveMessage.includes("")
              ? "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
              : saveMessage.includes("successfully")
              ? "bg-green-500/10 border border-green-500/20 text-green-400"
              : "bg-red-500/10 border border-red-500/20 text-red-400"
          }`}>
            {saveMessage}
          </div>
        )}
      </div>
    </div>
  );
}
