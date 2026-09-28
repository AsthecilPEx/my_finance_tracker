// Circular progress meter in the style of fitness/calorie apps.
// value/max drives the arc; past 100% a second lap is drawn in the warning colour.
export default function Ring({ value, max, size = 120, stroke = 12, color = '#3a86ee', track = 'var(--ring-track)', overColor = 'var(--critical)', children, label, glow = true }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? value / max : value > 0 ? 1 : 0;
  const first = Math.min(1, Math.max(0, ratio));
  const over = Math.min(1, Math.max(0, ratio - 1));
  const arc = (frac) => `${Math.max(0, frac * c - 0.001)} ${c}`;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {first > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={arc(first)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={glow ? { filter: `drop-shadow(0 0 ${stroke / 2}px ${color}88)` } : undefined}
            className="ring-arc"
          />
        )}
        {over > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={overColor} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={arc(over)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className="ring-arc"
          />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
