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

  return (
    <div className="border-b" style={{ borderColor: "var(--hd-border)" }}>
      <nav className="flex gap-1 overflow-x-auto pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              activeTab === tab.id
                ? activeClasses
                : "border-transparent hover:border-gray-600"
            }`}
            style={activeTab !== tab.id ? { color: "var(--hd-text-muted)" } : undefined}
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
