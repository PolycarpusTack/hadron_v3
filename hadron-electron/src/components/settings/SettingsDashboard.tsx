import { useState, useEffect } from 'react';
import { AlertTriangle, Moon, Sun, Shield } from 'lucide-react';
import { isJiraEnabled } from '../../services/jira';
import { isSentryEnabled } from '../../services/sentry';
import { AI_PROVIDERS } from '../../constants/providers';
import type { SettingsSection } from './types';

interface Props {
  providerLabel: string;
  modelLabel: string;
  auxiliaryModel?: string;
  darkMode: boolean;
  piiRedactionEnabled: boolean;
  defaultAnalysisMode: string;
  isOnline: boolean;
  onNavigate: (s: SettingsSection) => void;
  onThemeChange: (dark: boolean) => void;
  onPiiToggle: () => void;
  onAnalysisModeChange: (mode: string) => void;
}

export default function SettingsDashboard({
  providerLabel, modelLabel, auxiliaryModel,
  darkMode, piiRedactionEnabled, defaultAnalysisMode,
  isOnline, onNavigate, onThemeChange, onPiiToggle, onAnalysisModeChange,
}: Props) {
  const [jiraConnected, setJiraConnected] = useState(false);
  const [sentryConnected, setSentryConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isJiraEnabled().then(v => { if (!cancelled) setJiraConnected(v); }).catch(() => {});
    isSentryEnabled().then(v => { if (!cancelled) setSentryConnected(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
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

      {/* 3-column card grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* AI Provider Card */}
        <div className="hd-config-grid-card">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>AI Provider</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <strong className="text-sm" style={{ color: 'var(--hd-text)' }}>{providerLabel}</strong>
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                background: 'rgba(16, 185, 129, 0.15)',
                color: 'var(--hd-accent)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}>Configured</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>Model: {modelLabel}</p>
            {auxiliaryModel && (
              <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Auxiliary: {auxiliaryModel}</p>
            )}
            <button
              className="hd-btn-ghost text-xs w-full py-1.5 mt-2"
              onClick={() => onNavigate('ai-provider')}
            >
              Change Provider
            </button>
          </div>
        </div>

        {/* Integrations Card */}
        <div className="hd-config-grid-card">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>Integrations</h3>
          <div className="space-y-1">
            <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--hd-border-subtle)' }}>
              <span className="text-sm" style={{ color: 'var(--hd-text)' }}>JIRA</span>
              <span className={`px-2 py-0.5 rounded text-xs ${jiraConnected ? 'text-green-400' : ''}`} style={
                jiraConnected
                  ? { background: 'var(--hd-bg-surface)', border: '1px solid' }
                  : { background: 'var(--hd-bg-surface)', color: 'var(--hd-text-dim)', border: '1px solid var(--hd-border-subtle)' }
              }>
                {jiraConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--hd-border-subtle)' }}>
              <span className="text-sm" style={{ color: 'var(--hd-text)' }}>Sentry</span>
              <span className={`px-2 py-0.5 rounded text-xs ${sentryConnected ? 'text-green-400' : ''}`} style={
                sentryConnected
                  ? { background: 'var(--hd-bg-surface)', border: '1px solid' }
                  : { background: 'var(--hd-bg-surface)', color: 'var(--hd-text-dim)', border: '1px solid var(--hd-border-subtle)' }
              }>
                {sentryConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm" style={{ color: 'var(--hd-text)' }}>Knowledge Base</span>
              <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--hd-bg-surface)', color: 'var(--hd-text-dim)', border: '1px solid var(--hd-border-subtle)' }}>
                Not Indexed
              </span>
            </div>
          </div>
          <button className="hd-btn-ghost text-xs w-full py-1.5 mt-3" onClick={() => onNavigate('jira')}>
            Manage Integrations
          </button>
        </div>

        {/* Preferences Card */}
        <div className="hd-config-grid-card">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--hd-text)' }}>Preferences</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--hd-text)' }}>Theme</p>
                <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Light / Dark</p>
              </div>
              <button
                onClick={() => onThemeChange(!darkMode)}
                className={`hd-toggle ${darkMode ? 'bg-blue-600' : 'bg-gray-600'}`}
              >
                <div className={`hd-toggle-knob hd-toggle-knob-icon ${darkMode ? 'translate-x-7' : 'translate-x-1'}`}>
                  {darkMode ? <Moon className="w-4 h-4 text-blue-600" /> : <Sun className="w-4 h-4 text-yellow-500" />}
                </div>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm" style={{ color: 'var(--hd-text)' }}>PII Redaction</p>
                <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Auto-strip PII</p>
              </div>
              <button
                onClick={onPiiToggle}
                className={`hd-toggle ${piiRedactionEnabled ? 'bg-blue-600' : 'bg-gray-600'}`}
              >
                <div className={`hd-toggle-knob hd-toggle-knob-icon ${piiRedactionEnabled ? 'translate-x-7' : 'translate-x-1'}`}>
                  <Shield className={`w-4 h-4 ${piiRedactionEnabled ? 'text-blue-600' : 'text-gray-400'}`} />
                </div>
              </button>
            </div>

            <div>
              <p className="text-sm mb-1.5" style={{ color: 'var(--hd-text)' }}>Default Analysis</p>
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
        </div>
      </div>
    </div>
  );
}
