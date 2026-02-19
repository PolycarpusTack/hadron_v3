/**
 * KeeperSettings Component
 *
 * Provides UI for configuring Keeper Secrets Manager integration.
 * Allows users to connect to Keeper and map secrets to AI providers
 * without ever seeing the actual API key values.
 */

import { useState, useEffect } from "react";
import {
  Shield,
  Key,
  Link,
  Unlink,
  RefreshCw,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  ExternalLink,
  Info,
  X,
} from "lucide-react";
import Button from "./ui/Button";
import {
  getKeeperStatus,
  initializeKeeper,
  listKeeperSecrets,
  disconnectKeeper,
  getKeeperConfig,
  saveKeeperConfig,
  type KeeperStatus,
  type KeeperSecretInfo,
  type KeeperConfig,
} from "../services/keeper";
import logger from "../services/logger";

interface KeeperSettingsProps {
  onConfigChange?: () => void;
}

export default function KeeperSettings({ onConfigChange }: KeeperSettingsProps) {
  // State
  const [status, setStatus] = useState<KeeperStatus | null>(null);
  const [secrets, setSecrets] = useState<KeeperSecretInfo[]>([]);
  const [config, setConfig] = useState<KeeperConfig>({
    enabled: false,
    secretMappings: {},
  });
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [region, setRegion] = useState("auto");
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Load initial state
  // NOTE: React 18 StrictMode double-mounts components in dev, which causes
  // two concurrent Keeper SDK calls that race on the config file. The
  // `cancelled` flag ensures stale mounts don't update state or show errors.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const [keeperStatus, keeperConfig] = await Promise.all([
          getKeeperStatus(),
          getKeeperConfig(),
        ]);

        if (cancelled) return;

        setStatus(keeperStatus);
        setConfig(keeperConfig);

        if (keeperStatus.connected) {
          try {
            const secretsResult = await listKeeperSecrets();
            if (!cancelled) {
              setSecrets(secretsResult.secrets);
            }
          } catch (error) {
            // Non-fatal: status/config loaded OK, just secrets list failed
            logger.warn("Failed to list Keeper secrets", { error });
          }
        }
      } catch (error) {
        if (cancelled) return;
        logger.error("Failed to load Keeper state", { error });
        setMessage({
          type: "error",
          text: "Failed to load Keeper configuration",
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Map region codes to Keeper server hostnames
  const regionHostnames: Record<string, string> = {
    US: "keepersecurity.com",
    EU: "keepersecurity.eu",
    AU: "keepersecurity.com.au",
    GOV: "govcloud.keepersecurity.us",
    JP: "keepersecurity.jp",
    CA: "keepersecurity.ca",
  };

  async function handleConnect() {
    if (!token.trim()) {
      setMessage({ type: "error", text: "Please enter a one-time access token" });
      return;
    }

    setIsConnecting(true);
    setMessage(null);

    try {
      // Determine hostname: if region is "auto", the token should contain
      // a region prefix (e.g., "US:TOKEN"). Otherwise, pass the hostname.
      const hostname = region !== "auto" ? regionHostnames[region] : undefined;
      const result = await initializeKeeper(token.trim(), hostname);

      if (result.success) {
        setToken(""); // Clear token after successful connection
        setMessage({ type: "success", text: result.message });

        // Reload state
        const [keeperStatus, secretsResult] = await Promise.all([
          getKeeperStatus(),
          listKeeperSecrets(),
        ]);

        setStatus(keeperStatus);
        setSecrets(secretsResult.secrets);

        // Enable Keeper by default after connecting
        const newConfig = { ...config, enabled: true };
        setConfig(newConfig);
        await saveKeeperConfig(newConfig);

        onConfigChange?.();
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch (error: unknown) {
      logger.error("Failed to connect to Keeper", { error });
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error) || "Failed to connect to Keeper",
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Are you sure you want to disconnect from Keeper? You will need a new one-time token to reconnect."
      )
    ) {
      return;
    }

    try {
      await disconnectKeeper();
      setStatus({
        configured: false,
        connected: false,
        secrets_count: 0,
        message: "",
      });
      setSecrets([]);
      setConfig({ enabled: false, secretMappings: {} });
      setMessage({ type: "success", text: "Disconnected from Keeper" });
      onConfigChange?.();
    } catch (error: unknown) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error) || "Failed to disconnect",
      });
    }
  }

  async function handleToggleEnabled() {
    const newConfig = { ...config, enabled: !config.enabled };
    try {
      await saveKeeperConfig(newConfig);
      setConfig(newConfig);
      onConfigChange?.();
    } catch (error: unknown) {
      logger.error("Failed to toggle Keeper", { error });
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error) || "Failed to save configuration",
      });
    }
  }

  async function handleMapSecret(
    provider: "openai" | "anthropic" | "zai",
    secretUid: string
  ) {
    const newConfig = {
      ...config,
      secretMappings: {
        ...config.secretMappings,
        [provider]: secretUid || undefined,
      },
    };

    // Remove empty mappings
    if (!secretUid) {
      delete newConfig.secretMappings[provider];
    }

    try {
      await saveKeeperConfig(newConfig);
      setConfig(newConfig);
      onConfigChange?.();
    } catch (error: unknown) {
      logger.error("Failed to map secret", { error, provider });
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error) || "Failed to save secret mapping",
      });
    }
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />
          <span className="text-gray-400">Loading Keeper configuration...</span>
        </div>
      </div>
    );
  }

  const isConnected = status?.connected ?? false;
  const isConfigured = status?.configured ?? false;

  return (
    <div className="space-y-4 p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/30">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-purple-400" />
          <div>
            <h3 className="font-semibold text-purple-300">
              Keeper Secrets Manager
            </h3>
            <p className="text-xs text-gray-400">
              Securely retrieve API keys from your organization's vault
            </p>
          </div>
        </div>

        {(isConnected || isConfigured) && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={handleToggleEnabled}
                className="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-purple-500"
              />
              Enable
            </label>
          </div>
        )}
      </div>

      {/* Connection Status */}
      <div
        className={`p-3 rounded-lg ${
          isConnected
            ? "bg-green-500/10 border border-green-500/20"
            : isConfigured
            ? "bg-yellow-500/10 border border-yellow-500/20"
            : "bg-gray-900/50 border border-gray-700"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-400" : isConfigured ? "bg-yellow-400" : "bg-gray-500"
              }`}
            />
            <span
              className={`text-sm ${
                isConnected ? "text-green-400" : isConfigured ? "text-yellow-400" : "text-gray-400"
              }`}
            >
              {isConnected
                ? `Connected (${status?.secrets_count ?? 0} secrets available)`
                : isConfigured
                ? `Connection error: ${status?.message || "Could not reach Keeper"}`
                : "Not connected"}
            </span>
          </div>

          {(isConnected || isConfigured) && (
            <Button variant="ghost-danger" size="xs" onClick={handleDisconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Configured but temporarily unreachable — show retry, NOT the connect form */}
      {isConfigured && !isConnected && (
        <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-yellow-300">
              Keeper is configured but the connection check failed. This may be a
              temporary network issue.
            </p>
            <button
              onClick={() => {
                setIsLoading(true);
                setMessage(null);
                // Retry — inline the load logic
                (async () => {
                  try {
                    const [keeperStatus] = await Promise.all([
                      getKeeperStatus(),
                      getKeeperConfig().then(c => setConfig(c)),
                    ]);
                    setStatus(keeperStatus);
                    if (keeperStatus.connected) {
                      try {
                        const secretsResult = await listKeeperSecrets();
                        setSecrets(secretsResult.secrets);
                      } catch { /* non-fatal */ }
                    }
                  } catch (error) {
                    setMessage({ type: "error", text: "Retry failed — check your network connection" });
                  } finally {
                    setIsLoading(false);
                  }
                })();
              }}
              className="mt-2 text-xs px-3 py-1.5 bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 rounded-lg transition inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Connect Form (only when NOT configured — no existing config to lose) */}
      {!isConfigured && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">
              Server Region
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={isConnecting}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 mb-3"
            >
              <option value="auto">Auto-detect from token</option>
              <option value="US">US (keepersecurity.com)</option>
              <option value="EU">EU (keepersecurity.eu)</option>
              <option value="AU">AU (keepersecurity.com.au)</option>
              <option value="GOV">US GOV (govcloud.keepersecurity.us)</option>
              <option value="JP">JP (keepersecurity.jp)</option>
              <option value="CA">CA (keepersecurity.ca)</option>
            </select>

            <label className="block text-xs font-semibold text-gray-400 mb-2">
              One-Time Access Token
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  placeholder={region === "auto" ? "Paste token with region prefix (e.g. US:xxxx)" : "Paste your Keeper one-time token"}
                  disabled={isConnecting}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-700 rounded"
                >
                  {showToken ? (
                    <EyeOff className="w-4 h-4 text-gray-400" />
                  ) : (
                    <Eye className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
              <Button
                variant="accent"
                size="lg"
                onClick={handleConnect}
                disabled={!token.trim()}
                loading={isConnecting}
                icon={<Key />}
              >
                {isConnecting ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </div>

          {/* Help Text */}
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-400">
              <p className="mb-1">
                Get a one-time token from your Keeper administrator, or generate
                one yourself:
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-1">
                <li>Open the Keeper Web Vault</li>
                <li>Go to Settings &rarr; Secrets Manager &rarr; Applications</li>
                <li>Select your application or create a new one</li>
                <li>Click "Add Device" to generate a new token</li>
              </ol>
              <p className="mt-2 mb-1">
                Tokens may include a region prefix (e.g., <code className="text-purple-300">US:xxxx</code>).
                If yours doesn't, select your region above.
              </p>
              <a
                href="https://docs.keeper.io/en/keeperpam/secrets-manager/about/one-time-token"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-purple-400 hover:underline mt-2"
              >
                Learn more about Keeper Secrets Manager
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Secret Mappings (when connected/configured and enabled) */}
      {(isConnected || isConfigured) && config.enabled && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-gray-400">
            Map Secrets to AI Providers
          </label>

          {(["openai", "anthropic", "zai"] as const).map((provider) => {
            const currentMapping = config.secretMappings[provider];
            const isMapped = !!currentMapping;

            return (
              <div key={provider} className="flex items-center gap-3">
                <span className="w-24 text-sm text-gray-300 capitalize">
                  {provider === "zai" ? "Z.ai" : provider}
                </span>
                <select
                  value={currentMapping || ""}
                  onChange={(e) =>
                    handleMapSecret(provider, e.target.value)
                  }
                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="">-- Select a secret --</option>
                  {secrets.map((secret) => (
                    <option key={secret.uid} value={secret.uid}>
                      {secret.title}
                    </option>
                  ))}
                </select>
                <div className="w-6 flex justify-center" title={isMapped ? "Linked" : "Not linked"}>
                  {isMapped ? (
                    <Link className="w-4 h-4 text-green-400" aria-label="Linked" />
                  ) : (
                    <Unlink className="w-4 h-4 text-gray-500" aria-label="Not linked" />
                  )}
                </div>
              </div>
            );
          })}

          {/* Security Note */}
          <div className="flex items-start gap-2 p-3 bg-gray-900/50 rounded-lg border border-gray-700 mt-4">
            <Shield className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              API keys are retrieved securely from Keeper at runtime. Keys are
              never stored locally or displayed in this application.
            </p>
          </div>
        </div>
      )}

      {/* Connected/configured but disabled message */}
      {(isConnected || isConfigured) && !config.enabled && (
        <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-yellow-400">
              Keeper is connected but disabled. Enable it above to use secrets
              from your vault.
            </span>
          </div>
        </div>
      )}

      {/* Status Message */}
      {message && (
        <div
          className={`p-3 rounded-lg flex items-center justify-between ${
            message.type === "success"
              ? "bg-green-500/10 border border-green-500/20 text-green-400"
              : message.type === "error"
              ? "bg-red-500/10 border border-red-500/20 text-red-400"
              : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === "success" && <Check className="w-4 h-4" />}
            {message.type === "error" && <AlertTriangle className="w-4 h-4" />}
            {message.type === "info" && <Info className="w-4 h-4" />}
            <span className="text-sm">{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="p-1 hover:bg-white/10 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
