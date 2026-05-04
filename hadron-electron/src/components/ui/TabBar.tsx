import React from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface TabBarProps<T extends string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  accentColor?: string;
}

export default function TabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  accentColor = "amber",
}: TabBarProps<T>) {
  const activeClasses = `border-${accentColor}-500 text-${accentColor}-400`;
  const inactiveClasses = "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600";

  return (
    <div className="border-b border-gray-700">
      <nav className="flex gap-1 overflow-x-auto pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === tab.id ? activeClasses : inactiveClasses
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && ` (${tab.count})`}
          </button>
        ))}
      </nav>
    </div>
  );
}
