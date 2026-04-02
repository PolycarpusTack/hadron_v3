const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  high: "bg-orange-500/20 text-orange-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-blue-500/20 text-blue-400",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity.toLowerCase()] || SEVERITY_COLORS.medium;
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {severity}
    </span>
  );
}
