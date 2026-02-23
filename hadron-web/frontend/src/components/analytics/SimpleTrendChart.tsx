interface SimpleTrendChartProps {
  data: { date: string; count: number }[];
  height?: number;
  color?: string;
}

export function SimpleTrendChart({
  data,
  height = 200,
  color = "#3b82f6",
}: SimpleTrendChartProps) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-sm text-slate-500"
        style={{ height }}
      >
        Not enough data
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const padding = { top: 10, right: 10, bottom: 30, left: 30 };
  const svgWidth = 600;
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * chartWidth,
    y: padding.top + chartHeight - (d.count / max) * chartHeight,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  return (
    <svg viewBox={`0 0 ${svgWidth} ${height}`} className="w-full" style={{ maxHeight: height }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map((frac) => {
        const y = padding.top + chartHeight - frac * chartHeight;
        return (
          <g key={frac}>
            <line
              x1={padding.left}
              y1={y}
              x2={svgWidth - padding.right}
              y2={y}
              stroke="#1e293b"
              strokeWidth={1}
            />
            <text x={padding.left - 4} y={y + 3} textAnchor="end" fill="#64748b" fontSize={9}>
              {Math.round(max * frac)}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaPath} fill={color} opacity={0.1} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}

      {/* X-axis labels (first, middle, last) */}
      {[0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
        <text
          key={idx}
          x={points[idx].x}
          y={height - 4}
          textAnchor="middle"
          fill="#64748b"
          fontSize={9}
        >
          {data[idx].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}
