import { FileUp, Code, History, Cpu, Ticket, Shield, MessageCircle, FileText } from "lucide-react";

export type ViewType = "analyze" | "translate" | "history" | "detail" | "performance" | "jira" | "sentry" | "chat" | "release_notes";

interface NavigationProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  showJiraAnalyzer?: boolean;
  showSentryAnalyzer?: boolean;
  showReleaseNotes?: boolean;
}

interface TabConfig {
  id: ViewType;
  label: string;
  icon: typeof FileUp;
  iconColor: string;
  iconBg: string;
  activeIconBg: string;
  isActive: boolean;
}

export default function Navigation({ currentView, onViewChange, showJiraAnalyzer = false, showSentryAnalyzer = false, showReleaseNotes = false }: NavigationProps) {
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
    {
      id: "translate",
      label: "Code Analyzer",
      icon: Code,
      iconColor: "text-violet-400",
      iconBg: "bg-violet-500/10",
      activeIconBg: "bg-violet-500/20",
      isActive: currentView === "translate",
    },
    ...(showJiraAnalyzer
      ? [
          {
            id: "jira" as ViewType,
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
            id: "sentry" as ViewType,
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
            id: "release_notes" as ViewType,
            label: "Release Notes",
            icon: FileText,
            iconColor: "text-amber-400",
            iconBg: "bg-amber-500/10",
            activeIconBg: "bg-amber-500/20",
            isActive: currentView === "release_notes",
          },
        ]
      : []),
    {
      id: "performance",
      label: "Performance Analyzer",
      icon: Cpu,
      iconColor: "text-cyan-400",
      iconBg: "bg-cyan-500/10",
      activeIconBg: "bg-cyan-500/20",
      isActive: currentView === "performance",
    },
    {
      id: "chat" as ViewType,
      label: "Ask Hadron",
      icon: MessageCircle,
      iconColor: "text-emerald-400",
      iconBg: "bg-emerald-500/10",
      activeIconBg: "bg-emerald-500/20",
      isActive: currentView === "chat",
    },
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
    <nav
      className="mb-6 flex items-center gap-1 border-b border-gray-200 dark:border-gray-700"
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
            className={`flex items-center gap-2.5 px-4 py-3 border-b-2 transition-all ${
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
  );
}
