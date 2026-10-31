interface Props {
  values: readonly number[];
  className?: string;
}

/** 30-session close sparkline; the dashed line marks where the series started. */
export function Sparkline({ values, className = "" }: Props) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 32;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = pad + (1 - (v - min) / span) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const up = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  const stroke = up ? "var(--color-bull)" : "var(--color-bear)";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`30-session trend ${up ? "up" : "down"}`}
    >
      {first ? (
        <line x1="0" x2={W} y1={first[1]} y2={first[1]} stroke="var(--color-line)" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ) : null}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last[0]} cy={last[1]} r="2.2" fill={stroke} /> : null}
    </svg>
  );
}
