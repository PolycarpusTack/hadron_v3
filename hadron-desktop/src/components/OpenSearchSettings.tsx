/**
 * OpenSearch / Knowledge Base Settings Component
 * Allows users to configure the WHATS'ON KB integration
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen,
  Check,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  FolderOpen,
  Download,
} from "lucide-react";
import {
  getOpenSearchConfig,
  saveOpenSearchConfig,
  storeOpenSearchPassword,
  getOpenSearchPassword,
  testOpenSearchConnection,
  importKBDocs,
  getKBStats,
} from "../services/opensearch";
import type { OpenSearchConfig, KBStatsResponse } from "../services/opensearch";
import logger from "../services/logger";

interface OpenSearchSettingsProps {
  onConfigChange?: () => void;
}

export default function OpenSearchSettings({ onConfigChange }: OpenSearchSettingsProps) {
  const [config, setConfig] = useState<OpenSearchConfig>({
    enabled: false,
    mode: "remote",
    host: "",
    port: 443,
    useSsl: true,
    username: "",
    defaultVersion: "",
    defaultCustomer: "",
    localKbPath: "",
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [indices, setIndices] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [kbStats, setKbStats] = useState<KBStatsResponse | null>(null);
  const [importVersion, setImportVersion] = useState("");

  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const safeTimeout = useCallback((callback: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      callback();
    }, delay);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  // Load config on mount
  useEffect(() => {
    (async () => {
      try {
        const loaded = await getOpenSearchConfig();
        setConfig(loaded);
        const pw = await getOpenSearchPassword();
        setHasPassword(!!pw);
        // Load local KB stats
        const stats = await getKBStats();
        setKbStats(stats);
      } catch (error) {
        logger.error("Failed to load OpenSearch config", { error });
      }
    })();

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  async function handleSave() {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      await saveOpenSearchConfig(config);
      if (password) {
        await storeOpenSearchPassword(password);
        setHasPassword(true);
        setPassword("");
      }
      setSaveMessage("Settings saved");
      safeTimeout(() => setSaveMessage(null), 3000);
      onConfigChange?.();
    } catch (error) {
      setSaveMessage("Failed to save settings");
      logger.error("Failed to save OpenSearch config", { error });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestConnection() {
    setIsTesting(true);
    setTestResult(null);

    try {
      // Temporarily save password for the test
      if (password) {
        await storeOpenSearchPassword(password);
        setHasPassword(true);
      }
      // Save current config so the test uses it
      await saveOpenSearchConfig(config);

      const result = await testOpenSearchConnection();
      setTestResult({ success: result.success, message: result.message });

      if (result.success && result.available_indices.length > 0) {
        setIndices(result.available_indices);
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleImport() {
    if (!config.localKbPath || !importVersion) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await importKBDocs(config.localKbPath, importVersion);
      setImportResult(`Imported ${result.indexed_chunks} chunks for version ${result.won_version}`);
      // Refresh stats
      const stats = await getKBStats();
      setKbStats(stats);
    } catch (error) {
      setImportResult(`Import failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIsImporting(false);
    }
  }

  // Extract version options from indices (kb-doc-2024r8 -> 2024r8)
  const versionOptions = indices
    .filter((i) => i.startsWith("kb-doc-"))
    .map((i) => i.replace("kb-doc-", ""));

  return (
    <div className="p-4 bg-teal-500/10 rounded-lg border border-teal-500/30 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-teal-400" />
          <div>
            <h3 className="text-sm font-semibold">WHATS'ON Knowledge Base</h3>
            <p className="text-xs text-gray-400">
              Connect to KB docs and release notes for domain-enriched analysis
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            const next = { ...config, enabled: !config.enabled };
            setConfig(next);
          }}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            config.enabled ? "bg-teal-600" : "bg-gray-600"
          }`}
        >
          <div
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              config.enabled ? "translate-x-6" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {config.enabled && (
        <>
          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Mode</label>
            <div className="flex gap-2">
              {(["remote", "local", "both"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setConfig({ ...config, mode: m })}
                  className={`px-3 py-1.5 text-xs rounded-md border transition ${
                    config.mode === m
                      ? "bg-teal-600/30 border-teal-500 text-teal-300"
                      : "bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Remote Settings */}
          {(config.mode === "remote" || config.mode === "both") && (
            <div className="space-y-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <h4 className="text-xs font-semibold text-teal-400 uppercase">Remote (OpenSearch)</h4>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Host</label>
                  <input
                    type="text"
                    value={config.host}
                    onChange={(e) => setConfig({ ...config, host: e.target.value })}
                    placeholder="opensearch.example.com"
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Port</label>
                  <input
                    type="number"
                    value={config.port}
                    onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 443 })}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={config.username}
                    onChange={(e) => setConfig({ ...config, username: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Password {hasPassword && !password && <span className="text-teal-400">(saved)</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={hasPassword ? "••••••••" : "Enter password"}
                      className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-teal-500"
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={config.useSsl}
                    onChange={(e) => setConfig({ ...config, useSsl: e.target.checked })}
                    className="w-4 h-4 rounded accent-teal-500"
                  />
                  Use SSL
                </label>

                <button
                  onClick={handleTestConnection}
                  disabled={isTesting || !config.host}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-teal-600/30 border border-teal-500/50 rounded hover:bg-teal-600/50 disabled:opacity-50 transition"
                >
                  {isTesting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Test Connection
                </button>
              </div>

              {testResult && (
                <div
                  className={`flex items-center gap-2 text-xs p-2 rounded ${
                    testResult.success
                      ? "bg-green-500/10 text-green-400 border border-green-500/30"
                      : "bg-red-500/10 text-red-400 border border-red-500/30"
                  }`}
                >
                  {testResult.success ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                  )}
                  {testResult.message}
                </div>
              )}

              {/* Available Indices */}
              {indices.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Available KB Indices ({indices.length})
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {versionOptions.map((v) => (
                      <span
                        key={v}
                        onClick={() => setConfig({ ...config, defaultVersion: v })}
                        className={`px-2 py-0.5 text-xs rounded cursor-pointer transition ${
                          config.defaultVersion === v
                            ? "bg-teal-600/40 text-teal-300 border border-teal-500"
                            : "bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-500"
                        }`}
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Local Settings */}
          {(config.mode === "local" || config.mode === "both") && (
            <div className="space-y-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
              <h4 className="text-xs font-semibold text-teal-400 uppercase">Local (ChromaDB)</h4>

              <div>
                <label className="block text-xs text-gray-400 mb-1">KB Root Path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.localKbPath}
                    onChange={(e) => setConfig({ ...config, localKbPath: e.target.value })}
                    placeholder="/path/to/kb-html-docs"
                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
                  />
                  <button className="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs hover:bg-gray-600 transition">
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={importVersion}
                  onChange={(e) => setImportVersion(e.target.value)}
                  placeholder="Version (e.g. 2024r8)"
                  className="w-40 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
                />
                <button
                  onClick={handleImport}
                  disabled={isImporting || !config.localKbPath || !importVersion}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-teal-600/30 border border-teal-500/50 rounded hover:bg-teal-600/50 disabled:opacity-50 transition"
                >
                  {isImporting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Import
                </button>
              </div>

              {importResult && (
                <p className="text-xs text-gray-400">{importResult}</p>
              )}

              {/* Local KB Stats */}
              {kbStats && kbStats.total_chunks > 0 && (
                <div className="text-xs text-gray-400 space-y-1">
                  <p>Indexed: {kbStats.total_chunks} chunks</p>
                  {kbStats.indexed_versions.length > 0 && (
                    <p>Versions: {kbStats.indexed_versions.join(", ")}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Shared Settings */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Default WON Version</label>
              <input
                type="text"
                value={config.defaultVersion}
                onChange={(e) => setConfig({ ...config, defaultVersion: e.target.value })}
                placeholder="e.g. 2024r8"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Default Customer</label>
              <input
                type="text"
                value={config.defaultCustomer}
                onChange={(e) => setConfig({ ...config, defaultCustomer: e.target.value })}
                placeholder="e.g. bbc"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-600 rounded hover:bg-teal-500 disabled:opacity-50 transition font-medium"
            >
              {isSaving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save
            </button>
            {saveMessage && (
              <span className="text-xs text-teal-400">{saveMessage}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
