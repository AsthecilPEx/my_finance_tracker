import { useApp } from '../store.jsx';
import { parseISO } from '../../engine/dates.js';
import { EVENT_TYPES, compactMoney } from './events.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthCalendar({ summary, selected, onSelect }) {
  const { today, currency, fmt } = useApp();
  const dates = Object.keys(summary.days);
  const lead = (parseISO(dates[0]).getDay() + 6) % 7;
  // Scale to a typical busy day (90th percentile) so one big purchase doesn't flatten the rest.
  const flexes = dates.map((d) => summary.days[d].flex).filter((v) => v > 0).sort((a, b) => a - b);
  const maxFlex = Math.max(1, flexes[Math.floor(flexes.length * 0.9)] || 0);

  return (
    <div className="calendar">
      {WEEKDAYS.map((w) => <div key={w} className="cal-head">{w}</div>)}
      {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="cal-blank" />)}
      {dates.map((iso) => {
        const day = summary.days[iso];
        const payday = day.events.some((e) => e.type === 'payday');
        const past = iso < today;
        const shown = day.events.slice(0, payday ? 1 : 2);
        const more = day.events.length - shown.length;
        const tip = [
          ...day.events.map((e) => `${EVENT_TYPES[e.type].label}: ${e.name} ${fmt(e.amount)}${e.status === 'done' ? ' ✓' : e.status === 'assumed' ? ' (not seen on statement)' : ''}`),
          day.flex ? `Day-to-day spending ${fmt(day.flex)}` : null,
        ].filter(Boolean).join('\n');
        return (
          <button
            key={iso}
            className={`cal-day ${payday ? 'payday' : ''} ${iso === today ? 'today' : ''} ${past ? 'past' : ''} ${selected === iso ? 'selected' : ''}`}
            onClick={() => onSelect(iso)}
            title={tip || undefined}
          >
            <span className="cal-top">
              <span className="cal-num">{parseISO(iso).getDate()}</span>
              {payday && <span className="payday-tag">PAY</span>}
            </span>
            <span className="cal-chips">
              {shown.map((e) => {
                const t = EVENT_TYPES[e.type];
                return (
                  <span key={e.key} className={`chip ${e.status}`} style={{ '--c': t.color }}>
                    <i aria-hidden>{e.status === 'done' ? '✓' : t.icon}</i>{compactMoney(e.amount, currency)}
                  </span>
                );
              })}
              {more > 0 && <span className="chip more">+{more}</span>}
            </span>
            {day.flex > 0 && <span className="spend-bar" style={{ width: `${Math.min(100, Math.max(8, (day.flex / maxFlex) * 100))}%` }} />}
          </button>
        );
      })}
    </div>
  );
}

export function CalendarLegend() {
  return (
    <div className="legend">
      {Object.entries(EVENT_TYPES).map(([k, t]) => (
        <span key={k} className="legend-item"><span className="swatch" style={{ background: t.color }} />{t.label}</span>
      ))}
      <span className="legend-item"><span className="swatch bar" />Day-to-day spending</span>
      <span className="legend-item"><span className="swatch done">✓</span>Paid</span>
    </div>
  );
}
