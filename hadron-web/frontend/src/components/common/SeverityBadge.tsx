interface SeverityBadgeProps {
  severity: string | null;
}

const severityStyles: Record<string, string> = {
  CRITICAL: "bg-red-500/20 text-red-400 border-red-500/30",
  HIGH: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  MEDIUM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  LOW: "bg-green-500/20 text-green-400 border-green-500/30",
};

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  if (!severity) return null;

  const upper = severity.toUpperCase();
  const style =
    severityStyles[upper] ||
    "bg-slate-500/20 text-slate-400 border-slate-500/30";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {upper}
    </span>
  );
}
