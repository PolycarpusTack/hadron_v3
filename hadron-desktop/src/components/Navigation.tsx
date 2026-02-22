import { useRef } from "react";
import { FileUp, Code, History, Cpu, Ticket, MessageCircle, FileText, AlertTriangle } from "lucide-react";
import type { View } from "../hooks/useAppState";

interface NavigationProps {
  currentView: View;
  onViewChange: (view: View) => void;
  showJiraAnalyzer?: boolean;
  showSentryAnalyzer?: boolean;
  showReleaseNotes?: boolean;
  showCodeAnalyzer?: boolean;
  showPerformanceAnalyzer?: boolean;
  showAskHadron?: boolean;
}

interface TabConfig {
  id: View;
  label: string;
  icon: typeof FileUp;
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
}: NavigationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build tabs list (excluding Ask Hadron - it's a separate button)
  const tabs: TabConfig[] = [
    { id: "analyze", label: "Crash Analyzer", icon: FileUp },
    ...(showCodeAnalyzer !== false ? [{ id: "translate" as View, label: "Code Analyzer", icon: Code }] : []),
    ...(showPerformanceAnalyzer !== false ? [{ id: "performance" as View, label: "Performance Analyzer", icon: Cpu }] : []),
    ...(showJiraAnalyzer ? [{ id: "jira" as View, label: "JIRA Analyzer", icon: Ticket }] : []),
    ...(showSentryAnalyzer ? [{ id: "sentry" as View, label: "Sentry Analyzer", icon: AlertTriangle }] : []),
    ...(showReleaseNotes ? [{ id: "release_notes" as View, label: "Release Notes", icon: FileText }] : []),
    { id: "history", label: "History", icon: History },
  ];

  const isAskHadronActive = currentView === "chat";

  return (
    <nav
      ref={scrollRef}
      className="hd-nav-bar mb-3.5"
      role="tablist"
      aria-label="Main navigation"
      style={{ background: 'rgba(12, 18, 34, 0.7)', borderColor: 'var(--hd-border-subtle)' }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === currentView || (tab.id === "history" && currentView === "detail");
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
      })}

      {/* Spacer pushes Ask Hadron to right */}
      <div className="flex-1" />

      {/* Ask Hadron accent button — opens full view */}
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
