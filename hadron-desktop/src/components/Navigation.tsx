import { FileUp, Code, History, Cpu } from "lucide-react";

export type ViewType = "analyze" | "translate" | "history" | "detail" | "performance";

interface NavigationProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

interface TabConfig {
  id: ViewType;
  label: string;
  icon: typeof FileUp;
  activeClass: string;
  isActive: boolean;
}

export default function Navigation({ currentView, onViewChange }: NavigationProps) {
  const inactiveClass = "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300";

  const tabs: TabConfig[] = [
    {
      id: "analyze",
      label: "Analyze",
      icon: FileUp,
      activeClass: "border-blue-500 text-blue-600 dark:text-blue-400",
      isActive: currentView === "analyze",
    },
    {
      id: "translate",
      label: "Code Analyzer",
      icon: Code,
      activeClass: "border-violet-500 text-violet-600 dark:text-violet-400",
      isActive: currentView === "translate",
    },
    {
      id: "history",
      label: "History",
      icon: History,
      activeClass: "border-blue-500 text-blue-600 dark:text-blue-400",
      isActive: currentView === "history" || currentView === "detail",
    },
    {
      id: "performance",
      label: "Performance",
      icon: Cpu,
      activeClass: "border-cyan-500 text-cyan-600 dark:text-cyan-400",
      isActive: currentView === "performance",
    },
  ];

  return (
    <nav
      className="mb-6 flex gap-2 border-b border-gray-300 dark:border-gray-700"
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
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition ${
              tab.isActive ? tab.activeClass : inactiveClass
            }`}
          >
            <Icon className="w-5 h-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
