/**
 * JIRA Sync Status Component
 * Phase 3: Displays sync status and provides manual sync trigger
 */

import { useState, useEffect } from "react";
import { RefreshCw, Check, AlertCircle, Settings } from "lucide-react";
import {
  getSyncStatus,
  getSyncConfig,
  setSyncConfig,
  syncAllLinkedTickets,
  onSyncComplete,
  onTicketsUpdated,
  type SyncStatus,
  type SyncResult,
  type TicketUpdate,
  type SyncConfig,
} from "../services/jira-sync";
import logger from "../services/logger";

interface JiraSyncStatusProps {
  /** Compact mode for inline display */
  compact?: boolean;
  /** Show settings controls */
  showSettings?: boolean;
  /** Callback when tickets are updated */
  onTicketsUpdated?: (updates: TicketUpdate[]) => void;
}

export default function JiraSyncStatus({
  compact = false,
  showSettings = false,
  onTicketsUpdated: onUpdatesCallback,
}: JiraSyncStatusProps) {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [config, setConfig] = useState<SyncConfig>(getSyncConfig());

  // Subscribe to sync events
  useEffect(() => {
    const unsubscribes: Array<() => void> = [];

    onSyncComplete((result) => {
      setLastResult(result);
      setSyncing(false);
      setStatus(getSyncStatus());
    }).then(unsub => unsubscribes.push(unsub));

    onTicketsUpdated((updates) => {
      onUpdatesCallback?.(updates);
    }).then(unsub => unsubscribes.push(unsub));

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [onUpdatesCallback]);

  // Refresh status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getSyncStatus());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAllLinkedTickets();
      setLastResult(result);
    } catch (e) {
      logger.error("Manual sync failed", { error: e });
    } finally {
      setSyncing(false);
      setStatus(getSyncStatus());
    }
  };

  const handleConfigChange = (updates: Partial<SyncConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    setSyncConfig(updates);
  };

  const formatLastSync = (timestamp: string | null): string => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const formatInterval = (ms: number): string => {
    const mins = ms / 60000;
    if (mins < 60) return `${mins} min`;
    return `${mins / 60} hour${mins / 60 > 1 ? "s" : ""}`;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleManualSync}
          disabled={syncing}
          className="p-1.5 hover:bg-gray-700 rounded transition disabled:opacity-50"
          title={syncing ? "Syncing..." : "Sync JIRA tickets"}
        >
          <RefreshCw
            className={`w-4 h-4 ${syncing ? "animate-spin text-blue-400" : "text-gray-400"}`}
          />
        </button>
        {lastResult && !lastResult.success && (
          <span title="Last sync had errors">
            <AlertCircle className="w-4 h-4 text-red-400" />
          </span>
        )}
        <span className="text-xs text-gray-500">
          {formatLastSync(status.lastSyncTime)}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RefreshCw className={`w-5 h-5 ${status.enabled ? "text-blue-400" : "text-gray-500"}`} />
          <h3 className="font-medium">JIRA Sync</h3>
          {status.enabled && (
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
              Auto
            </span>
          )}
        </div>
        {showSettings && (
          <button
            onClick={() => setShowSettingsPanel(!showSettingsPanel)}
            className="p-1.5 hover:bg-gray-700 rounded transition"
          >
            <Settings className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {/* Status */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Last sync:</span>
          <span className="text-gray-300">{formatLastSync(status.lastSyncTime)}</span>
        </div>

        {status.enabled && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Interval:</span>
            <span className="text-gray-300">{formatInterval(status.intervalMs)}</span>
          </div>
        )}

        {lastResult && (
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Last result:</span>
            <div className="flex items-center gap-1.5">
              {lastResult.success ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-green-400">
                    {lastResult.ticketsUpdated > 0
                      ? `${lastResult.ticketsUpdated} updated`
                      : "Up to date"}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-red-400">Failed</span>
                </>
              )}
            </div>
          </div>
        )}

        {lastResult && lastResult.errors.length > 0 && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            {lastResult.errors.slice(0, 3).map((err, i) => (
              <div key={i}>{err}</div>
            ))}
            {lastResult.errors.length > 3 && (
              <div>...and {lastResult.errors.length - 3} more</div>
            )}
          </div>
        )}
      </div>

      {/* Sync Button */}
      <button
        onClick={handleManualSync}
        disabled={syncing}
        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing..." : "Sync Now"}
      </button>

      {/* Settings Panel */}
      {showSettings && showSettingsPanel && (
        <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-400">Auto-sync</label>
            <button
              onClick={() => handleConfigChange({ enabled: !config.enabled })}
              className={`relative w-10 h-5 rounded-full transition ${
                config.enabled ? "bg-blue-600" : "bg-gray-600"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition ${
                  config.enabled ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Sync interval</label>
            <select
              value={config.intervalMs}
              onChange={(e) => handleConfigChange({ intervalMs: Number(e.target.value) })}
              disabled={!config.enabled}
              className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm disabled:opacity-50"
            >
              <option value={60000}>1 minute</option>
              <option value={300000}>5 minutes</option>
              <option value={900000}>15 minutes</option>
              <option value={1800000}>30 minutes</option>
              <option value={3600000}>1 hour</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
