import React from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export type TabAccentColor = "amber" | "sky" | "orange" | "emerald" | "violet" | "blue" | "rose";

// Static map — Tailwind's scanner cannot detect classes built from template literals.
const ACCENT_CLASSES: Record<TabAccentColor, string> = {
  amber:   "border-amber-500 text-amber-400",
  sky:     "border-sky-500 text-sky-400",
  orange:  "border-orange-500 text-orange-400",
  emerald: "border-emerald-500 text-emerald-400",
  violet:  "border-violet-500 text-violet-400",
  blue:    "border-blue-500 text-blue-400",
  rose:    "border-rose-500 text-rose-400",
};

interface TabBarProps<T extends string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  accentColor?: TabAccentColor;
}

export default function TabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  accentColor = "amber",
}: TabBarProps<T>) {
  const activeClasses = ACCENT_CLASSES[accentColor] ?? ACCENT_CLASSES.amber;

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
