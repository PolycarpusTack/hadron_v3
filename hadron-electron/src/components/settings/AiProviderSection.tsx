import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Eye, EyeOff, AlertTriangle, XCircle, RefreshCw, Check, AlertCircle, Info, Shield, ChevronDown } from 'lucide-react';
import { getApiKey, deleteApiKey } from '../../services/secure-storage';
import { listModels as listModelsAPI, testConnection as testConnectionAPI } from '../../services/api';
import { getKeeperConfig, getKeeperSecretForProvider, type KeeperConfig } from '../../services/keeper';
import { AI_PROVIDERS, getDefaultModelForProvider, getCuratedModelsForProvider, MODEL_CACHE_TTL_MS, type ModelOption } from '../../constants/providers';
import type { ProviderKey } from '../../constants/providers';
import type { SettingsData } from './types';
import { STORAGE_KEYS, providerModelKey, providerModelsCacheKey } from '../../utils/config';
import Button from '../ui/Button';
import ModelPicker from '../ui/ModelPicker';
import { useAutoTimeout } from '../../hooks/useAutoTimeout';

const KeeperSettings = lazy(() => import('../KeeperSettings'));

const OPENAI_LARGE_FILE_UNSUITABLE_DEFAULTS = new Set([
  'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini',
]);

interface Props {
  settings: SettingsData;
  isOpen: boolean;
  onUpdateSettings: (partial: Partial<SettingsData>) => void;
  onSettingsChange?: () => void;
}

function getKeyStatus(provider: string, key: string) {
  if (!key || key.trim() === '') {
    return { icon: <AlertCircle className="w-4 h-4" />, color: 'text-gray-500', label: 'No key' };
  }
  const validFormats: Record<string, RegExp> = { openai: /^sk-/, anthropic: /^sk-ant-/ };
  const format = validFormats[provider];
  const isValid = !format || format.test(key);
  if (isValid) return { icon: <Check className="w-4 h-4" />, color: 'text-green-500', label: 'Configured' };
  return { icon: <AlertTriangle className="w-4 h-4" />, color: 'text-yellow-500', label: 'Invalid format' };
}

export default function AiProviderSection({ settings, isOpen, onUpdateSettings, onSettingsChange }: Props) {
  const safeTimeout = useAutoTimeout();

  const [cachedModels, setCachedModels] = useState<Record<string, ModelOption[]>>({});
  const [modelFilter, setModelFilter] = useState('');
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);
  const [showApiKeys, setShowApiKeys] = useState({ openai: false, anthropic: false, zai: false });
  const [showManualKeys, setShowManualKeys] = useState(true);
  const [keeperConfig, setKeeperConfig] = useState<KeeperConfig | null>(null);
  const [clearMessage, setClearMessage] = useState<string | null>(null);

  // Load Keeper config and auto-collapse manual keys when Keeper is active
  useEffect(() => {
    if (!isOpen) return;
    getKeeperConfig().then(config => {
      setKeeperConfig(config);
      const isActive = config.enabled && !!config.secretMappings[settings.provider as keyof typeof config.secretMappings];
      if (isActive) setShowManualKeys(false);
    }).catch(() => {});
  }, [isOpen, settings.provider]);

  // Load cached models from localStorage on open
  useEffect(() => {
    if (!isOpen) return;
    const provider = settings.provider;
    const cacheKey = providerModelsCacheKey(provider);
    const cached = localStorage.getItem(cacheKey);
    let cacheIsStale = true;

    if (cached) {
      try {
        const cacheData = JSON.parse(cached);
        const age = Date.now() - cacheData.timestamp;
        if (cacheData.models?.length > 0) {
          setCachedModels(prev => ({ ...prev, [provider]: cacheData.models }));
        }
        cacheIsStale = age >= MODEL_CACHE_TTL_MS;
      } catch {}
    }

    if (cacheIsStale) {
      const apiKey = provider === 'llamacpp' ? '' : settings.apiKeys[provider as ApiKeyProvider];
      const bgRefresh = async () => {
        const keeperUid = provider !== 'llamacpp' ? await getKeeperSecretForProvider(provider) : null;
        if (provider === 'llamacpp' || apiKey || keeperUid) {
          const models = await listModelsAPI(provider, apiKey || '', keeperUid);
          const newCache = { models, timestamp: Date.now() };
          localStorage.setItem(providerModelsCacheKey(provider), JSON.stringify(newCache));
          setCachedModels(prev => ({ ...prev, [provider]: models as ModelOption[] }));
        }
      };
      bgRefresh().catch(() => {});
    }
  }, [isOpen, settings.provider, settings.apiKeys]);

  const isKeeperActiveForProvider = keeperConfig?.enabled &&
    !!keeperConfig.secretMappings[settings.provider as keyof typeof keeperConfig.secretMappings];

  const rawModels = cachedModels[settings.provider]?.length
    ? cachedModels[settings.provider]
    : getCuratedModelsForProvider(settings.provider);

  const savedModelInList = rawModels.some(m => m.id === settings.model);
  const currentModels = savedModelInList || settings.model === 'custom'
    ? rawModels
    : [...rawModels, { id: settings.model, label: `${settings.model} (Saved)`, contextWindow: 0, bestFor: [] }];

  const filterLower = modelFilter.toLowerCase();
  const filteredModels = filterLower
    ? currentModels.filter(m =>
        m.label.toLowerCase().includes(filterLower) ||
        m.id.toLowerCase().includes(filterLower) ||
        String(m.contextWindow).includes(filterLower)
      )
    : currentModels;

  const handleProviderChange = useCallback((newProvider: string) => {
    const defaultModel = getDefaultModelForProvider(newProvider);
    const savedModel = localStorage.getItem(providerModelKey(newProvider));
    onUpdateSettings({
      provider: newProvider as ProviderKey,
      model: savedModel || defaultModel,
      auxiliaryModel: '',
    });
  }, [onUpdateSettings]);

  const handleRefreshModels = useCallback(async () => {
    const provider = settings.provider;
    setIsRefreshingModels(true);
    setConnectionTestResult(null);
    setModelsMessage(null);
    try {
      const apiKey = provider === 'llamacpp' ? '' : settings.apiKeys[provider as ApiKeyProvider];
      const keeperUid = provider !== 'llamacpp' ? await getKeeperSecretForProvider(provider) : null;
      if (provider !== 'llamacpp' && !apiKey && !keeperUid) {
        setConnectionTestResult('Please enter an API key first');
        return;
      }
      const models = await listModelsAPI(provider, apiKey || '', keeperUid);
      const cacheData = { models, timestamp: Date.now() };
      localStorage.setItem(providerModelsCacheKey(provider), JSON.stringify(cacheData));
      setCachedModels(prev => ({ ...prev, [provider]: models as ModelOption[] }));
      setModelsMessage(
        provider === 'openai' ? `Loaded ${models.length} Hadron-suitable models` : `Loaded ${models.length} models`
      );
    } catch (error) {
      setConnectionTestResult(`Failed to fetch models: ${error}`);
    } finally {
      setIsRefreshingModels(false);
      safeTimeout(() => { setConnectionTestResult(null); setModelsMessage(null); }, 5000);
    }
  }, [settings.provider, settings.apiKeys, safeTimeout]);

  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const apiKey = settings.provider === 'llamacpp' ? '' : settings.apiKeys[settings.provider as ApiKeyProvider];
      const keeperUid = settings.provider !== 'llamacpp' ? await getKeeperSecretForProvider(settings.provider) : null;
      if (settings.provider !== 'llamacpp' && !apiKey && !keeperUid) {
        setConnectionTestResult('Please enter an API key first');
        return;
      }
      const result = await testConnectionAPI(settings.provider, apiKey || '', keeperUid);
      setConnectionTestResult(result.message);
      if (result.success && (result.models_count || 0) > 0) await handleRefreshModels();
    } catch (error) {
      setConnectionTestResult(`Connection failed: ${error}`);
    } finally {
      setIsTestingConnection(false);
      safeTimeout(() => setConnectionTestResult(null), 5000);
    }
  }, [settings.provider, settings.apiKeys, handleRefreshModels, safeTimeout]);

  const handleClearApiKey = async (provider: string) => {
    if (!confirm(`Are you sure you want to clear your ${provider.toUpperCase()} API key?`)) return;
    onUpdateSettings({ apiKeys: { ...settings.apiKeys, [provider]: '' } });
    await deleteApiKey(provider);
    setClearMessage(`${provider.toUpperCase()} API key cleared`);
    safeTimeout(() => setClearMessage(null), 2000);
  };

  const renderApiKeyInput = (provider: ApiKeyProvider, label: string, placeholder: string) => {
    const status = getKeyStatus(provider, settings.apiKeys[provider]);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>{label}</label>
          <div className={`flex items-center gap-1.5 text-xs ${status.color}`}>
            {status.icon}<span>{status.label}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showApiKeys[provider] ? 'text' : 'password'}
              value={settings.apiKeys[provider]}
              onChange={e => onUpdateSettings({ apiKeys: { ...settings.apiKeys, [provider]: e.target.value } })}
              placeholder={placeholder}
              className="w-full hd-input rounded-lg px-4 py-2.5 pr-10 text-sm"
            />
            <button
              onClick={() => setShowApiKeys(prev => ({ ...prev, [provider]: !prev[provider] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
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
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>AI Provider</h2>
        <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Configure your AI backend, API keys, and model selection</p>
      </div>

      <div className="hd-setting-card space-y-4">
        {/* Provider Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>Provider</label>
          <select
            value={settings.provider}
            onChange={e => handleProviderChange(e.target.value)}
            className="w-full hd-input rounded-lg px-4 py-2.5 text-sm"
          >
            {AI_PROVIDERS.filter(p => settings.activeProviders[p.value]).map(provider => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>

          {settings.provider === 'llamacpp' && (
            <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-blue-300">llama.cpp (Local)</p>
                  <p className="text-xs text-gray-400 mt-1">
                    No API key required. Start <code className="bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded text-blue-600 dark:text-blue-400">llama-server</code> on{' '}
                    <code className="bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded text-blue-600 dark:text-blue-400">localhost:8080</code>
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
              <span className="text-gray-400 text-sm">Loading Keeper settings…</span>
            </div>
          </div>
        }>
          <KeeperSettings onSettingsChange={() => {
            onSettingsChange?.();
            getKeeperConfig().then(config => {
              setKeeperConfig(config);
              const isActive = config.enabled && !!config.secretMappings[settings.provider as keyof typeof config.secretMappings];
              setShowManualKeys(!isActive);
            }).catch(() => {});
          }} />
        </Suspense>

        {/* Manual API Key */}
        {settings.provider !== 'llamacpp' && (
          <div className="space-y-3">
            <button
              onClick={() => setShowManualKeys(v => !v)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showManualKeys ? '' : '-rotate-90'}`} style={{ color: 'var(--hd-text-muted)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>Manual API Key</span>
              {isKeeperActiveForProvider && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/30 rounded-full px-2.5 py-0.5">
                  <Shield className="w-3 h-3" />Using Keeper
                </span>
              )}
            </button>
            {showManualKeys && (
              <div className="space-y-4 pl-6">
                {settings.provider === 'openai' && renderApiKeyInput('openai', 'OpenAI API Key', 'sk-...')}
                {settings.provider === 'anthropic' && renderApiKeyInput('anthropic', 'Anthropic API Key', 'sk-ant-...')}
                {settings.provider === 'zai' && renderApiKeyInput('zai', 'Z.ai API Key', 'Enter your Z.ai key')}
                <p className="text-xs text-gray-500">Keys are encrypted using your OS keychain/credential manager</p>
              </div>
            )}
          </div>
        )}
        {clearMessage && <p className="text-xs text-green-400">{clearMessage}</p>}

        {/* Test Connection */}
        <div className="flex items-center gap-3">
          <Button
            variant="secondary" size="sm"
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            loading={isTestingConnection}
          >
            {isTestingConnection ? 'Testing…' : 'Test Connection'}
          </Button>
          {connectionTestResult && (
            <span className={`text-xs ${connectionTestResult.includes('failed') || connectionTestResult.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
              {connectionTestResult}
            </span>
          )}
        </div>

        {/* Model Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>Model</label>
            <Button
              variant="secondary" size="sm"
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
            onChange={e => setModelFilter(e.target.value)}
            placeholder={`Filter ${currentModels.length} models… (e.g. "gpt-5", "400k", "1m")`}
            className="w-full hd-input rounded-lg px-4 py-2 text-sm"
          />
          <ModelPicker
            provider={settings.provider}
            value={settings.model === 'custom' ? settings.customModel : settings.model}
            models={filteredModels}
            onChange={id => {
              setModelFilter('');
              onUpdateSettings({ model: id, customModel: '' });
              localStorage.setItem(providerModelKey(settings.provider), id);
            }}
          />
          {settings.model === 'custom' && (
            <input
              type="text"
              value={settings.customModel}
              onChange={e => onUpdateSettings({ customModel: e.target.value })}
              placeholder="Enter custom model name"
              className="w-full hd-input rounded-lg px-4 py-2.5 text-sm"
            />
          )}
          {modelsMessage && <p className="text-xs text-green-400">{modelsMessage}</p>}
        </div>

        {/* Lightweight / Auxiliary Model */}
        <div className="space-y-2">
          <label className="text-sm font-medium" style={{ color: 'var(--hd-text-muted)' }}>Lightweight Model (Optional)</label>
          <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
            Use a cheaper model for internal calls (query planning, search expansion, tool decisions).
          </p>
          <select
            value={settings.auxiliaryModel}
            onChange={e => onUpdateSettings({ auxiliaryModel: e.target.value })}
            className="w-full hd-input rounded-lg px-4 py-2.5 text-sm"
          >
            <option value="">Same as main model (no savings)</option>
            {settings.provider === 'openai' && (
              <>
                <option value="gpt-4o-mini">GPT-4o Mini (recommended)</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
              </>
            )}
            {settings.provider === 'anthropic' && (
              <option value="claude-haiku-4-5-20251001">Claude 4.5 Haiku (recommended)</option>
            )}
            {settings.provider === 'zai' && (
              <option value="glm-4-flash">GLM-4 Flash (recommended)</option>
            )}
            {settings.provider === 'llamacpp' && (
              <option value="default">Default (local - no cost)</option>
            )}
          </select>
        </div>
      </div>
    </div>
  );
}
