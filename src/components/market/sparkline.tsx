/** Tiny line of daily prices; the last point (today, live) is drawn as a dot. */
export function Sparkline({ values, width = 72, height = 22, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) return <span className="text-[10px] text-faint">–</span>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  const color = up ? "var(--pos)" : "var(--neg)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`7-day price ${up ? "up" : "down"} ${Math.round((values[values.length - 1]! / values[0]! - 1) * 1000) / 10}%`}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={2} fill={color} />
    </svg>
  );
}
