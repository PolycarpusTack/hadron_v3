import { useState, useEffect, Suspense, lazy, useRef, useCallback } from "react";
import { X, Settings, Save, Eye, EyeOff, Moon, Sun, Activity, AlertTriangle, XCircle, Download, RefreshCw, Check, AlertCircle, Clipboard, Info, Cpu, Link, Palette, Wrench, ChevronDown, ChevronRight, Shield } from "lucide-react";
import { getCircuitState } from "../services/circuit-breaker";
import { getApiKey, storeApiKey, deleteApiKey } from "../services/secure-storage";
import { checkForUpdates } from "../services/updater";
import { listModels as listModelsAPI, testConnection as testConnectionAPI, autoTagAnalyses } from "../services/api";
import { invoke } from "@tauri-apps/api/core";
import { getKeeperConfig, type KeeperConfig } from "../services/keeper";
import { listGoldAnswers, exportGoldAnswersJsonl } from "../services/gold-answers";
import { exportSummariesBundle } from "../services/summaries";
import { save as tauriSave } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import logger from '../services/logger';

// Lazy load heavy components since most users won't use them
const KeeperSettings = lazy(() => import("./KeeperSettings"));
const JiraSettings = lazy(() => import("./JiraSettings"));
const SentrySettings = lazy(() => import("./SentrySettings"));
const OpenSearchSettings = lazy(() => import("./OpenSearchSettings"));
const DatabaseAdminSection = lazy(() => import("./DatabaseAdminSection"));
const EmbeddedConsoleViewer = lazy(() => import("./EmbeddedConsoleViewer"));

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
  auxiliaryModel: string;
  piiRedactionEnabled: boolean;
  activeProviders: Record<string, boolean>;
}

interface ModelOption {
  id: string;
  label: string;
  context?: number;
  category?: string;
}

type SettingsTab = "ai" | "integrations" | "appearance" | "advanced";

const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultActive: true },
  { value: "anthropic", label: "Anthropic", defaultActive: true },
  { value: "zai", label: "Z.ai (GLM/Qwen)", defaultActive: true },
  { value: "llamacpp", label: "llama.cpp (Local)", defaultActive: true },
  { value: "vllm", label: "vLLM", defaultActive: false },
];

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "ai", label: "AI Config", icon: <Cpu className="w-4 h-4" /> },
  { id: "integrations", label: "Integrations", icon: <Link className="w-4 h-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" /> },
  { id: "advanced", label: "Advanced", icon: <Wrench className="w-4 h-4" /> },
];

export default function SettingsPanel({
  isOpen,
  onClose,
  darkMode,
  onThemeChange,
  onSettingsChange,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai");
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
  const [autoTagMessage, setAutoTagMessage] = useState<string | null>(null);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [keeperConfig, setKeeperConfig] = useState<KeeperConfig | null>(null);
  const [showManualKeys, setShowManualKeys] = useState(true);

  // Ask Hadron Data state (Task 24)
  const [goldCount, setGoldCount] = useState<number | null>(null);
  const [summaryExportMsg, setSummaryExportMsg] = useState<string | null>(null);
  const [goldExportMsg, setGoldExportMsg] = useState<string | null>(null);
  const [isExportingGold, setIsExportingGold] = useState(false);
  const [isExportingSummaries, setIsExportingSummaries] = useState(false);

  const contentScrollRef = useRef<HTMLDivElement>(null);

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
    model: "gpt-4o",
    customModel: "",
    auxiliaryModel: "",
    piiRedactionEnabled: false,
    activeProviders: AI_PROVIDERS.reduce((acc, p) => ({ ...acc, [p.value]: p.defaultActive }), {}),
  });

  // Track timeouts for cleanup to prevent memory leaks
  const timeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set());

  // Helper to create auto-cleaning timeouts
  const safeTimeout = useCallback((callback: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      callback();
    }, delay);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  const handleAutoTagHistory = async () => {
    setIsAutoTagging(true);
    setAutoTagMessage(null);
    try {
      const result = await autoTagAnalyses(null);
      setAutoTagMessage(
        `Auto-tagging complete: ${result.tagged} tagged, ${result.skipped} skipped, ${result.failed} failed.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAutoTagMessage(`Auto-tagging failed: ${msg}`);
    } finally {
      setIsAutoTagging(false);
    }
  };

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
  }, []);

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

  // Load gold answer count for Ask Hadron Data section (Task 24)
  useEffect(() => {
    if (isOpen && activeTab === "advanced") {
      listGoldAnswers(1000, 0).then((golds) => {
        setGoldCount(golds.length);
      }).catch(() => setGoldCount(null));
    }
  }, [isOpen, activeTab]);

  // Load Keeper config to determine if manual keys section should be collapsed
  useEffect(() => {
    if (isOpen) {
      getKeeperConfig().then((config) => {
        setKeeperConfig(config);
        // Auto-collapse manual keys when Keeper is active for current provider
        const isActive = config.enabled && !!config.secretMappings[settings.provider as keyof typeof config.secretMappings];
        if (isActive) {
          setShowManualKeys(false);
        }
      }).catch(() => {
        // Keeper not available, keep manual keys expanded
      });
    }
  }, [isOpen, settings.provider]);

  async function loadSettings() {
    const provider = localStorage.getItem("ai_provider") || "openai";

    // Load ALL API keys
    const openaiKey = await getApiKey("openai") || "";
    const anthropicKey = await getApiKey("anthropic") || "";
    const zaiKey = await getApiKey("zai") || "";

    const defaultModel =
      provider === "zai" ? "glm-4" :
      provider === "anthropic" ? "claude-sonnet-4-20250514" :
      provider === "llamacpp" ? "default" :
      "gpt-4o";
    const model = localStorage.getItem("ai_model") || defaultModel;
    const customModel = localStorage.getItem("ai_custom_model") || "";
    const auxiliaryModel = localStorage.getItem("ai_auxiliary_model") || "";
    const piiRedactionEnabled = localStorage.getItem("pii_redaction_enabled") === "true";

    // Load active providers
    const savedActiveProviders = localStorage.getItem("active_providers");
    let activeProviders = AI_PROVIDERS.reduce((acc, p) => ({ ...acc, [p.value]: p.defaultActive }), {});
    if (savedActiveProviders) {
      try {
        activeProviders = JSON.parse(savedActiveProviders);
      } catch (e) {
        logger.warn('Failed to parse active providers', { error: String(e) });
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
      auxiliaryModel,
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
        logger.warn('Failed to load cached models', { error: String(e) });
      }
    }
  }

  const handleProviderChange = (newProvider: string) => {
    const defaultModel =
      newProvider === "zai" ? "glm-4" :
      newProvider === "anthropic" ? "claude-sonnet-4-20250514" :
      newProvider === "llamacpp" ? "default" :
      "gpt-4o";

    const savedModel = localStorage.getItem(`ai_model:${newProvider}`);

    setSettings({
      ...settings,
      provider: newProvider,
      model: savedModel || defaultModel,
      auxiliaryModel: "", // Reset when switching providers
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
        setSaveMessage("At least one provider must be active");
        setIsSaving(false);
        return;
      }

      // Save provider and other settings to localStorage (non-sensitive)
      localStorage.setItem("ai_provider", settings.provider);

      // Save the actual model (custom if selected, otherwise the dropdown value)
      const modelToSave = settings.model === "custom" ? settings.customModel : settings.model;
      localStorage.setItem("ai_model", modelToSave);
      localStorage.setItem(`ai_model:${settings.provider}`, modelToSave);
      localStorage.setItem("ai_custom_model", settings.customModel);

      // Save auxiliary model
      if (settings.auxiliaryModel) {
        localStorage.setItem("ai_auxiliary_model", settings.auxiliaryModel);
      } else {
        localStorage.removeItem("ai_auxiliary_model");
      }

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

      setSaveMessage("Settings saved successfully!");
      safeTimeout(() => {
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
      setSaveMessage(`${provider.toUpperCase()} API key cleared`);
      safeTimeout(() => setSaveMessage(null), 2000);
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
          `You're up to date (v${updateInfo.currentVersion})`
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
      const apiKey = settings.provider === "llamacpp"
        ? ""
        : settings.apiKeys[settings.provider as keyof typeof settings.apiKeys];

      if (settings.provider !== "llamacpp" && !apiKey) {
        setConnectionTestResult("Please enter an API key first");
        setIsRefreshingModels(false);
        return;
      }

      const models = await listModelsAPI(settings.provider, apiKey);

      const cacheData = {
        models: models,
        timestamp: Date.now()
      };
      localStorage.setItem(`models_cache:${settings.provider}`, JSON.stringify(cacheData));

      setCachedModels(prev => ({
        ...prev,
        [settings.provider]: models as ModelOption[]
      }));

      setModelsMessage(`Loaded ${models.length} models`);
    } catch (error) {
      setConnectionTestResult(`Failed to fetch models: ${error}`);
    } finally {
      setIsRefreshingModels(false);
      safeTimeout(() => {
        setConnectionTestResult(null);
        setModelsMessage(null);
      }, 5000);
    }
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const apiKey = settings.provider === "llamacpp"
        ? ""
        : settings.apiKeys[settings.provider as keyof typeof settings.apiKeys];

      if (settings.provider !== "llamacpp" && !apiKey) {
        setConnectionTestResult("Please enter an API key first");
        setIsTestingConnection(false);
        return;
      }

      const result = await testConnectionAPI(settings.provider, apiKey);
      setConnectionTestResult(result.message);

      if (result.success && (result.models_count || 0) > 0) {
        handleRefreshModels();
      }
    } catch (error) {
      setConnectionTestResult(`Connection failed: ${error}`);
    } finally {
      setIsTestingConnection(false);
      safeTimeout(() => setConnectionTestResult(null), 5000);
    }
  };

  const handleExportDiagnostics = async () => {
    try {
      const diagnostics = await invoke<string>("export_diagnostics");
      await navigator.clipboard.writeText(diagnostics);
      setDiagnosticsMessage("Diagnostics copied to clipboard!");
      safeTimeout(() => setDiagnosticsMessage(null), 3000);
    } catch (error) {
      setDiagnosticsMessage(`Failed to export: ${error}`);
      safeTimeout(() => setDiagnosticsMessage(null), 5000);
    }
  };

  if (!isOpen) return null;

  const currentModels = cachedModels[settings.provider] || [];
  const isKeeperActiveForProvider = keeperConfig?.enabled && !!keeperConfig.secretMappings[settings.provider as keyof typeof keeperConfig.secretMappings];

  // Render API Key input for a provider
  const renderApiKeyInput = (provider: "openai" | "anthropic" | "zai", label: string, placeholder: string) => {
    const status = getKeyStatus(provider, settings.apiKeys[provider]);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-300">{label}</label>
          <div className={`flex items-center gap-1.5 text-xs ${status.color}`}>
            {status.icon}
            <span>{status.label}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showApiKeys[provider] ? "text" : "password"}
              value={settings.apiKeys[provider]}
              onChange={(e) => setSettings({
                ...settings,
                apiKeys: { ...settings.apiKeys, [provider]: e.target.value }
              })}
              placeholder={placeholder}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 pr-10 focus:outline-none focus:border-blue-500 text-sm"
            />
            <button
              onClick={() => setShowApiKeys({ ...showApiKeys, [provider]: !showApiKeys[provider] })}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
            >
              {showApiKeys[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={() => handleClearApiKey(provider)}
            disabled={!settings.apiKeys[provider]}
            className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-red-400 disabled:text-gray-500 rounded-lg transition text-sm"
          >
            Clear
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-bold">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-700 px-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-6">
          {/* Network Status Banner */}
          {!isOnline && (
            <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-yellow-300">Offline Mode</p>
                <p className="text-sm text-gray-400">
                  Cloud AI providers unavailable. llama.cpp will work if running locally.
                </p>
              </div>
            </div>
          )}

          {/* AI Configuration Tab */}
          {activeTab === "ai" && (
            <div className="space-y-6">
              {/* Provider Selection */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">AI Provider</label>
                <select
                  value={settings.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
                >
                  {AI_PROVIDERS.filter(p => settings.activeProviders[p.value]).map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>

                {/* Provider-specific info */}
                {settings.provider === "llamacpp" && (
                  <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-300">llama.cpp (Local)</p>
                        <p className="text-xs text-gray-400 mt-1">
                          No API key required. Start <code className="bg-gray-900 px-1.5 py-0.5 rounded text-blue-400">llama-server</code> on <code className="bg-gray-900 px-1.5 py-0.5 rounded text-blue-400">localhost:8080</code>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Example: <code className="bg-gray-900 px-1 py-0.5 rounded text-gray-400">llama-server -m model.gguf --port 8080</code>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Keeper Secrets Manager */}
              <Suspense fallback={
                <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />
                    <span className="text-gray-400">Loading Keeper settings...</span>
                  </div>
                </div>
              }>
                <KeeperSettings onConfigChange={() => {
                  onSettingsChange?.();
                  // Refresh keeper config state so the UI updates
                  getKeeperConfig().then((config) => {
                    setKeeperConfig(config);
                    const isActive = config.enabled && !!config.secretMappings[settings.provider as keyof typeof config.secretMappings];
                    if (isActive) setShowManualKeys(false);
                    else setShowManualKeys(true);
                  }).catch(() => {});
                }} />
              </Suspense>

              {/* Manual API Key - Only for cloud providers */}
              {settings.provider !== "llamacpp" && (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowManualKeys(!showManualKeys)}
                    className="flex items-center gap-2 w-full text-left group"
                  >
                    {showManualKeys
                      ? <ChevronDown className="w-4 h-4 text-gray-400" />
                      : <ChevronRight className="w-4 h-4 text-gray-400" />
                    }
                    <span className="text-sm font-semibold">Manual API Key</span>
                    {isKeeperActiveForProvider && (
                      <span className="ml-auto flex items-center gap-1.5 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/30 rounded-full px-2.5 py-0.5">
                        <Shield className="w-3 h-3" />
                        Using Keeper
                      </span>
                    )}
                  </button>

                  {showManualKeys && (
                    <div className="space-y-4 pl-6">
                      {settings.provider === "openai" && renderApiKeyInput("openai", "OpenAI API Key", "sk-...")}
                      {settings.provider === "anthropic" && renderApiKeyInput("anthropic", "Anthropic API Key", "sk-ant-...")}
                      {settings.provider === "zai" && renderApiKeyInput("zai", "Z.ai API Key", "Enter your Z.ai key")}

                      <p className="text-xs text-gray-500">
                        Keys are encrypted using your OS keychain/credential manager
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Model Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold">Model</label>
                  <button
                    onClick={handleRefreshModels}
                    disabled={isRefreshingModels || (settings.provider !== 'llamacpp' && !isKeeperActiveForProvider && !settings.apiKeys[settings.provider as keyof typeof settings.apiKeys])}
                    className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg flex items-center gap-1.5 transition"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                    Refresh Models
                  </button>
                </div>
                <select
                  value={settings.model}
                  onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
                >
                  {currentModels.length > 0 ? (
                    currentModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} {m.context ? `(${(m.context / 1000).toFixed(0)}K)` : ""}
                      </option>
                    ))
                  ) : (
                    <>
                      {settings.provider === "openai" && <option value="gpt-4o">GPT-4o</option>}
                      {settings.provider === "anthropic" && <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>}
                      {settings.provider === "llamacpp" && <option value="default">Default Model</option>}
                      {settings.provider === "zai" && <option value="glm-4">GLM-4</option>}
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
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
                  />
                )}

                {modelsMessage && (
                  <p className="text-xs text-green-400">{modelsMessage}</p>
                )}
              </div>

              {/* Lightweight Model (Cost Optimization) */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Lightweight Model (Optional)</label>
                <p className="text-xs text-gray-400">
                  Use a cheaper model for internal calls (query planning, search expansion, tool decisions).
                  The main model is still used for final answer synthesis.
                </p>
                <select
                  value={settings.auxiliaryModel}
                  onChange={(e) => setSettings({ ...settings, auxiliaryModel: e.target.value })}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500"
                >
                  <option value="">Same as main model (no savings)</option>
                  {settings.provider === "openai" && (
                    <>
                      <option value="gpt-4o-mini">GPT-4o Mini (recommended)</option>
                      <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                    </>
                  )}
                  {settings.provider === "anthropic" && (
                    <>
                      <option value="claude-haiku-4-5-20251001">Claude 4.5 Haiku (recommended)</option>
                    </>
                  )}
                  {settings.provider === "zai" && (
                    <>
                      <option value="glm-4-flash">GLM-4 Flash (recommended)</option>
                    </>
                  )}
                  {settings.provider === "llamacpp" && (
                    <option value="default">Default (local - no cost)</option>
                  )}
                </select>
              </div>

              {/* Test Connection */}
              <button
                onClick={handleTestConnection}
                disabled={isTestingConnection || (settings.provider !== 'llamacpp' && !isKeeperActiveForProvider && !settings.apiKeys[settings.provider as keyof typeof settings.apiKeys]) || (settings.provider !== 'llamacpp' && !isOnline)}
                className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2"
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
                <div className={`p-3 rounded-lg text-sm ${
                  connectionTestResult.toLowerCase().includes("success") || connectionTestResult.toLowerCase().includes("found")
                    ? "bg-green-500/10 border border-green-500/20 text-green-400"
                    : "bg-red-500/10 border border-red-500/20 text-red-400"
                }`}>
                  {connectionTestResult}
                </div>
              )}
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === "integrations" && (
            <div className="space-y-6">
              <Suspense fallback={
                <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
                    <span className="text-gray-400">Loading JIRA settings...</span>
                  </div>
                </div>
              }>
                <JiraSettings onConfigChange={onSettingsChange} />
              </Suspense>

              <Suspense fallback={
                <div className="p-4 bg-orange-500/10 rounded-lg border border-orange-500/30">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-orange-400 animate-spin" />
                    <span className="text-gray-400">Loading Sentry settings...</span>
                  </div>
                </div>
              }>
                <SentrySettings onConfigChange={onSettingsChange} />
              </Suspense>

              <Suspense fallback={
                <div className="p-4 bg-teal-500/10 rounded-lg border border-teal-500/30">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-teal-400 animate-spin" />
                    <span className="text-gray-400">Loading Knowledge Base settings...</span>
                  </div>
                </div>
              }>
                <OpenSearchSettings onConfigChange={onSettingsChange} />
              </Suspense>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === "appearance" && (
            <div className="space-y-4">
              {/* Theme Toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <div>
                  <label className="block text-sm font-semibold mb-1">Theme</label>
                  <p className="text-xs text-gray-400">
                    Switch between light and dark mode
                  </p>
                </div>
                <button
                  onClick={() => onThemeChange(!darkMode)}
                  className={`relative w-14 h-8 rounded-full transition-colors ${
                    darkMode ? "bg-blue-600" : "bg-gray-600"
                  }`}
                >
                  <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform flex items-center justify-center ${
                    darkMode ? "translate-x-7" : "translate-x-1"
                  }`}>
                    {darkMode ? <Moon className="w-4 h-4 text-blue-600" /> : <Sun className="w-4 h-4 text-yellow-500" />}
                  </div>
                </button>
              </div>

              {/* PII Redaction */}
              <div className="flex items-center justify-between p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                <div>
                  <label className="block text-sm font-semibold mb-1">PII Redaction</label>
                  <p className="text-xs text-gray-400">
                    Automatically redact email addresses, IP addresses, and API keys from crash logs
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.piiRedactionEnabled}
                  onChange={(e) => setSettings({ ...settings, piiRedactionEnabled: e.target.checked })}
                  className="w-5 h-5 rounded accent-blue-500"
                />
              </div>
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === "advanced" && (
            <div className="space-y-6">
              {/* Active Providers */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">
                  Active Providers
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    ({Object.values(settings.activeProviders).filter(Boolean).length} enabled)
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
                      circuitState === "healthy" ? <Check className="w-3 h-3" /> :
                      circuitState === "degraded" ? <AlertTriangle className="w-3 h-3" /> :
                      <XCircle className="w-3 h-3" />;

                    return (
                      <label
                        key={provider.value}
                        className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${
                          settings.activeProviders[provider.value]
                            ? "bg-blue-500/10 border-blue-500/30"
                            : "bg-gray-900/50 border-gray-700 opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={settings.activeProviders[provider.value]}
                            onChange={() => handleToggleProvider(provider.value)}
                            className="w-4 h-4 rounded accent-blue-500"
                          />
                          <span className="text-sm font-medium">{provider.label}</span>
                        </div>
                        <div className={`flex items-center gap-1 text-xs ${stateColor}`}>
                          {stateIcon}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Updates */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">Updates</label>
                <button
                  onClick={handleCheckForUpdates}
                  disabled={isCheckingUpdate || !isOnline}
                  className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2"
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
                  <div className={`p-3 rounded-lg text-sm ${
                    updateMessage.includes("up to date")
                      ? "bg-green-500/10 border border-green-500/20 text-green-400"
                      : updateMessage.includes("available")
                      ? "bg-blue-500/10 border border-blue-500/20 text-blue-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}>
                    {updateMessage}
                  </div>
                )}
              </div>

              {/* Diagnostics */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">Diagnostics</label>
                <button
                  onClick={handleExportDiagnostics}
                  className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  <Clipboard className="w-4 h-4" />
                  Export Diagnostics to Clipboard
                </button>
                <p className="text-xs text-gray-500">
                  Copies system info for troubleshooting (API keys excluded)
                </p>
                {diagnosticsMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    diagnosticsMessage.includes("copied")
                      ? "bg-green-500/10 border border-green-500/20 text-green-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}>
                    {diagnosticsMessage}
                  </div>
                )}
              </div>

              {/* Auto-Tagging */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">Auto-Tagging</label>
                <button
                  onClick={handleAutoTagHistory}
                  disabled={isAutoTagging}
                  className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2"
                >
                  {isAutoTagging ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Tagging...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Auto-tag History
                    </>
                  )}
                </button>
                <p className="text-xs text-gray-500">
                  Applies deterministic tags to analyses without tags (severity, type, patterns).
                </p>
                {autoTagMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    autoTagMessage.includes("complete")
                      ? "bg-green-500/10 border border-green-500/20 text-green-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}>
                    {autoTagMessage}
                  </div>
                )}
              </div>

              {/* Console */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">Application Console</label>
                <Suspense fallback={
                  <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
                      <span className="text-gray-400 text-sm">Loading console...</span>
                    </div>
                  </div>
                }>
                  <div className="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
                    <EmbeddedConsoleViewer defaultAutoScroll={false} parentScrollRef={contentScrollRef} />
                  </div>
                </Suspense>
              </div>

              {/* Database Admin */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">Database Administration</label>
                <Suspense fallback={
                  <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
                      <span className="text-gray-400 text-sm">Loading database info...</span>
                    </div>
                  </div>
                }>
                  <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4">
                    <DatabaseAdminSection onRefresh={onSettingsChange} />
                  </div>
                </Suspense>
              </div>

              {/* Ask Hadron Data (Task 24) */}
              <div className="space-y-3">
                <label className="block text-sm font-semibold">Ask Hadron Data</label>

                {/* Gold Answers */}
                <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-300">Gold Answers</p>
                      <p className="text-xs text-gray-500">
                        Curated Q&A pairs for RAG training
                        {goldCount !== null && (
                          <span className="ml-1 text-amber-400">({goldCount} saved)</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        setIsExportingGold(true);
                        setGoldExportMsg(null);
                        try {
                          const jsonl = await exportGoldAnswersJsonl({});
                          const filePath = await tauriSave({
                            defaultPath: `gold-answers-${new Date().toISOString().split("T")[0]}.jsonl`,
                            filters: [{ name: "JSONL", extensions: ["jsonl"] }],
                          });
                          if (filePath) {
                            await writeTextFile(filePath, jsonl);
                            setGoldExportMsg(`Exported to ${filePath}`);
                          }
                        } catch (e) {
                          setGoldExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
                        } finally {
                          setIsExportingGold(false);
                          safeTimeout(() => setGoldExportMsg(null), 5000);
                        }
                      }}
                      disabled={isExportingGold || goldCount === 0}
                      className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-amber-400 disabled:text-gray-500 rounded-lg transition text-xs flex items-center gap-1.5"
                    >
                      {isExportingGold ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      Export as JSONL
                    </button>
                  </div>
                  {goldExportMsg && (
                    <p className={`text-xs ${goldExportMsg.includes("failed") ? "text-red-400" : "text-green-400"}`}>
                      {goldExportMsg}
                    </p>
                  )}
                </div>

                {/* Session Summaries */}
                <div className="bg-gray-900/50 rounded-lg border border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-300">Session Summaries</p>
                      <p className="text-xs text-gray-500">
                        AI-generated session summaries for RAG indexing
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        setIsExportingSummaries(true);
                        setSummaryExportMsg(null);
                        try {
                          const bundle = await exportSummariesBundle({});
                          const filePath = await tauriSave({
                            defaultPath: `summaries-rag-${new Date().toISOString().split("T")[0]}.jsonl`,
                            filters: [{ name: "JSONL", extensions: ["jsonl"] }],
                          });
                          if (filePath) {
                            await writeTextFile(filePath, bundle);
                            setSummaryExportMsg(`Exported to ${filePath}`);
                          }
                        } catch (e) {
                          setSummaryExportMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
                        } finally {
                          setIsExportingSummaries(false);
                          safeTimeout(() => setSummaryExportMsg(null), 5000);
                        }
                      }}
                      disabled={isExportingSummaries}
                      className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 disabled:bg-gray-700 disabled:cursor-not-allowed text-blue-400 disabled:text-gray-500 rounded-lg transition text-xs flex items-center gap-1.5"
                    >
                      {isExportingSummaries ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      Export for RAG
                    </button>
                  </div>
                  {summaryExportMsg && (
                    <p className={`text-xs ${summaryExportMsg.includes("failed") ? "text-red-400" : "text-green-400"}`}>
                      {summaryExportMsg}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex gap-3">
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="flex-1 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition flex items-center justify-center gap-2 font-medium"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            Cancel
          </button>
        </div>

        {/* Save Message Toast */}
        {saveMessage && (
          <div className={`absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm ${
            saveMessage.includes("successfully") || saveMessage.includes("cleared")
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}>
            {saveMessage}
          </div>
        )}
      </div>
    </div>
  );
}
