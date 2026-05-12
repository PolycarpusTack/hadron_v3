import { useRef } from "react";
import { FileUp, Code, History, Cpu, Ticket, MessageCircle, FileText, AlertTriangle, Lock } from "lucide-react";
import type { View } from "../hooks/useAppState";
import type { SettingsSection } from "./settings/types";

interface NavigationProps {
  currentView: View;
  onViewChange: (view: View) => void;
  showJiraAnalyzer?: boolean;
  showSentryAnalyzer?: boolean;
  showReleaseNotes?: boolean;
  showCodeAnalyzer?: boolean;
  showPerformanceAnalyzer?: boolean;
  showAskHadron?: boolean;
  onOpenSettings?: (section: SettingsSection) => void;
}

interface TabConfig {
  id: View;
  label: string;
  icon: typeof FileUp;
  enabled?: boolean;
  settingsSection?: SettingsSection;
}

function NavSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[5px] mx-1.5 flex-shrink-0" aria-hidden="true">
      <div className="w-px h-[18px] bg-gray-600/30" />
      <span className="text-[8px] uppercase tracking-widest text-white/[.18]">
        {label}
      </span>
      <div className="w-px h-[18px] bg-gray-600/30" />
    </div>
  )
}

export default function Navigation({
  currentView,
  onViewChange,
  showJiraAnalyzer = false,
  showSentryAnalyzer = false,
  showReleaseNotes = false,
  showCodeAnalyzer = true,
  showPerformanceAnalyzer = true,
  showAskHadron = true,
  onOpenSettings,
}: NavigationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const coreTabs: TabConfig[] = [
    { id: "analyze", label: "Crash Analyzer", icon: FileUp },
    ...(showCodeAnalyzer !== false ? [{ id: "translate" as View, label: "Code Analyzer", icon: Code }] : []),
    ...(showPerformanceAnalyzer !== false ? [{ id: "performance" as View, label: "Performance Analyzer", icon: Cpu }] : []),
  ];

  const integrationTabs: TabConfig[] = [
    { id: "jira",          label: "JIRA Analyzer",  icon: Ticket,        enabled: showJiraAnalyzer,   settingsSection: "jira"   },
    { id: "sentry",        label: "Sentry Analyzer", icon: AlertTriangle, enabled: showSentryAnalyzer, settingsSection: "sentry" },
    { id: "release_notes", label: "Release Notes",   icon: FileText,      enabled: showReleaseNotes,   settingsSection: "jira"   },
  ];

  const historyTab: TabConfig = { id: "history", label: "History", icon: History };

  const isAskHadronActive = currentView === "chat";

  function renderTab(tab: TabConfig) {
    const Icon = tab.icon;
    const isEnabled = tab.enabled !== false;
    const isActive = tab.id === currentView || (tab.id === "history" && currentView === "detail");

    if (!isEnabled) {
      return (
        <button
          key={tab.id}
          onClick={() => tab.settingsSection && onOpenSettings?.(tab.settingsSection)}
          role="tab"
          aria-selected={false}
          aria-disabled="true"
          aria-label={`${tab.label} — click to configure`}
          title={`${tab.label} — click to configure`}
          className="hd-nav-btn opacity-40 hover:opacity-60 transition-opacity cursor-pointer"
        >
          <Lock className="w-[15px] h-[15px]" />
          <span>{tab.label}</span>
        </button>
      );
    }

    return (
      <button
        key={tab.id}
        onClick={() => onViewChange(tab.id)}
        role="tab"
        aria-selected={isActive}
        aria-controls={`${tab.id}-panel`}
        className={`hd-nav-btn ${isActive ? "hd-nav-btn-active" : ""}`}
      >
        <Icon className="w-[15px] h-[15px]" />
        <span>{tab.label}</span>
      </button>
    );
  }

  return (
    <nav
      ref={scrollRef}
      className="hd-nav-bar mb-3.5"
      role="tablist"
      aria-label="Main navigation"
      style={{ borderColor: 'var(--hd-border-subtle)' }}
    >
      {coreTabs.map(renderTab)}

      <NavSeparator label="Integrations" />

      {integrationTabs.map(renderTab)}

      <NavSeparator label="History" />

      {renderTab(historyTab)}

      {/* Spacer pushes Ask Hadron to right */}
      <div className="flex-1" />

      {showAskHadron !== false && (
        <button
          onClick={() => onViewChange("chat")}
          role="tab"
          aria-selected={isAskHadronActive}
          className={`hd-ask-nav-btn ${isAskHadronActive ? "hd-ask-nav-btn-active" : ""}`}
        >
          <MessageCircle className="w-[15px] h-[15px]" />
          <span>Ask Hadron</span>
        </button>
      )}
    </nav>
  );
}
