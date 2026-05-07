import { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import { useAutoTimeout } from '../hooks/useAutoTimeout';
import { X, Settings, Save } from "lucide-react";
import { getApiKey, storeApiKey, deleteApiKey } from "../services/secure-storage";
import logger from '../services/logger';
import { AI_PROVIDERS, getDefaultModelForProvider } from '../constants/providers';
import type { ProviderKey } from '../constants/providers';
import type { SettingsSection, ApiKeyProvider, SettingsData } from './settings/types';
import { isIntegrationSection } from './settings/types';
import { STORAGE_KEYS, providerModelKey } from '../utils/config';
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import SettingsSidebar from './settings/SettingsSidebar';
import SettingsDashboard from './settings/SettingsDashboard';
import CodexMgXSettings from './settings/CodexMgXSettings';
import MaintenanceSection from './settings/MaintenanceSection';
import PreferencesSection from './settings/PreferencesSection';
import AiProviderSection from './settings/AiProviderSection';

// Lazy load heavy integration components
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

  const [defaultAnalysisMode, setDefaultAnalysisMode] = useState(
    () => localStorage.getItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE) || "quick"
  );
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const contentScrollRef = useRef<HTMLDivElement>(null);

  const safeTimeout = useAutoTimeout();

  const [settings, setSettings] = useState<SettingsData>({
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

  async function loadSettings(isCancelled: () => boolean) {
    const provider = localStorage.getItem(STORAGE_KEYS.AI_PROVIDER) || "openai";

    // Load ALL API keys
    const openaiKey = await getApiKey("openai") || "";
    const anthropicKey = await getApiKey("anthropic") || "";
    const zaiKey = await getApiKey("zai") || "";

    if (isCancelled()) return;

    const savedModel = localStorage.getItem(STORAGE_KEYS.AI_MODEL) || "";
    const model = savedModel || getDefaultModelForProvider(provider);
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
  }

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
        localStorage.removeItem(STORAGE_KEYS.AI_AUXILIARY_MODEL);
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

  const handleAnalysisModeChange = (mode: string) => {
    setDefaultAnalysisMode(mode);
    localStorage.setItem(STORAGE_KEYS.ANALYSIS_DEFAULT_TYPE, mode);
  };

  const handlePiiToggle = useCallback(
    () => setSettings(prev => ({ ...prev, piiRedactionEnabled: !prev.piiRedactionEnabled })),
    []
  );

  const handleUpdateSettings = useCallback(
    (partial: Partial<Settings>) => setSettings(prev => ({ ...prev, ...partial })),
    []
  );

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
              onPiiToggle={handlePiiToggle}
              defaultAnalysisMode={defaultAnalysisMode}
              onAnalysisModeChange={handleAnalysisModeChange}
              activeProviders={settings.activeProviders}
              onToggleProvider={handleToggleProvider}
              onSettingsChange={onSettingsChange}
            />
          )}
          {activeSection === 'ai-provider' && (
            <AiProviderSection
              settings={settings}
              isOpen={isOpen}
              onUpdateSettings={handleUpdateSettings}
              onSettingsChange={onSettingsChange}
            />
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
            onPiiToggle={handlePiiToggle}
            onAnalysisModeChange={handleAnalysisModeChange}
          />

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
