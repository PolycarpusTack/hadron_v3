function scoreColor(score: number): string {
  if (score < 40) return "#ef4444";
  if (score < 70) return "#eab308";
  return "#22c55e";
}

export function QualityGauge({
  score,
  size = 80,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = scoreColor(clamped);

  return (
    <div className="relative flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-0 text-sm font-bold"
        style={{ color }}
      >
        {clamped}
      </span>
      {label && <span className="text-xs text-slate-400">{label}</span>}
    </div>
  );
}
