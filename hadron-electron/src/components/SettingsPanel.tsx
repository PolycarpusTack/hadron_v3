import { useState, useEffect, Suspense, lazy, useRef, useCallback } from "react";
import { X, Settings, Save, Eye, EyeOff, Moon, Sun, Activity, AlertTriangle, XCircle, RefreshCw, Check, AlertCircle, Info, Shield, ChevronDown } from "lucide-react";
import { getApiKey, storeApiKey, deleteApiKey } from "../services/secure-storage";
import { listModels as listModelsAPI, testConnection as testConnectionAPI } from "../services/api";
import { getKeeperConfig, getKeeperSecretForProvider, type KeeperConfig } from "../services/keeper";
import logger from '../services/logger';
import { AI_PROVIDERS, getDefaultModelForProvider, getCuratedModelsForProvider, MODEL_CACHE_TTL_MS } from '../constants/providers';
import type { ProviderKey } from '../constants/providers';
import type { SettingsSection } from './settings/types';
import { isIntegrationSection } from './settings/types';
import SettingsSidebar from './settings/SettingsSidebar';
import SettingsDashboard from './settings/SettingsDashboard';
import CodexMgXSettings from './settings/CodexMgXSettings';
import MaintenanceSection from './settings/MaintenanceSection';
import PreferencesSection from './settings/PreferencesSection';

type ApiKeyProvider = 'openai' | 'anthropic' | 'zai';
import { STORAGE_KEYS, providerModelKey, providerModelsCacheKey } from '../utils/config';
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import ModelPicker from "./ui/ModelPicker";

// Lazy load heavy components since most users won't use them
const KeeperSettings = lazy(() => import("./KeeperSettings"));
const JiraSettings = lazy(() => import("./JiraSettings"));
const SentrySettings = lazy(() => import("./SentrySettings"));
const OpenSearchSettings = lazy(() => import("./OpenSearchSettings"));

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
  onSettingsChange?: () => void;
  isInline?: boolean;
  initialSection?: SettingsSection;
}

interface Settings {
  provider: ProviderKey;
  apiKeys: Record<ApiKeyProvider, string>;
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
  maxOutputTokens?: number;
  preferredEndpoint?: "responses" | "chat_completions";
  suitableForHadron?: boolean;
}

const OPENAI_LARGE_FILE_UNSUITABLE_DEFAULTS = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
]);

// AI_PROVIDERS imported from constants/providers.ts

export default function SettingsPanel({
  isOpen,
  onClose,
  darkMode,
  onThemeChange,
  onSettingsChange,
  isInline = false,
  initialSection,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? 'dashboard');
  const [localIntegrationsOpen, setLocalIntegrationsOpen] = useState(false);
  const integrationsOpen = localIntegrationsOpen || isIntegrationSection(activeSection);

  const handleSelectSection = (s: SettingsSection) => {
    setActiveSection(s);
    if (isIntegrationSection(s) && !localIntegrationsOpen) {
      setLocalIntegrationsOpen(true);
    }
  };

  const handleToggleIntegrations = () => {
    if (!isIntegrationSection(activeSection)) {
      setLocalIntegrationsOpen(prev => !prev);
    }
    // Silently ignore collapse attempts when a child section is active
  };

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [integrationsExpanded, setIntegrationsExpanded] = useState(false);
  const [defaultAnalysisMode, setDefaultAnalysisMode] = useState(
    () => localStorage.getItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE) || "quick"
  );
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [keeperConfig, setKeeperConfig] = useState<KeeperConfig | null>(null);
  const [showManualKeys, setShowManualKeys] = useState(true);


  const contentScrollRef = useRef<HTMLDivElement>(null);

  const [showApiKeys, setShowApiKeys] = useState({
    openai: false,
    anthropic: false,
    zai: false,
  });

  const [cachedModels, setCachedModels] = useState<Record<string, ModelOption[]>>({});
  const [modelFilter, setModelFilter] = useState("");

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
    let cancelled = false;
    if (isOpen) loadSettings(() => cancelled);
    return () => { cancelled = true; };
  }, [isOpen]);




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

  async function loadSettings(isCancelled: () => boolean) {
    const provider = localStorage.getItem(STORAGE_KEYS.AI_PROVIDER) || "openai";

    // Load ALL API keys
    const openaiKey = await getApiKey("openai") || "";
    const anthropicKey = await getApiKey("anthropic") || "";
    const zaiKey = await getApiKey("zai") || "";

    if (isCancelled()) return;

    const savedModel = localStorage.getItem(STORAGE_KEYS.AI_MODEL) || "";
    const model = provider === "openai" && OPENAI_LARGE_FILE_UNSUITABLE_DEFAULTS.has(savedModel)
      ? getDefaultModelForProvider(provider)
      : savedModel || getDefaultModelForProvider(provider);
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
      provider: provider as ProviderKey,
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
        if (cacheData.models?.length > 0 && !isCancelled()) {
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
      // Also check Keeper for the API key
      const refreshWithKeeper = async () => {
        const keeperUid = provider !== "llamacpp"
          ? await getKeeperSecretForProvider(provider)
          : null;
        if (provider === "llamacpp" || apiKey || keeperUid) {
          const models = await listModelsAPI(provider, apiKey || "", keeperUid);
          if (isCancelled()) return;
          const newCacheData = { models, timestamp: Date.now() };
          localStorage.setItem(providerModelsCacheKey(provider), JSON.stringify(newCacheData));
          setCachedModels(prev => ({ ...prev, [provider]: models as ModelOption[] }));
          logger.info('Auto-refreshed model list', { provider, count: models.length });
        }
      };
      refreshWithKeeper().catch((err) => {
        logger.warn('Background model refresh failed', { provider, error: String(err) });
      });
    }
  }

  const handleProviderChange = (newProvider: string) => {
    const defaultModel = getDefaultModelForProvider(newProvider);

    const savedModel = localStorage.getItem(providerModelKey(newProvider));

    setSettings(prev => ({
      ...prev,
      provider: newProvider as ProviderKey,
      model: savedModel || defaultModel,
      auxiliaryModel: "",
    }));
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

    setSettings(prev => ({ ...prev, activeProviders: newActiveProviders }));
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

      // Save ALL API keys to encrypted storage (delete if cleared)
      for (const [provider, key] of Object.entries(settings.apiKeys) as [string, string][]) {
        if (key) {
          await storeApiKey(provider, key);
        } else {
          await deleteApiKey(provider);
        }
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
      setSettings(prev => ({
        ...prev,
        apiKeys: { ...prev.apiKeys, [provider]: "" }
      }));
      await deleteApiKey(provider);
      setSaveMessage(`${provider.toUpperCase()} API key cleared`);
      safeTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const handleRefreshModels = async () => {
    const provider = settings.provider;
    setIsRefreshingModels(true);
    setConnectionTestResult(null);
    setModelsMessage(null);

    try {
      const apiKey = provider === "llamacpp"
        ? ""
        : settings.apiKeys[provider as ApiKeyProvider];
      const keeperUid = provider !== "llamacpp"
        ? await getKeeperSecretForProvider(provider)
        : null;

      if (provider !== "llamacpp" && !apiKey && !keeperUid) {
        setConnectionTestResult("Please enter an API key first");
        setIsRefreshingModels(false);
        return;
      }

      const models = await listModelsAPI(provider, apiKey || "", keeperUid);

      const cacheData = {
        models: models,
        timestamp: Date.now()
      };
      localStorage.setItem(providerModelsCacheKey(provider), JSON.stringify(cacheData));

      setCachedModels(prev => ({
        ...prev,
        [provider]: models as ModelOption[]
      }));

      setModelsMessage(
        provider === "openai"
          ? `Loaded ${models.length} Hadron-suitable models`
          : `Loaded ${models.length} models`
      );
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
        : settings.apiKeys[settings.provider as ApiKeyProvider];
      const keeperUid = settings.provider !== "llamacpp"
        ? await getKeeperSecretForProvider(settings.provider)
        : null;

      if (settings.provider !== "llamacpp" && !apiKey && !keeperUid) {
        setConnectionTestResult("Please enter an API key first");
        setIsTestingConnection(false);
        return;
      }

      const result = await testConnectionAPI(settings.provider, apiKey || "", keeperUid);
      setConnectionTestResult(result.message);

      if (result.success && (result.models_count || 0) > 0) {
        await handleRefreshModels();
      }
    } catch (error) {
      setConnectionTestResult(`Connection failed: ${error}`);
    } finally {
      setIsTestingConnection(false);
      safeTimeout(() => setConnectionTestResult(null), 5000);
    }
  };

  // Use cached models if available, otherwise fall back to curated list
  const rawModels = cachedModels[settings.provider]?.length
    ? cachedModels[settings.provider]
    : getCuratedModelsForProvider(settings.provider);

  // Ensure the currently saved model always appears in the dropdown
  const savedModelInList = rawModels.some((m) => m.id === settings.model);
  const savedModelLabel = settings.provider === "openai"
    ? `${settings.model} (Saved; may not handle large files)`
    : settings.model;
  const currentModels = savedModelInList || settings.model === "custom"
    ? rawModels
    : [{ id: settings.model, label: savedModelLabel, context: undefined, category: "saved" }, ...rawModels];

  const filterLower = modelFilter.toLowerCase();
  const filteredModels = filterLower
    ? currentModels.filter((m) => {
        if (m.id.toLowerCase().includes(filterLower)) return true;
        if ((m.label ?? "").toLowerCase().includes(filterLower)) return true;
        // "128k", "200k" etc — match on context size
        if (m.context) {
          const ctxLabel = `${Math.round(m.context / 1000)}k`;
          const ctxMillionLabel = m.context >= 1000000 ? `${Math.round(m.context / 1000000)}m` : "";
          if (ctxLabel.includes(filterLower)) return true;
          if (ctxMillionLabel.includes(filterLower)) return true;
        }
        return false;
      })
    : currentModels;

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
              onChange={(e) => setSettings(prev => ({
                ...prev,
                apiKeys: { ...prev.apiKeys, [provider]: e.target.value }
              }))}
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

        {/* Body: sidebar + right pane */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <SettingsSidebar
            activeSection={activeSection}
            onSelect={handleSelectSection}
            integrationsOpen={integrationsOpen}
            onToggleIntegrations={handleToggleIntegrations}
          />

          {/* Right pane */}
          <div ref={contentScrollRef} className="flex-1 overflow-y-auto">
          {/* Maintenance: always mounted to preserve EmbeddedConsoleViewer log stream */}
          <MaintenanceSection
            className={activeSection === 'maintenance' ? 'block' : 'hidden'}
            isOnline={isOnline}
            parentScrollRef={contentScrollRef}
            onSettingsChange={onSettingsChange}
          />
          <div className={`${activeSection === 'maintenance' ? 'hidden' : 'block'} p-6 space-y-4`}>
          {activeSection === 'jira' && (
            <Suspense fallback={<div className="p-4 text-gray-400 text-sm">Loading JIRA settings…</div>}>
              <JiraSettings onSettingsChange={onSettingsChange} />
            </Suspense>
          )}
          {activeSection === 'sentry' && (
            <Suspense fallback={<div className="p-4 text-gray-400 text-sm">Loading Sentry settings…</div>}>
              <SentrySettings onSettingsChange={onSettingsChange} />
            </Suspense>
          )}
          {activeSection === 'knowledge-base' && (
            <div className="space-y-4">
              <Suspense fallback={<div className="p-4 text-gray-400 text-sm">Loading Knowledge Base settings…</div>}>
                <OpenSearchSettings onSettingsChange={onSettingsChange} />
              </Suspense>
              <CodexMgXSettings />
            </div>
          )}
          {activeSection === 'preferences' && (
            <PreferencesSection
              darkMode={darkMode}
              onThemeChange={onThemeChange}
              piiRedactionEnabled={settings.piiRedactionEnabled}
              onPiiToggle={() => setSettings(prev => ({ ...prev, piiRedactionEnabled: !prev.piiRedactionEnabled }))}
              defaultAnalysisMode={defaultAnalysisMode}
              onAnalysisModeChange={handleAnalysisModeChange}
              activeProviders={settings.activeProviders}
              onToggleProvider={handleToggleProvider}
              onSettingsChange={onSettingsChange}
            />
          )}
          {activeSection === 'ai-provider' && (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              Coming soon — AI provider section being extracted
            </div>
          )}
          {activeSection === 'dashboard' && (<>
          <SettingsDashboard
            providerLabel={AI_PROVIDERS.find(p => p.value === settings.provider)?.label || settings.provider}
            modelLabel={settings.model === 'custom' ? settings.customModel : settings.model}
            auxiliaryModel={settings.auxiliaryModel || undefined}
            darkMode={darkMode}
            piiRedactionEnabled={settings.piiRedactionEnabled}
            defaultAnalysisMode={defaultAnalysisMode}
            isOnline={isOnline}
            onNavigate={handleSelectSection}
            onThemeChange={onThemeChange}
            onPiiToggle={() => setSettings(prev => ({ ...prev, piiRedactionEnabled: !prev.piiRedactionEnabled }))}
            onAnalysisModeChange={handleAnalysisModeChange}
          />

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
                    <KeeperSettings onSettingsChange={() => {
                      onSettingsChange?.();
                      getKeeperConfig().then((config) => {
                        setKeeperConfig(config);
                        const isActive = config.enabled && !!config.secretMappings[settings.provider as keyof typeof config.secretMappings];
                        if (isActive) setShowManualKeys(false);
                        else setShowManualKeys(true);
                      }).catch((e) => logger.warn("Failed to reload Keeper config", { error: e }));
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
                        disabled={isRefreshingModels || (settings.provider !== 'llamacpp' && !isKeeperActiveForProvider && !settings.apiKeys[settings.provider as ApiKeyProvider])}
                        loading={isRefreshingModels}
                        icon={<RefreshCw />}
                      >
                        Refresh Models
                      </Button>
                    </div>
                    <input
                      type="text"
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder={`Filter ${currentModels.length} models… (e.g. "gpt-5", "400k", "1m")`}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 text-sm placeholder-gray-500"
                    />
                    <ModelPicker
                      provider={settings.provider}
                      value={settings.model === "custom" ? settings.customModel : settings.model}
                      models={filteredModels}
                      onChange={(id) => {
                        setModelFilter("");
                        setSettings((prev) => ({ ...prev, model: id, customModel: "" }));
                        localStorage.setItem(providerModelKey(settings.provider), id);
                      }}
                    />

                    {settings.model === "custom" && (
                      <input
                        type="text"
                        value={settings.customModel}
                        onChange={(e) => setSettings(prev => ({ ...prev, customModel: e.target.value }))}
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
                      onChange={(e) => setSettings(prev => ({ ...prev, auxiliaryModel: e.target.value }))}
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

                </div>
              </div>
            )}
          </>)}
          </div>
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
