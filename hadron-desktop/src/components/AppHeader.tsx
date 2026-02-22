import { Settings, MessageCircle } from "lucide-react";
import { APP_VERSION } from "../constants/version";

interface AppHeaderProps {
  providerName?: string;
  jiraConnected?: boolean;
  sentryConnected?: boolean;
  onOpenSettings?: () => void;
  onOpenAskHadronDrawer?: () => void;
  isSettingsActive?: boolean;
}

export default function AppHeader({ providerName, jiraConnected, sentryConnected, onOpenSettings, onOpenAskHadronDrawer, isSettingsActive }: AppHeaderProps) {
  const hasConnection = !!providerName;

  // Build connection text
  const connectionParts: string[] = [];
  if (providerName) connectionParts.push(providerName);
  if (jiraConnected) connectionParts.push("JIRA");
  if (sentryConnected) connectionParts.push("Sentry");
  const connectionText = connectionParts.length > 0
    ? `Connected: ${connectionParts.join(" + ")}`
    : "No provider configured";

  return (
    <header className="hd-panel mb-4 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Elena mascot logo */}
          <img
            src="/elena-button.png"
            alt="Hadron"
            className="h-10 w-10 rounded-[10px] object-cover"
            style={{ boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--hd-text)', letterSpacing: '-0.02em' }}>
              Hadron
            </h1>
            <p className="text-xs" style={{ color: 'var(--hd-text-muted)', marginTop: '1px' }}>
              AI Support Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Status pill */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs"
            style={{
              border: '1px solid var(--hd-border)',
              background: 'rgba(255,255,255,0.02)',
              color: 'var(--hd-text-muted)',
            }}
          >
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background: hasConnection ? 'var(--hd-accent)' : '#ef4444',
                boxShadow: hasConnection ? '0 0 6px var(--hd-accent)' : 'none',
              }}
            />
            <span>{connectionText}</span>
          </div>

          {/* Version badge */}
          <span
            className="rounded-md px-2 py-0.5 text-[0.7rem] font-mono"
            style={{
              border: '1px solid var(--hd-border-subtle)',
              color: 'var(--hd-text-dim)',
            }}
          >
            v{APP_VERSION}
          </span>

          {/* Ask Hadron icon — opens drawer */}
          {onOpenAskHadronDrawer && (
            <button
              onClick={onOpenAskHadronDrawer}
              className="hd-header-icon-btn"
              title="Ask Hadron (Quick Chat)"
              aria-label="Open Ask Hadron drawer"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
          )}

          {/* Settings icon — opens configure view */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className={`hd-header-icon-btn ${isSettingsActive ? 'hd-header-icon-btn-active' : ''}`}
              title="Settings"
              aria-label="Open settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
