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
  const iconBg = iconBgClassName ?? "bg-blue-500/20";
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`p-2 rounded-lg ${iconBg}`}>
          {icon}
        </span>
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-gray-400">{subtitle}</p>
        </div>
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        {children}
      </div>
    </div>
  );
}
