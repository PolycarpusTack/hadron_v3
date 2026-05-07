import { Moon, Sun, Shield, Code, Cpu, MessageCircle, Zap, Check, AlertTriangle, XCircle } from 'lucide-react';
import HdToggle from '../ui/HdToggle';
import { getCircuitState } from '../../services/circuit-breaker';
import { AI_PROVIDERS } from '../../constants/providers';
import { STORAGE_KEYS } from '../../utils/config';
import FeatureToggleRow from '../FeatureToggleRow';

interface Props {
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
  piiRedactionEnabled: boolean;
  onPiiToggle: () => void;
  defaultAnalysisMode: string;
  onAnalysisModeChange: (mode: string) => void;
  activeProviders: Record<string, boolean>;
  onToggleProvider: (providerValue: string) => void;
  onSettingsChange?: () => void;
}

export default function PreferencesSection({
  darkMode, onThemeChange,
  piiRedactionEnabled, onPiiToggle,
  defaultAnalysisMode, onAnalysisModeChange,
  activeProviders, onToggleProvider,
  onSettingsChange,
}: Props) {
  const enabledCount = Object.values(activeProviders).filter(Boolean).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Preferences</h2>
        <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Theme, privacy, and interface options</p>
      </div>

      {/* Appearance & Privacy */}
      <div className="hd-setting-card space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>Appearance & Privacy</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm" style={{ color: 'var(--hd-text)' }}>Theme</p>
            <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>{darkMode ? 'Dark mode' : 'Light mode'}</p>
          </div>
          <HdToggle
            checked={darkMode}
            onChange={() => onThemeChange(!darkMode)}
            icon={darkMode ? <Moon className="w-4 h-4 text-blue-600" /> : <Sun className="w-4 h-4 text-yellow-500" />}
            aria-label="Toggle theme"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm" style={{ color: 'var(--hd-text)' }}>PII Redaction</p>
            <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Auto-strip names, emails, IPs before sending to AI</p>
          </div>
          <HdToggle
            checked={piiRedactionEnabled}
            onChange={onPiiToggle}
            icon={<Shield className={`w-4 h-4 ${piiRedactionEnabled ? 'text-blue-600' : 'text-gray-400'}`} />}
            aria-label="Toggle PII redaction"
          />
        </div>

        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--hd-text)' }}>Default Analysis Mode</p>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--hd-border-subtle)' }}>
            <button
              onClick={() => onAnalysisModeChange('quick')}
              className="flex-1 px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: defaultAnalysisMode === 'quick' ? 'var(--hd-accent)' : 'transparent',
                color: defaultAnalysisMode === 'quick' ? '#052e24' : 'var(--hd-text-muted)',
              }}
            >
              Quick
            </button>
            <button
              onClick={() => onAnalysisModeChange('comprehensive')}
              className="flex-1 px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: defaultAnalysisMode === 'comprehensive' ? 'var(--hd-accent)' : 'transparent',
                color: defaultAnalysisMode === 'comprehensive' ? '#052e24' : 'var(--hd-text-muted)',
                borderLeft: '1px solid var(--hd-border-subtle)',
              }}
            >
              Comprehensive
            </button>
          </div>
        </div>
      </div>

      {/* Visible Menu Items */}
      <div className="hd-setting-card space-y-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>Visible Menu Items</h3>
          <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Toggle optional navigation tabs</p>
        </div>
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

      {/* Active Providers */}
      <div className="hd-setting-card space-y-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>Active AI Providers</h3>
          <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
            Enable/disable AI backends ({enabledCount} enabled)
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {AI_PROVIDERS.map((provider) => {
            const circuitState = getCircuitState(provider.value);
            const stateColor =
              circuitState === 'healthy' ? 'text-green-400' :
              circuitState === 'degraded' ? 'text-yellow-400' :
              'text-red-400';
            const stateIcon =
              circuitState === 'healthy' ? <Check className="w-3 h-3" /> :
              circuitState === 'degraded' ? <AlertTriangle className="w-3 h-3" /> :
              <XCircle className="w-3 h-3" />;

            return (
              <label
                key={provider.value}
                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition text-sm ${
                  activeProviders[provider.value]
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-gray-900/50 border-gray-700 opacity-60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeProviders[provider.value]}
                    onChange={() => onToggleProvider(provider.value)}
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
    </div>
  );
}
