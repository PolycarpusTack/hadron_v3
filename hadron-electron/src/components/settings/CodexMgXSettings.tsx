import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { getCodexMgXConfig, saveCodexMgXConfig, type CodexMgXConfig } from '../../services/codexmgx';
import Button from '../ui/Button';
import { useAutoTimeout } from '../../hooks/useAutoTimeout';

export default function CodexMgXSettings() {
  const safeTimeout = useAutoTimeout();
  const [config, setConfig] = useState<CodexMgXConfig>({ scriptPath: '', enabled: false });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCodexMgXConfig().then(cfg => {
      if (!cancelled) { setConfig(cfg); setLoaded(true); }
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await saveCodexMgXConfig(config);
      setSaveMessage('Saved!');
      safeTimeout(() => setSaveMessage(null), 2000);
    } catch (err) {
      setSaveMessage(`Failed to save: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="hd-panel-soft p-4 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>CodexMgX Integration</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-dim)' }}>
            Deep JIRA investigation, Confluence, MOD docs, and KB via MCP server
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
        </label>
      </div>

      {config.enabled && (
        <div className="space-y-3">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs" style={{ color: 'var(--hd-text-muted)' }}>
            <p className="font-medium text-blue-300 mb-1">Credentials required</p>
            <p>CodexMgX reads credentials from:</p>
            <code className="block mt-1 text-blue-200 break-all">
              %USERPROFILE%\.codex\plugins\codexmgx-plugin\codexmgx-env.ps1
            </code>
            <p className="mt-1">
              Copy <code>codexmgx-env.example.ps1</code> from the Hadron install folder to that location and fill in your credentials.
            </p>
          </div>

          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--hd-text-dim)' }}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            Advanced: override script path
          </button>

          {showAdvanced && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--hd-text-dim)' }}>
                Custom script path{' '}
                <span style={{ color: 'var(--hd-text-muted)' }}>(leave blank to use bundled scripts)</span>
              </label>
              <input
                type="text"
                value={config.scriptPath}
                onChange={e => setConfig(prev => ({ ...prev, scriptPath: e.target.value }))}
                placeholder="Leave blank to use bundled scripts"
                className="w-full text-xs rounded-md px-3 py-2 placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                style={{ background: 'var(--hd-bg)', border: '1px solid var(--hd-border)', color: 'var(--hd-text)' }}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving} loading={isSaving}>
              Save
            </Button>
            {saveMessage && (
              <span className={`text-xs ${saveMessage.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                {saveMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
