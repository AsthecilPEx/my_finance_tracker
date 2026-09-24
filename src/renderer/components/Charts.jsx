import { useState } from 'react';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / (v / p > 5 ? 2 : 1)) * p * (v / p > 5 ? 2 : 1);
}

/** Grouped vertical bars with a hover tooltip. series: [{key, name, color}] rows: [{label, [key]: number}] */
export function GroupedBars({ rows, series, height = 220, format }) {
  const [hover, setHover] = useState(null);
  const w = 560;
  const pad = { l: 48, r: 8, t: 16, b: 26 };
  const max = niceMax(Math.max(...rows.flatMap((r) => series.map((s) => r[s.key] || 0))));
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const group = iw / rows.length;
  const barW = Math.min(22, (group * 0.7) / series.length - 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" aria-label={`${series.map((s) => s.name).join(' vs ')} by month`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={pad.l - 6} y={y(t) + 4} className="tick" textAnchor="end">{format(t, true)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const gx = pad.l + i * group + (group - (barW + 2) * series.length) / 2;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * group} y={pad.t} width={group} height={ih} fill="transparent" />
              {series.map((s, j) => {
                const v = r[s.key] || 0;
                const h = Math.max(0, (v / max) * ih);
                const x = gx + j * (barW + 2);
                return (
                  <path
                    key={s.key}
                    d={roundedTop(x, y(v), barW, h)}
                    fill={s.color}
                    opacity={hover === null || hover === i ? (r.partial ? 0.6 : 1) : 0.35}
                  />
                );
              })}
              <text x={pad.l + i * group + group / 2} y={height - 8} className="tick" textAnchor="middle">{r.label}{r.partial ? '*' : ''}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${((pad.l + (hover + 0.5) * group) / w) * 100}%` }}>
          <b>{rows[hover].label}{rows[hover].partial ? ' (so far)' : ''}</b>
          {series.map((s) => <div key={s.key}><span className="swatch" style={{ background: s.color }} />{s.name}: {format(rows[hover][s.key] || 0)}</div>)}
        </div>
      )}
      <div className="legend">
        {series.map((s) => <span key={s.key} className="legend-item"><span className="swatch" style={{ background: s.color }} />{s.name}</span>)}
        {rows.some((r) => r.partial) && <span className="legend-item muted">* current month so far</span>}
      </div>
    </div>
  );
}

function roundedTop(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Tiny bar series for small-multiple trend cards. */
export function SparkBars({ values, color, labels, format }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 36;
  const bw = w / values.length - 3;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="spark">
      {values.map((v, i) => {
        const bh = Math.max(v > 0 ? 2 : 0, (v / max) * (h - 2));
        return (
          <path key={i} d={roundedTop(i * (bw + 3), h - bh, bw, bh)} fill={color} opacity={i === values.length - 1 ? 1 : 0.45}>
            <title>{labels?.[i]}: {format ? format(v) : v}</title>
          </path>
        );
      })}
    </svg>
  );
}

/** Horizontal part-to-whole bar with 2px gaps between segments and labels underneath. */
export function SplitBar({ parts, format }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="splitbar">
      <div className="splitbar-track">
        {parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.key} className="splitbar-seg" style={{ flex: p.value, background: p.color }} title={`${p.label}: ${format(p.value)} (${Math.round((p.value / total) * 100)}%)`} />
        ))}
      </div>
      <div className="splitbar-labels">
        {parts.map((p) => (
          <div key={p.key} className="split-label">
            <span className="swatch" style={{ background: p.color }} />
            <div>
              <div>{p.label}</div>
              <b>{format(p.value)}</b> <span className="muted">· {Math.round((p.value / total) * 100)}%</span>
              {p.hint && <div className="muted sm">{p.hint}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
