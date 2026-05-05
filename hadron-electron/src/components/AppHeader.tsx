import { useRef, useState } from "react";
import { Settings, MessageCircle, BarChart3 } from "lucide-react";
import { APP_VERSION } from "../constants/version";
import type { ReadinessStatus, DimensionStatus } from "../hooks/useReadinessStatus";
import StatusPopover from "./ui/StatusPopover";

interface AppHeaderProps {
  readinessStatus: ReadinessStatus;
  onOpenSettings?: (section?: string) => void;
  onOpenAskHadronDrawer?: () => void;
  onOpenDashboard?: () => void;
  isSettingsActive?: boolean;
}

const STATE_COLORS: Record<string, string> = {
  ok: "var(--hd-accent)",
  warning: "#f59e0b",
  "not-configured": "#ef4444",
  disabled: "var(--hd-text-dim)",
};

const OVERALL_LABEL: Record<string, string> = {
  ready: "Ready",
  warning: "Needs attention",
  "not-configured": "Needs setup",
};

export default function AppHeader({
  readinessStatus,
  onOpenSettings,
  onOpenAskHadronDrawer,
  onOpenDashboard,
  isSettingsActive,
}: AppHeaderProps) {
  const [openPopover, setOpenPopover] = useState<keyof ReadinessStatus | null>(null);
  const dotRefs = useRef<Partial<Record<keyof ReadinessStatus, HTMLButtonElement>>>({});

  const dimensions: [keyof ReadinessStatus, DimensionStatus][] = [
    ["ai", readinessStatus.ai],
    ["keeper", readinessStatus.keeper],
    ["mcp", readinessStatus.mcp],
    ["jira", readinessStatus.jira],
    ["sentry", readinessStatus.sentry],
  ];

  return (
    <header className="hd-panel mb-0 px-4 pt-3 pb-2">
      {/* Top row: logo + buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-3">
          <img
            src="/elena-button.png"
            alt="Hadron"
            className="h-10 w-10 rounded-[10px] object-cover"
            style={{ boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)" }}
          />
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--hd-text)", letterSpacing: "-0.02em" }}>
              Hadron
            </h1>
            <p className="text-xs" style={{ color: "var(--hd-text-muted)", marginTop: "1px" }}>
              AI Support Assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="rounded-md px-2 py-0.5 text-[0.7rem] font-mono" style={{ border: "1px solid var(--hd-border-subtle)", color: "var(--hd-text-dim)" }}>
            v{APP_VERSION}
          </span>
          {onOpenAskHadronDrawer && (
            <button onClick={onOpenAskHadronDrawer} className="hd-header-icon-btn" title="Ask Hadron" aria-label="Open Ask Hadron drawer">
              <MessageCircle className="w-4 h-4" />
            </button>
          )}
          {onOpenDashboard && (
            <button onClick={onOpenDashboard} className="hd-header-icon-btn" title="Intelligence Dashboard" aria-label="Open Intelligence Dashboard">
              <BarChart3 className="w-4 h-4" />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={() => onOpenSettings()}
              className={`hd-header-icon-btn ${isSettingsActive ? "hd-header-icon-btn-active" : ""}`}
              title="Settings"
              aria-label="Open settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-0 flex-wrap" style={{ borderTop: "1px solid var(--hd-border-subtle)", paddingTop: "6px" }}>
        {dimensions.map(([key, dim], idx) => {
          const dotRef = (el: HTMLButtonElement | null) => {
            if (el) dotRefs.current[key] = el;
          };
          const isOpen = openPopover === key;

          return (
            <span key={key} className="relative flex items-center">
              {idx > 0 && <span className="mx-2 text-xs" style={{ color: "var(--hd-border)" }}>|</span>}
              <button
                ref={dotRef}
                onClick={() => setOpenPopover(isOpen ? null : key)}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                title={dim.label}
                aria-label={`${key} status: ${dim.state}`}
              >
                <span
                  className="rounded-full flex-shrink-0"
                  style={{
                    width: 7,
                    height: 7,
                    background: STATE_COLORS[dim.state] ?? STATE_COLORS.disabled,
                    boxShadow: dim.state === "ok" ? `0 0 5px ${STATE_COLORS.ok}` : undefined,
                  }}
                />
                <span className="text-[10px]" style={{ color: "var(--hd-text-dim)" }}>
                  {dim.label}
                </span>
              </button>
              {isOpen && (
                <StatusPopover
                  dimension={dim}
                  onOpenSettings={(section) => onOpenSettings?.(section)}
                  onClose={() => setOpenPopover(null)}
                  anchorRef={{ current: dotRefs.current[key] ?? null }}
                />
              )}
            </span>
          );
        })}

        <span className="ml-auto">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px]"
            style={{
              background: readinessStatus.overall === "ready" ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${readinessStatus.overall === "ready" ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
              color: readinessStatus.overall === "ready" ? "var(--hd-accent)" : "#f59e0b",
            }}
          >
            {OVERALL_LABEL[readinessStatus.overall]}
          </span>
        </span>
      </div>
    </header>
  );
}
