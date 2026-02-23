interface SimpleBarChartProps {
  data: { label: string; count: number }[];
  height?: number;
  color?: string;
}

export function SimpleBarChart({
  data,
  height = 200,
  color = "#3b82f6",
}: SimpleBarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-slate-500"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const barWidth = Math.max(20, Math.min(60, 400 / data.length));
  const svgWidth = data.length * (barWidth + 8) + 40;
  const chartHeight = height - 40;

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${height}`}
      className="w-full"
      style={{ maxHeight: height }}
    >
      {data.map((d, i) => {
        const barH = (d.count / max) * chartHeight;
        const x = 30 + i * (barWidth + 8);
        const y = chartHeight - barH + 10;

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={3}
              fill={color}
              opacity={0.8}
            />
            <text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize={10}
            >
              {d.count}
            </text>
            <text
              x={x + barWidth / 2}
              y={height - 4}
              textAnchor="middle"
              fill="#64748b"
              fontSize={9}
              transform={`rotate(-45, ${x + barWidth / 2}, ${height - 4})`}
            >
              {d.label.length > 10
                ? d.label.slice(0, 10) + "..."
                : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
