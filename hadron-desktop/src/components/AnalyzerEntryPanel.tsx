import type { ReactNode } from "react";

interface AnalyzerEntryPanelProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  iconBgClassName?: string;
  children: ReactNode;
}

export default function AnalyzerEntryPanel({
  icon,
  title,
  subtitle,
  iconBgClassName,
  children
}: AnalyzerEntryPanelProps) {
  const iconBg = iconBgClassName ?? "bg-emerald-500/15";
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <span className={`p-2 rounded-lg ${iconBg}`}>
          {icon}
        </span>
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--hd-text)' }}>{title}</h2>
          <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>{subtitle}</p>
        </div>
      </div>

      <div className="hd-panel p-6">
        {children}
      </div>
    </div>
  );
}
