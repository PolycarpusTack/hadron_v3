import { useRef, useState, useEffect, useCallback } from "react";
import { FileUp, Code, History, Cpu, Ticket, Shield, MessageCircle, FileText } from "lucide-react";
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
  iconColor: string;
  iconBg: string;
  activeIconBg: string;
  isActive: boolean;
}

export default function Navigation({ currentView, onViewChange, showJiraAnalyzer = false, showSentryAnalyzer = false, showReleaseNotes = false, showCodeAnalyzer = true, showPerformanceAnalyzer = true, showAskHadron = true }: NavigationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 0);
    setShowRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFades();
    el.addEventListener("scroll", updateFades, { passive: true });
    const ro = new ResizeObserver(updateFades);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateFades);
      ro.disconnect();
    };
  }, [updateFades]);

  const tabs: TabConfig[] = [
    {
      id: "analyze",
      label: "Crash Analyzer",
      icon: FileUp,
      iconColor: "text-blue-400",
      iconBg: "bg-blue-500/10",
      activeIconBg: "bg-blue-500/20",
      isActive: currentView === "analyze",
    },
    ...(showCodeAnalyzer !== false
      ? [
          {
            id: "translate" as View,
            label: "Code Analyzer",
            icon: Code,
            iconColor: "text-violet-400",
            iconBg: "bg-violet-500/10",
            activeIconBg: "bg-violet-500/20",
            isActive: currentView === "translate",
          },
        ]
      : []),
    ...(showJiraAnalyzer
      ? [
          {
            id: "jira" as View,
            label: "JIRA Analyzer",
            icon: Ticket,
            iconColor: "text-sky-400",
            iconBg: "bg-sky-500/10",
            activeIconBg: "bg-sky-500/20",
            isActive: currentView === "jira",
          },
        ]
      : []),
    ...(showSentryAnalyzer
      ? [
          {
            id: "sentry" as View,
            label: "Sentry Analyzer",
            icon: Shield,
            iconColor: "text-orange-400",
            iconBg: "bg-orange-500/10",
            activeIconBg: "bg-orange-500/20",
            isActive: currentView === "sentry",
          },
        ]
      : []),
    ...(showReleaseNotes
      ? [
          {
            id: "release_notes" as View,
            label: "Release Notes",
            icon: FileText,
            iconColor: "text-amber-400",
            iconBg: "bg-amber-500/10",
            activeIconBg: "bg-amber-500/20",
            isActive: currentView === "release_notes",
          },
        ]
      : []),
    ...(showPerformanceAnalyzer !== false
      ? [
          {
            id: "performance" as View,
            label: "Performance Analyzer",
            icon: Cpu,
            iconColor: "text-cyan-400",
            iconBg: "bg-cyan-500/10",
            activeIconBg: "bg-cyan-500/20",
            isActive: currentView === "performance",
          },
        ]
      : []),
    ...(showAskHadron !== false
      ? [
          {
            id: "chat" as View,
            label: "Ask Hadron",
            icon: MessageCircle,
            iconColor: "text-emerald-400",
            iconBg: "bg-emerald-500/10",
            activeIconBg: "bg-emerald-500/20",
            isActive: currentView === "chat",
          },
        ]
      : []),
    {
      id: "history",
      label: "History",
      icon: History,
      iconColor: "text-amber-400",
      iconBg: "bg-amber-500/10",
      activeIconBg: "bg-amber-500/20",
      isActive: currentView === "history" || currentView === "detail",
    },
  ];

  return (
    <div className="relative mb-6">
      {/* Left fade */}
      {showLeftFade && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-gray-50 dark:from-gray-900 to-transparent z-10 pointer-events-none" />
      )}

      <nav
        ref={scrollRef}
        className="flex items-center gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 scrollbar-hide"
        role="tablist"
        aria-label="Main navigation"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              role="tab"
              aria-selected={tab.isActive}
              aria-controls={`${tab.id}-panel`}
              className={`flex items-center gap-2.5 px-4 py-2.5 border-b-2 transition-all whitespace-nowrap ${
                tab.isActive
                  ? "border-gray-800 dark:border-white text-gray-900 dark:text-white"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              }`}
            >
              <span className={`p-1.5 rounded-md transition-colors ${tab.isActive ? tab.activeIconBg : tab.iconBg}`}>
                <Icon className={`w-4 h-4 ${tab.iconColor}`} />
              </span>
              <span className="font-medium text-sm">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right fade */}
      {showRightFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-gray-50 dark:from-gray-900 to-transparent z-10 pointer-events-none" />
      )}
    </div>
  );
}
