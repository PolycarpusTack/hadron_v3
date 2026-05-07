import { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Download, Clipboard, Check, FolderOpen, RefreshCw } from 'lucide-react';
import { checkForUpdates } from '../../services/updater';
import { autoTagAnalyses } from '../../services/api';
import { invoke } from '../../lib/tauri-core-shim';
import { open as tauriOpen } from '../../lib/tauri-dialog-shim';
import { STORAGE_KEYS } from '../../utils/config';
import Button from '../ui/Button';
import { useAutoTimeout } from '../../hooks/useAutoTimeout';

const DatabaseAdminSection = lazy(() => import('../DatabaseAdminSection'));
const EmbeddedConsoleViewer = lazy(() => import('../EmbeddedConsoleViewer'));

interface Props {
  className?: string;
  isOnline: boolean;
  parentScrollRef?: React.RefObject<HTMLDivElement>;
  onSettingsChange?: () => void;
}

export default function MaintenanceSection({ className, isOnline, parentScrollRef, onSettingsChange }: Props) {
  const safeTimeout = useAutoTimeout();

  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [isAutoTagging, setIsAutoTagging] = useState(false);
  const [autoTagMessage, setAutoTagMessage] = useState<string | null>(null);
  const [crashLogDir, setCrashLogDir] = useState('');
  const [crashLogMsg, setCrashLogMsg] = useState<string | null>(null);
  const [stabilityMode, setStabilityMode] = useState(false);
  const [stabilityMsg, setStabilityMsg] = useState<string | null>(null);
  const [defaultExportDir, setDefaultExportDir] = useState(
    () => localStorage.getItem(STORAGE_KEYS.DEFAULT_EXPORT_DIR) || ''
  );

  useEffect(() => {
    let cancelled = false;
    invoke<string>('get_crash_log_dir').then(d => { if (!cancelled) setCrashLogDir(d); }).catch(() => {});
    invoke<boolean>('get_stability_mode').then(v => { if (!cancelled) setStabilityMode(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateMessage(null);
    try {
      const info = await checkForUpdates();
      setUpdateMessage(info.available
        ? `Update available: ${info.latestVersion} (current: ${info.currentVersion})`
        : `You're up to date (v${info.currentVersion})`
      );
    } catch (err) {
      setUpdateMessage(`Update check failed: ${err}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleExportDiagnostics = async () => {
    try {
      const diagnostics = await invoke<string>('export_diagnostics');
      await navigator.clipboard.writeText(diagnostics);
      setDiagnosticsMessage('Diagnostics copied to clipboard!');
      safeTimeout(() => setDiagnosticsMessage(null), 3000);
    } catch (err) {
      setDiagnosticsMessage(`Failed to export: ${err}`);
      safeTimeout(() => setDiagnosticsMessage(null), 5000);
    }
  };

  const handleAutoTagHistory = async () => {
    setIsAutoTagging(true);
    setAutoTagMessage(null);
    try {
      const result = await autoTagAnalyses(null);
      setAutoTagMessage(
        `Auto-tagging complete: ${result.tagged} tagged, ${result.skipped} skipped, ${result.failed} failed.`
      );
    } catch (e) {
      setAutoTagMessage(`Auto-tagging failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsAutoTagging(false);
    }
  };

  return (
    <div className={className}>
      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--hd-text)' }}>Maintenance</h2>
          <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>System tools and data exports</p>
        </div>

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
            {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
          </Button>
          {updateMessage && (
            <p className={`text-xs px-2 ${
              updateMessage.includes('up to date') ? 'text-green-400' :
              updateMessage.includes('available') ? 'text-blue-400' : 'text-red-400'
            }`}>
              {updateMessage}
            </p>
          )}

          {/* Export Diagnostics */}
          <Button variant="secondary" size="sm" fullWidth onClick={handleExportDiagnostics} icon={<Clipboard />}>
            Export Diagnostics
          </Button>
          {diagnosticsMessage && (
            <p className={`text-xs px-2 ${diagnosticsMessage.includes('copied') ? 'text-green-400' : 'text-red-400'}`}>
              {diagnosticsMessage}
            </p>
          )}

          {/* Auto-tag History */}
          <Button
            variant="secondary" size="sm" fullWidth
            onClick={handleAutoTagHistory}
            disabled={isAutoTagging}
            loading={isAutoTagging}
            icon={<Check />}
          >
            {isAutoTagging ? 'Tagging...' : 'Auto-tag History'}
          </Button>
          {autoTagMessage && (
            <p className={`text-xs px-2 ${autoTagMessage.includes('complete') ? 'text-green-400' : 'text-red-400'}`}>
              {autoTagMessage}
            </p>
          )}

          {/* Crash Log Directory */}
          <div className="hd-setting-card space-y-2 mt-1">
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Crash Log Directory</p>
              <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>Where crash reports are saved</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text" value={crashLogDir} readOnly
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono"
                style={{ color: 'var(--hd-text-muted)' }}
                title={crashLogDir}
              />
              <button
                className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                title="Choose folder"
                onClick={async () => {
                  try {
                    const selected = await tauriOpen({ directory: true, title: 'Select Crash Log Directory' });
                    if (selected) {
                      const result = await invoke<string>('set_crash_log_dir', { dir: selected });
                      setCrashLogDir(result);
                      setCrashLogMsg('Crash log directory updated');
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
                    const result = await invoke<string>('set_crash_log_dir', { dir: '' });
                    setCrashLogDir(result);
                    setCrashLogMsg('Reset to default');
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
              <p className={`text-xs ${crashLogMsg.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                {crashLogMsg}
              </p>
            )}
          </div>

          {/* Stability Mode */}
          <div className="hd-setting-card space-y-2 mt-1">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Stability Mode</p>
                <p className="text-xs" style={{ color: 'var(--hd-text-dim)' }}>
                  Reduces IPC pressure across the WebView2 boundary. Turn on if Hadron crashes during concurrent
                  analyses or background JIRA polling. Trade-off: slower deep-scans, no background JIRA refresh.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={stabilityMode}
                  onChange={async e => {
                    const next = e.target.checked;
                    try {
                      const result = await invoke<boolean>('set_stability_mode', { enabled: next });
                      setStabilityMode(result);
                      setStabilityMsg(result ? 'Stability mode enabled' : 'Stability mode disabled');
                      safeTimeout(() => setStabilityMsg(null), 4000);
                    } catch (err) {
                      setStabilityMsg(`Failed: ${err instanceof Error ? err.message : String(err)}`);
                      safeTimeout(() => setStabilityMsg(null), 5000);
                    }
                  }}
                />
                <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600" />
              </label>
            </div>
            {stabilityMsg && (
              <p className={`text-xs ${stabilityMsg.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                {stabilityMsg}
              </p>
            )}
          </div>

          {/* Default Export Location */}
          <div className="hd-setting-card space-y-2 mt-1">
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--hd-text)' }}>Default Export Location</p>
              <p className="text-xs truncate max-w-xs" style={{ color: 'var(--hd-text-dim)' }}>
                {defaultExportDir || 'Not set — exports download to browser default'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text" value={defaultExportDir} readOnly
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono"
                style={{ color: 'var(--hd-text-muted)' }}
                placeholder="Not set"
                title={defaultExportDir || 'Not set'}
              />
              <button
                className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                title="Choose folder"
                onClick={async () => {
                  const selected = await tauriOpen({ directory: true, title: 'Select Default Export Directory' });
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
                    setDefaultExportDir('');
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
              <RefreshCw className="w-3 h-3 animate-spin" />Loading database…
            </div>
          }>
            <div className="hd-setting-card mt-1">
              <DatabaseAdminSection onRefresh={onSettingsChange} />
            </div>
          </Suspense>

          {/* Console — always mounted, CSS-hidden when section inactive (preserves live log stream) */}
          <Suspense fallback={null}>
            <div className="hd-setting-card overflow-hidden mt-1">
              <EmbeddedConsoleViewer defaultAutoScroll={false} parentScrollRef={parentScrollRef} />
            </div>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
