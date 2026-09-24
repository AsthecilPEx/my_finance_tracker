import { useMemo } from 'react';
import { useApp } from './store.jsx';
import { api } from './api.js';
import Ring from './components/Ring.jsx';
import { EVENT_TYPES } from './components/events.js';
import { monthSummary, upcoming } from '../engine/summary.js';
import { parseISO, shortDate } from '../engine/dates.js';

// Compact always-available card for the Windows desktop.
export default function Widget() {
  const { state, today, fmt } = useApp();
  const t = parseISO(today);
  const s = useMemo(() => monthSummary(state, t.getFullYear(), t.getMonth(), today), [state, today]);
  const soon = useMemo(() => upcoming(state, today, 10).filter((e) => e.amount < 0).slice(0, 3), [state, today]);
  const used = s.spent + s.saved + s.committedPending;
  const color = s.leftToSpend < 0 ? 'var(--critical)' : s.income && s.leftToSpend / s.income < 0.1 ? 'var(--warning)' : 'var(--good)';
  const top = s.byCategory.filter((c) => c.type === 'lifestyle').slice(0, 4);

  return (
    <div className="widget" style={{ opacity: state.settings.widget.opacity }}>
      <div className="widget-bar">
        <span className="brand sm"><span className="brand-dot" />Pulse</span>
        <span className="grow drag" />
        <button className="icon-btn" title="Open Pulse" onClick={() => api.openMain()}>⤢</button>
        <button className="icon-btn" title="Hide widget" onClick={() => api.closeWidget()}>✕</button>
      </div>
      <div className="widget-hero">
        <Ring value={used} max={s.income} size={112} stroke={11} color={color} label="Left to spend">
          <div className="w-num">{fmt(s.leftToSpend, { decimals: 0 })}</div>
          <div className="w-sub">left</div>
        </Ring>
        <div className="widget-stats">
          {s.nextPayday && <div><span>💼 Payday</span><b>{s.nextPayday.inDays === 0 ? 'Today!' : `in ${s.nextPayday.inDays}d`}</b></div>}
          {s.safePerDay !== null && <div><span>🛡️ Safe/day</span><b>{fmt(s.safePerDay, { decimals: 0 })}</b></div>}
          <div><span>📉 Spent</span><b>{fmt(s.spent, { decimals: 0 })}</b></div>
        </div>
      </div>
      <div className="widget-bars">
        {top.map((c) => (
          <div key={c.id} className="wbar">
            <span className="wbar-label">{c.icon} {c.name}</span>
            <span className="wbar-track"><span style={{ width: `${Math.min(100, c.pct * 100)}%`, background: c.over ? 'var(--critical)' : c.color }} /></span>
            <span className={`wbar-val ${c.over ? 'neg' : ''}`}>{c.over ? '⚠ ' : ''}{fmt(c.spent, { decimals: 0 })}</span>
          </div>
        ))}
      </div>
      <div className="widget-list">
        {soon.length === 0 ? <div className="muted sm">No bills in the next 10 days 🎉</div> : soon.map((e) => (
          <div key={e.key} className="wrow">
            <span className="dot" style={{ background: EVENT_TYPES[e.type].color }} />
            <span className="grow">{e.name}</span>
            <span className="muted">{e.inDays === 0 ? 'today' : e.inDays === 1 ? 'tmrw' : shortDate(e.date)}</span>
            <b>{fmt(-e.amount, { decimals: 0 })}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
