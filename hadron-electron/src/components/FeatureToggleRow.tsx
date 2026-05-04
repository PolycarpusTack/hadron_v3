import { useState, type ReactNode } from "react";
import { getBooleanSetting, setBooleanSetting } from "../utils/config";

const ACCENT_COLORS = {
  violet: { bg: "bg-violet-500/10", toggle: "bg-violet-600" },
  cyan:   { bg: "bg-cyan-500/10",   toggle: "bg-cyan-600" },
  emerald:{ bg: "bg-emerald-500/10", toggle: "bg-emerald-600" },
  blue:   { bg: "bg-blue-500/10",   toggle: "bg-blue-600" },
} as const;

export type ToggleAccent = keyof typeof ACCENT_COLORS;

interface FeatureToggleRowProps {
  storageKey: string;
  label: string;
  description: string;
  icon: ReactNode;
  accent: ToggleAccent;
  defaultValue?: boolean;
  onToggle?: () => void;
}

export default function FeatureToggleRow({
  storageKey,
  label,
  description,
  icon,
  accent,
  defaultValue = true,
  onToggle,
}: FeatureToggleRowProps) {
  const [enabled, setEnabled] = useState(() => getBooleanSetting(storageKey, defaultValue));
  const colors = ACCENT_COLORS[accent];

  const handleClick = () => {
    const next = !enabled;
    setEnabled(next);
    setBooleanSetting(storageKey, next);
    onToggle?.();
  };

  return (
    <div className="hd-setting-row">
      <div className="flex items-center gap-3">
        <span className={`p-1.5 rounded-md ${colors.bg}`}>
          {icon}
        </span>
        <div>
          <label className="block text-sm font-semibold mb-0.5">{label}</label>
          <p className="text-xs text-gray-400">{description}</p>
        </div>
      </div>
      <button
        onClick={handleClick}
        className={`hd-toggle ${enabled ? colors.toggle : "bg-gray-600"}`}
      >
        <div className={`hd-toggle-knob ${enabled ? "translate-x-7" : "translate-x-1"}`} />
      </button>
    </div>
  );
}
