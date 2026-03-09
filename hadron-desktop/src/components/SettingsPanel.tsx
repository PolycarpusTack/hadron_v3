import { useState, useEffect, Suspense, lazy, useRef, useCallback } from "react";
import { X, Settings, Save, Eye, EyeOff, Moon, Sun, Activity, AlertTriangle, XCircle, Download, RefreshCw, Check, AlertCircle, Clipboard, Info, Cpu, Shield, Code, MessageCircle, Zap, ChevronDown, FolderOpen } from "lucide-react";
import { getCircuitState } from "../services/circuit-breaker";
import { getApiKey, storeApiKey, deleteApiKey } from "../services/secure-storage";
import { checkForUpdates } from "../services/updater";
import { isJiraEnabled } from "../services/jira";
import { isSentryEnabled } from "../services/sentry";
import { listModels as listModelsAPI, testConnection as testConnectionAPI, autoTagAnalyses } from "../services/api";
import { invoke } from "@tauri-apps/api/core";
import { getKeeperConfig, type KeeperConfig } from "../services/keeper";
import { listGoldAnswers, exportGoldAnswersJsonl } from "../services/gold-answers";
import { exportSummariesBundle } from "../services/summaries";
import { save as tauriSave, open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import logger from '../services/logger';
import { AI_PROVIDERS, getDefaultModelForProvider, getCuratedModelsForProvider, MODEL_CACHE_TTL_MS } from '../constants/providers';
import { STORAGE_KEYS, providerModelKey, providerModelsCacheKey } from '../utils/config';
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import FeatureToggleRow from "./FeatureToggleRow";

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
  isInline?: boolean;
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

// AI_PROVIDERS imported from constants/providers.ts

export default function SettingsPanel({
  isOpen,
  onClose,
  darkMode,
  onThemeChange,
  onSettingsChange,
  isInline = false,
}: SettingsPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [integrationsExpanded, setIntegrationsExpanded] = useState(false);
  const [defaultAnalysisMode, setDefaultAnalysisMode] = useState(
    () => localStorage.getItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE) || "quick"
  );
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

  // Integration status
  const [jiraConnected, setJiraConnected] = useState(false);
  const [sentryConnected, setSentryConnected] = useState(false);

  // Ask Hadron Data state (Task 24)
  const [goldCount, setGoldCount] = useState<number | null>(null);
  const [summaryExportMsg, setSummaryExportMsg] = useState<string | null>(null);
  const [goldExportMsg, setGoldExportMsg] = useState<string | null>(null);
  const [isExportingGold, setIsExportingGold] = useState(false);
  const [isExportingSummaries, setIsExportingSummaries] = useState(false);

  // Crash log directory
  const [crashLogDir, setCrashLogDir] = useState<string>("");
  const [defaultExportDir, setDefaultExportDir] = useState(
    () => localStorage.getItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR) || ""
  );
  const [crashLogMsg, setCrashLogMsg] = useState<string | null>(null);

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
    model: getDefaultModelForProvider("openai"),
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

  // Check integration connection status
  useEffect(() => {
    if (isOpen) {
      isJiraEnabled().then(setJiraConnected).catch(() => setJiraConnected(false));
      isSentryEnabled().then(setSentryConnected).catch(() => setSentryConnected(false));
    }
  }, [isOpen]);

  // Load gold answer count for Ask Hadron Data section (Task 24)
  useEffect(() => {
    if (isOpen && advancedOpen) {
      listGoldAnswers(1000, 0).then((golds) => {
        setGoldCount(golds.length);
      }).catch(() => setGoldCount(null));
      // Load crash log directory
      invoke<string>("get_crash_log_dir").then(setCrashLogDir).catch(() => {});
    }
  }, [isOpen, advancedOpen]);

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
    const provider = localStorage.getItem(STORAGE_KEYS.AI_PROVIDER) || "openai";

    // Load ALL API keys
    const openaiKey = await getApiKey("openai") || "";
    const anthropicKey = await getApiKey("anthropic") || "";
    const zaiKey = await getApiKey("zai") || "";

    const model = localStorage.getItem(STORAGE_KEYS.AI_MODEL) || getDefaultModelForProvider(provider);
    const customModel = localStorage.getItem(STORAGE_KEYS.AI_CUSTOM_MODEL) || "";
    const auxiliaryModel = localStorage.getItem(STORAGE_KEYS.AI_AUXILIARY_MODEL) || "";
    const piiRedactionEnabled = localStorage.getItem(STORAGE_KEYS.PII_REDACTION_ENABLED) === "true";

    // Load active providers
    const savedActiveProviders = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROVIDERS);
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
    const cacheKey = providerModelsCacheKey(provider);
    const cached = localStorage.getItem(cacheKey);
    let cacheIsStale = true;
    if (cached) {
      try {
        const cacheData = JSON.parse(cached);
        const age = Date.now() - cacheData.timestamp;
        // Always load cached models (even if stale -- better than empty dropdown)
        if (cacheData.models?.length > 0) {
          setCachedModels(prev => ({
            ...prev,
            [provider]: cacheData.models
          }));
        }
        cacheIsStale = age >= MODEL_CACHE_TTL_MS;
      } catch (e) {
        logger.warn('Failed to load cached models', { error: String(e) });
      }
    }

    // Auto-refresh in background if cache is stale or empty
    if (cacheIsStale) {
      const apiKey = provider === "llamacpp"
        ? ""
        : (provider === "openai" ? openaiKey : provider === "anthropic" ? anthropicKey : zaiKey);
      if (provider === "llamacpp" || apiKey) {
        listModelsAPI(provider, apiKey).then((models) => {
          const newCacheData = { models, timestamp: Date.now() };
          localStorage.setItem(providerModelsCacheKey(provider), JSON.stringify(newCacheData));
          setCachedModels(prev => ({ ...prev, [provider]: models as ModelOption[] }));
          logger.info('Auto-refreshed model list', { provider, count: models.length });
        }).catch((err) => {
          logger.warn('Background model refresh failed', { provider, error: String(err) });
        });
      }
    }
  }

  const handleProviderChange = (newProvider: string) => {
    const defaultModel = getDefaultModelForProvider(newProvider);

    const savedModel = localStorage.getItem(providerModelKey(newProvider));

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
      localStorage.setItem(STORAGE_KEYS.AI_PROVIDER, settings.provider);

      // Save the actual model (custom if selected, otherwise the dropdown value)
      const modelToSave = settings.model === "custom" ? settings.customModel : settings.model;
      localStorage.setItem(STORAGE_KEYS.AI_MODEL, modelToSave);
      localStorage.setItem(providerModelKey(settings.provider), modelToSave);
      localStorage.setItem(STORAGE_KEYS.AI_CUSTOM_MODEL, settings.customModel);

      // Save auxiliary model
      if (settings.auxiliaryModel) {
        localStorage.setItem(STORAGE_KEYS.AI_AUXILIARY_MODEL, settings.auxiliaryModel);
      } else {
        localStorage.removeItem("ai_auxiliary_model");
      }

      // Save PII redaction setting
      localStorage.setItem(STORAGE_KEYS.PII_REDACTION_ENABLED, String(settings.piiRedactionEnabled));

      // Save active providers
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROVIDERS, JSON.stringify(settings.activeProviders));

      // Save default analysis mode
      localStorage.setItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE, defaultAnalysisMode);

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
      localStorage.setItem(providerModelsCacheKey(settings.provider), JSON.stringify(cacheData));

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

  // Use cached models if available, otherwise fall back to curated list
  const rawModels = cachedModels[settings.provider]?.length
    ? cachedModels[settings.provider]
    : getCuratedModelsForProvider(settings.provider);

  // Ensure the currently saved model always appears in the dropdown
  const savedModelInList = rawModels.some((m) => m.id === settings.model);
  const currentModels = savedModelInList || settings.model === "custom"
    ? rawModels
    : [{ id: settings.model, label: settings.model, context: undefined, category: "saved" }, ...rawModels];
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

  const handleAnalysisModeChange = (mode: string) => {
    setDefaultAnalysisMode(mode);
    localStorage.setItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE, mode);
  };

  const settingsContent = (
      <div className={`${isInline ? "hd-panel" : "hd-modal-shell"} flex ${isInline ? "min-h-0 h-full" : "max-h-[85vh]"} w-full ${isInline ? "" : "max-w-4xl"} flex-col overflow-hidden`}>
        {/* Header */}
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--hd-border)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-emerald-500/15 p-2">
                <Settings className="h-5 w-5 text-emerald-400" />
              </span>
              <div>
                <h2 className="text-xl font-bold" style={{ color: 'var(--hd-text)' }}>Settings</h2>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--hd-text-muted)' }}>Provider, integrations, preferences, and advanced tools</p>
              </div>
            </div>
            {!isInline && (
              <button
                onClick={onClose}
                className="rounded-lg p-2 transition hover:bg-gray-700"
                aria-label="Close settings"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="hd-chip hd-chip-emerald">Encrypted secrets</span>
            {!isOnline && (
              <span className="hd-chip border-yellow-500/30 bg-yellow-500/10 text-yellow-300">Offline mode</span>
            )}
          </div>
        </div>

        {/* Content */}
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Network Status Banner */}
          {!isOnline && (
            <div className="mb-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
              <div>
                <p className="font-semibold text-yellow-300">Offline Mode</p>
                <p className="text-sm text-gray-400">
                  Cloud AI providers unavailable. llama.cpp will work if running locally.
                </p>
              </div>
            </div>
          )}

          {/* Row 1: 3-column card grid */}
          <div className="grid grid-cols-3 gap-4">
            {/* AI Provider Card */}
            <div className="hd-config-grid-card">
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>AI Provider</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <strong className="text-sm" style={{ color: 'var(--hd-text)' }}>
                    {AI_PROVIDERS.find(p => p.value === settings.provider)?.label || settings.provider}
                  </strong>
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: 'var(--hd-accent)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}>Configured</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>
                  Model: {settings.model === 'custom' ? settings.customModel : settings.model}
                </p>
                {settings.auxiliaryModel && (
                  <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                    Auxiliary: {settings.auxiliaryModel}
                  </p>
                )}
                <div className="flex flex-col gap-2 mt-2">
                  <button className="hd-btn-ghost text-xs w-full py-1.5" onClick={() => setAdvancedOpen(true)}>
                    Change Provider
                  </button>
                  <button
                    className="hd-btn-ghost text-xs w-full py-1.5 flex items-center justify-center gap-1.5"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection || (settings.provider !== 'llamacpp' && !isKeeperActiveForProvider && !settings.apiKeys[settings.provider as keyof typeof settings.apiKeys]) || (settings.provider !== 'llamacpp' && !isOnline)}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    {isTestingConnection ? "Testing..." : "Test Connection"}
                  </button>
                  {connectionTestResult && (
                    <div className={`text-xs px-2 py-1 rounded ${
                      connectionTestResult.toLowerCase().includes("success") || connectionTestResult.toLowerCase().includes("found")
                        ? "text-green-400" : "text-red-400"
                    }`}>
                      {connectionTestResult}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Integrations Card */}
            <div className="hd-config-grid-card">
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>Integrations</h3>
              <div className="space-y-1">
                {/* JIRA row */}
                <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--hd-border-subtle)' }}>
                  <span className="text-sm" style={{ color: 'var(--hd-text)' }}>JIRA</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${jiraConnected ? 'text-green-400 border-green-600/30' : ''}`} style={jiraConnected ? { background: 'var(--hd-bg-surface)', border: '1px solid' } : { background: 'var(--hd-bg-surface)', color: 'var(--hd-text-dim)', border: '1px solid var(--hd-border-subtle)' }}>
                    {jiraConnected ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                {/* Sentry row */}
                <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--hd-border-subtle)' }}>
                  <span className="text-sm" style={{ color: 'var(--hd-text)' }}>Sentry</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${sentryConnected ? 'text-green-400 border-green-600/30' : ''}`} style={sentryConnected ? { background: 'var(--hd-bg-surface)', border: '1px solid' } : { background: 'var(--hd-bg-surface)', color: 'var(--hd-text-dim)', border: '1px solid var(--hd-border-subtle)' }}>
                    {sentryConnected ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                {/* Knowledge Base row */}
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm" style={{ color: 'var(--hd-text)' }}>Knowledge Base</span>
                  <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--hd-bg-surface)', color: 'var(--hd-text-dim)', border: '1px solid var(--hd-border-subtle)' }}>Not Indexed</span>
                </div>
              </div>
              <button className="hd-btn-ghost text-xs w-full py-1.5 mt-3" onClick={() => setIntegrationsExpanded(!integrationsExpanded)}>
                {integrationsExpanded ? 'Hide Details' : 'Manage Integrations'}
              </button>
            </div>

            {/* Preferences Card */}
            <div className="hd-config-grid-card">
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>Preferences</h3>
              <div className="space-y-3">
                {/* Theme toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm" style={{ color: 'var(--hd-text)' }}>Theme</p>
                    <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Light / Dark</p>
                  </div>
                  <button
                    onClick={() => onThemeChange(!darkMode)}
                    className={`hd-toggle ${darkMode ? "bg-blue-600" : "bg-gray-600"}`}
                  >
                    <div className={`hd-toggle-knob hd-toggle-knob-icon ${darkMode ? "translate-x-7" : "translate-x-1"}`}>
                      {darkMode ? <Moon className="w-4 h-4 text-blue-600" /> : <Sun className="w-4 h-4 text-yellow-500" />}
                    </div>
                  </button>
                </div>

                {/* PII Redaction toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm" style={{ color: 'var(--hd-text)' }}>PII Redaction</p>
                    <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Auto-strip PII</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, piiRedactionEnabled: !settings.piiRedactionEnabled })}
                    className={`hd-toggle ${settings.piiRedactionEnabled ? "bg-blue-600" : "bg-gray-600"}`}
                  >
                    <div className={`hd-toggle-knob hd-toggle-knob-icon ${settings.piiRedactionEnabled ? "translate-x-7" : "translate-x-1"}`}>
                      <Shield className={`w-4 h-4 ${settings.piiRedactionEnabled ? "text-blue-600" : "text-gray-400"}`} />
                    </div>
                  </button>
                </div>

                {/* Default Analysis mode segmented control */}
                <div>
                  <p className="text-sm mb-1.5" style={{ color: 'var(--hd-text)' }}>Default Analysis</p>
                  <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--hd-border-subtle)' }}>
                    <button
                      onClick={() => handleAnalysisModeChange("quick")}
                      className="flex-1 px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        background: defaultAnalysisMode === "quick" ? 'var(--hd-accent)' : 'transparent',
                        color: defaultAnalysisMode === "quick" ? '#052e24' : 'var(--hd-text-muted)',
                      }}
                    >
                      Quick
                    </button>
                    <button
                      onClick={() => handleAnalysisModeChange("comprehensive")}
                      className="flex-1 px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        background: defaultAnalysisMode === "comprehensive" ? 'var(--hd-accent)' : 'transparent',
                        color: defaultAnalysisMode === "comprehensive" ? '#052e24' : 'var(--hd-text-muted)',
                        borderLeft: '1px solid var(--hd-border-subtle)',
                      }}
                    >
                      Comprehensive
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Expanded Integrations */}
          {integrationsExpanded && (
            <div className="hd-panel p-4 space-y-4">
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

          {/* Row 2: Collapsible Advanced Section */}
          <div className="hd-panel" style={{ overflow: 'hidden' }}>
            <div className="hd-collapsible-header" onClick={() => setAdvancedOpen(!advancedOpen)}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>Advanced</h3>
              <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--hd-text-muted)' }} />
            </div>
            {advancedOpen && (
              <div className="p-4 pt-0 space-y-6">
                {/* Full AI Config section (shown when Advanced is expanded) */}
                <div className="hd-config-grid-card space-y-4">
                  <h4 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>AI Configuration</h4>

                  {/* Provider Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>Provider</label>
                    <select
                      value={settings.provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
                    >
                      {AI_PROVIDERS.filter(p => settings.activeProviders[p.value]).map((provider) => (
                        <option key={provider.value} value={provider.value}>
                          {provider.label}
                        </option>
                      ))}
                    </select>

                    {settings.provider === "llamacpp" && (
                      <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="flex items-start gap-3">
                          <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-blue-300">llama.cpp (Local)</p>
                            <p className="text-xs text-gray-400 mt-1">
                              No API key required. Start <code className="bg-gray-900 px-1 py-0.5 rounded text-blue-400">llama-server</code> on <code className="bg-gray-900 px-1 py-0.5 rounded text-blue-400">localhost:8080</code>
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Keeper Secrets Manager */}
                  <Suspense fallback={
                    <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                      <div className="flex items-center gap-3">
                        <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" />
                        <span className="text-gray-400 text-sm">Loading Keeper settings...</span>
                      </div>
                    </div>
                  }>
                    <KeeperSettings onConfigChange={() => {
                      onSettingsChange?.();
                      getKeeperConfig().then((config) => {
                        setKeeperConfig(config);
                        const isActive = config.enabled && !!config.secretMappings[settings.provider as keyof typeof config.secretMappings];
                        if (isActive) setShowManualKeys(false);
                        else setShowManualKeys(true);
                      }).catch(() => {});
                    }} />
                  </Suspense>

                  {/* Manual API Key */}
                  {settings.provider !== "llamacpp" && (
                    <div className="space-y-3">
                      <button
                        onClick={() => setShowManualKeys(!showManualKeys)}
                        className="flex items-center gap-2 w-full text-left group"
                      >
                        <ChevronDown className={`w-4 h-4 transition-transform ${showManualKeys ? '' : '-rotate-90'}`} style={{ color: 'var(--hd-text-muted)' }} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>Manual API Key</span>
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
                      <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>Model</label>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRefreshModels}
                        disabled={isRefreshingModels || (settings.provider !== 'llamacpp' && !isKeeperActiveForProvider && !settings.apiKeys[settings.provider as keyof typeof settings.apiKeys])}
                        loading={isRefreshingModels}
                        icon={<RefreshCw />}
                      >
                        Refresh Models
                      </Button>
                    </div>
                    <select
                      value={settings.model}
                      onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
                    >
                      {currentModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} {m.context ? `(${(m.context / 1000).toFixed(0)}K)` : ""}
                        </option>
                      ))}
                      <option value="custom">Custom Model...</option>
                    </select>

                    {settings.model === "custom" && (
                      <input
                        type="text"
                        value={settings.customModel}
                        onChange={(e) => setSettings({ ...settings, customModel: e.target.value })}
                        placeholder="Enter custom model name"
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
                      />
                    )}

                    {modelsMessage && (
                      <p className="text-xs text-green-400">{modelsMessage}</p>
                    )}
                  </div>

                  {/* Lightweight Model */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>Lightweight Model (Optional)</label>
                    <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                      Use a cheaper model for internal calls (query planning, search expansion, tool decisions).
                    </p>
                    <select
                      value={settings.auxiliaryModel}
                      onChange={(e) => setSettings({ ...settings, auxiliaryModel: e.target.value })}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm"
                    >
                      <option value="">Same as main model (no savings)</option>
                      {settings.provider === "openai" && (
                        <>
                          <option value="gpt-4o-mini">GPT-4o Mini (recommended)</option>
                          <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                        </>
                      )}
                      {settings.provider === "anthropic" && (
                        <option value="claude-haiku-4-5-20251001">Claude 4.5 Haiku (recommended)</option>
                      )}
                      {settings.provider === "zai" && (
                        <option value="glm-4-flash">GLM-4 Flash (recommended)</option>
                      )}
                      {settings.provider === "llamacpp" && (
                        <option value="default">Default (local - no cost)</option>
                      )}
                    </select>
                  </div>
                </div>

                {/* 3-column sub-grid */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Column 1: Visible Menu Items */}
                  <div>
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Visible Menu Items</p>
                    <p className="text-xs mb-3" style={{ color: 'var(--hd-text-dim)' }}>Toggle optional navigation tabs</p>
                    <div className="space-y-2">
                      <FeatureToggleRow
                        storageKey={STORAGE_KEYS.FEATURE_CODE_ANALYZER}
                        label="Code Analyzer"
                        description="AI-powered code review and security scanning"
                        icon={<Code className="w-4 h-4 text-violet-400" />}
                        accent="violet"
                        onToggle={() => onSettingsChange?.()}
                      />
                      <FeatureToggleRow
                        storageKey={STORAGE_KEYS.FEATURE_PERFORMANCE_ANALYZER}
                        label="Performance Analyzer"
                        description="Analyze performance traces and bottlenecks"
                        icon={<Cpu className="w-4 h-4 text-cyan-400" />}
                        accent="cyan"
                        onToggle={() => onSettingsChange?.()}
                      />
                      <FeatureToggleRow
                        storageKey={STORAGE_KEYS.FEATURE_ASK_HADRON}
                        label="Ask Hadron"
                        description="AI chat assistant with knowledge retrieval"
                        icon={<MessageCircle className="w-4 h-4 text-emerald-400" />}
                        accent="emerald"
                        onToggle={() => onSettingsChange?.()}
                      />
                      <FeatureToggleRow
                        storageKey={STORAGE_KEYS.FEATURE_HOVER_BUTTON}
                        label="Hover Button (Elena)"
                        description="Floating widget for quick analysis (Ctrl+Shift+H)"
                        icon={<Zap className="w-4 h-4 text-blue-400" />}
                        accent="blue"
                        onToggle={() => onSettingsChange?.()}
                      />
                    </div>
                  </div>

                  {/* Column 2: Active Providers */}
                  <div>
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Active Providers</p>
                    <p className="text-xs mb-3" style={{ color: 'var(--hd-text-dim)' }}>
                      Enable/disable AI backends ({Object.values(settings.activeProviders).filter(Boolean).length} enabled)
                    </p>
                    <div className="flex flex-col gap-2">
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
                            className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition text-sm ${
                              settings.activeProviders[provider.value]
                                ? "bg-blue-500/10 border-blue-500/30"
                                : "bg-gray-900/50 border-gray-700 opacity-60"
                            }`}
                          >
                            <div className="flex items-center gap-2">
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

                  {/* Column 3: Maintenance */}
                  <div>
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Maintenance</p>
                    <p className="text-xs mb-3" style={{ color: 'var(--hd-text-dim)' }}>System tools and data exports</p>
                    <div className="flex flex-col gap-2">
                      {/* Check for Updates */}
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={handleCheckForUpdates}
                        disabled={isCheckingUpdate || !isOnline}
                        loading={isCheckingUpdate}
                        icon={<Download />}
                      >
                        {isCheckingUpdate ? "Checking..." : "Check for Updates"}
                      </Button>
                      {updateMessage && (
                        <p className={`text-xs px-2 ${
                          updateMessage.includes("up to date") ? "text-green-400" :
                          updateMessage.includes("available") ? "text-blue-400" :
                          "text-red-400"
                        }`}>
                          {updateMessage}
                        </p>
                      )}

                      {/* Export Diagnostics */}
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={handleExportDiagnostics}
                        icon={<Clipboard />}
                      >
                        Export Diagnostics
                      </Button>
                      {diagnosticsMessage && (
                        <p className={`text-xs px-2 ${
                          diagnosticsMessage.includes("copied") ? "text-green-400" : "text-red-400"
                        }`}>
                          {diagnosticsMessage}
                        </p>
                      )}

                      {/* Auto-tag History */}
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={handleAutoTagHistory}
                        disabled={isAutoTagging}
                        loading={isAutoTagging}
                        icon={<Check />}
                      >
                        {isAutoTagging ? "Tagging..." : "Auto-tag History"}
                      </Button>
                      {autoTagMessage && (
                        <p className={`text-xs px-2 ${
                          autoTagMessage.includes("complete") ? "text-green-400" : "text-red-400"
                        }`}>
                          {autoTagMessage}
                        </p>
                      )}

                      {/* Crash Log Directory */}
                      <div className="hd-setting-card space-y-2 mt-1">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Crash Log Directory</p>
                            <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                              Where crash reports are saved
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={crashLogDir}
                            readOnly
                            className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono"
                            style={{ color: 'var(--hd-text-muted)' }}
                            title={crashLogDir}
                          />
                          <button
                            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                            title="Choose folder"
                            onClick={async () => {
                              try {
                                const selected = await tauriOpen({ directory: true, title: "Select Crash Log Directory" });
                                if (selected) {
                                  const result = await invoke<string>("set_crash_log_dir", { dir: selected });
                                  setCrashLogDir(result);
                                  setCrashLogMsg("Crash log directory updated");
                                  safeTimeout(() => setCrashLogMsg(null), 4000);
                                }
                              } catch (e) {
                                setCrashLogMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
                                safeTimeout(() => setCrashLogMsg(null), 5000);
                              }
                            }}
                          >
                            <FolderOpen className="w-3.5 h-3.5" style={{ color: 'var(--hd-text-muted)' }} />
                          </button>
                          <button
                            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                            style={{ color: 'var(--hd-text-muted)' }}
                            title="Reset to default"
                            onClick={async () => {
                              try {
                                const result = await invoke<string>("set_crash_log_dir", { dir: "" });
                                setCrashLogDir(result);
                                setCrashLogMsg("Reset to default");
                                safeTimeout(() => setCrashLogMsg(null), 4000);
                              } catch (e) {
                                setCrashLogMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
                                safeTimeout(() => setCrashLogMsg(null), 5000);
                              }
                            }}
                          >
                            Reset
                          </button>
                        </div>
                        {crashLogMsg && (
                          <p className={`text-xs ${crashLogMsg.includes("Failed") ? "text-red-400" : "text-green-400"}`}>
                            {crashLogMsg}
                          </p>
                        )}
                      </div>

                      {/* Default Export Location */}
                      <div className="hd-setting-card space-y-2 mt-1">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Default Export Location</p>
                            <p className="text-xs truncate max-w-xs" style={{ color: 'var(--hd-text-dim)' }}>
                              {defaultExportDir || "Not set — exports download to browser default"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={defaultExportDir}
                            readOnly
                            className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono"
                            style={{ color: 'var(--hd-text-muted)' }}
                            placeholder="Not set"
                            title={defaultExportDir || "Not set"}
                          />
                          <button
                            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                            title="Choose folder"
                            onClick={async () => {
                              const selected = await tauriOpen({ directory: true, title: "Select Default Export Directory" });
                              if (selected) {
                                localStorage.setItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR, selected as string);
                                setDefaultExportDir(selected as string);
                              }
                            }}
                          >
                            <FolderOpen className="w-3.5 h-3.5" style={{ color: 'var(--hd-text-muted)' }} />
                          </button>
                          {defaultExportDir && (
                            <button
                              className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                              style={{ color: 'var(--hd-text-muted)' }}
                              title="Clear default export location"
                              onClick={() => {
                                localStorage.removeItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR);
                                setDefaultExportDir("");
                              }}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Database Admin */}
                      <Suspense fallback={
                        <div className="flex items-center gap-2 p-2 text-xs text-gray-400">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Loading database...
                        </div>
                      }>
                        <div className="hd-setting-card mt-1">
                          <DatabaseAdminSection onRefresh={onSettingsChange} />
                        </div>
                      </Suspense>

                      {/* Console */}
                      <Suspense fallback={
                        <div className="flex items-center gap-2 p-2 text-xs text-gray-400">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Loading console...
                        </div>
                      }>
                        <div className="hd-setting-card overflow-hidden mt-1">
                          <EmbeddedConsoleViewer defaultAutoScroll={false} parentScrollRef={contentScrollRef} />
                        </div>
                      </Suspense>

                      {/* Ask Hadron Data */}
                      <div className="mt-1 space-y-2">
                        <p className="text-xs font-semibold" style={{ color: 'var(--hd-text-muted)' }}>Ask Hadron Data</p>

                        {/* Gold Answers */}
                        <div className="hd-setting-card space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Gold Answers</p>
                              <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                                Curated Q&A pairs
                                {goldCount !== null && (
                                  <span className="ml-1 text-amber-400">({goldCount})</span>
                                )}
                              </p>
                            </div>
                            <Button
                              size="sm"
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
                              loading={isExportingGold}
                              icon={<Download />}
                              className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-400"
                            >
                              JSONL
                            </Button>
                          </div>
                          {goldExportMsg && (
                            <p className={`text-xs ${goldExportMsg.includes("failed") ? "text-red-400" : "text-green-400"}`}>
                              {goldExportMsg}
                            </p>
                          )}
                        </div>

                        {/* Session Summaries */}
                        <div className="hd-setting-card space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Summaries</p>
                              <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>RAG-ready session data</p>
                            </div>
                            <Button
                              size="sm"
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
                              loading={isExportingSummaries}
                              icon={<Download />}
                              className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400"
                            >
                              RAG
                            </Button>
                          </div>
                          {summaryExportMsg && (
                            <p className={`text-xs ${summaryExportMsg.includes("failed") ? "text-red-400" : "text-green-400"}`}>
                              {summaryExportMsg}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-3" style={{ borderTop: '1px solid var(--hd-border)' }}>
          <Button
            variant="primary"
            size="lg"
            onClick={handleSaveSettings}
            disabled={isSaving}
            loading={isSaving}
            icon={<Save />}
            className="flex-1 justify-center font-medium"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
          {!isInline && (
            <Button
              variant="secondary"
              size="lg"
              onClick={onClose}
            >
              Cancel
            </Button>
          )}
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
  );

  if (isInline) {
    return settingsContent;
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      {settingsContent}
    </Modal>
  );
}
