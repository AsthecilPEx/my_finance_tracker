import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Ring from '../components/Ring.jsx';
import MonthCalendar, { CalendarLegend } from '../components/MonthCalendar.jsx';
import { EVENT_TYPES } from '../components/events.js';
import { monthSummary, upcoming } from '../../engine/summary.js';
import { monthLabel, parseISO, shortDate, weekdayShort } from '../../engine/dates.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard({ go }) {
  const { state, today, fmt } = useApp();
  const t = parseISO(today);
  const [view, setView] = useState({ y: t.getFullYear(), m: t.getMonth() });
  const [selected, setSelected] = useState(today);
  const s = useMemo(() => monthSummary(state, view.y, view.m, today), [state, view, today]);
  const soon = useMemo(() => upcoming(state, today, 14), [state, today]);
  const shift = (n) => setView(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const used = s.spent + s.saved + s.committedPending;
  const leftRatio = s.income > 0 ? s.leftToSpend / s.income : 0;
  const status = !s.income ? { c: 'var(--accent)', t: 'Add your pay under Bills & Income', i: 'i' } : s.leftToSpend < 0 ? { c: 'var(--critical)', t: 'Overspent', i: '⚠' } : leftRatio < 0.1 ? { c: 'var(--warning)', t: 'Running low', i: '◐' } : { c: 'var(--good)', t: 'On track', i: '✓' };
  const selDay = s.days[selected];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting()}{state.settings.name ? `, ${state.settings.name}` : ''}</h1>
          <p className="muted">Here's your money at a glance.</p>
        </div>
        <div className="month-nav">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <span>{monthLabel(view.y, view.m)}</span>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
          {!s.isCurrent && <button className="btn ghost sm" onClick={() => { setView({ y: t.getFullYear(), m: t.getMonth() }); setSelected(today); }}>Today</button>}
        </div>
      </header>

      <div className="dash">
        <section className="dash-col">
          <div className="card hero">
            <Ring value={used} max={s.income} size={210} stroke={18} color={status.c} label={`${fmt(s.leftToSpend)} left to spend`}>
              <div className="hero-num" style={{ color: s.leftToSpend < 0 ? 'var(--critical)' : undefined }}>{fmt(s.leftToSpend, { decimals: 0 })}</div>
              <div className="hero-sub">{s.leftToSpend < 0 ? 'over' : 'left to spend'}</div>
            </Ring>
            <div className="equation">
              <div className="eq-row"><span>Income</span><b className="pos">{fmt(s.income, { decimals: 0 })}</b></div>
              <div className="eq-row"><span>− Spent</span><b>{fmt(s.spent, { decimals: 0 })}</b></div>
              {s.saved > 0 && <div className="eq-row"><span>− Saved</span><b>{fmt(s.saved, { decimals: 0 })}</b></div>}
              <div className="eq-row"><span>− Bills still to pay</span><b>{fmt(s.committedPending, { decimals: 0 })}</b></div>
              <div className="eq-row total"><span>= Left</span><b style={{ color: status.c }}>{fmt(s.leftToSpend, { decimals: 0 })}</b></div>
              <div className="status-pill" style={{ '--c': status.c }}><i aria-hidden>{status.i}</i>{status.t}</div>
            </div>
            <div className="hero-stats">
              {s.nextPayday && (
                <div className="stat">
                  <span className="stat-label">💼 Next payday</span>
                  <span className="stat-value">{s.nextPayday.inDays === 0 ? 'Today!' : `${s.nextPayday.inDays} day${s.nextPayday.inDays === 1 ? '' : 's'}`}</span>
                  <span className="stat-sub">{weekdayShort(s.nextPayday.date)} {shortDate(s.nextPayday.date)} · {fmt(s.nextPayday.amount, { decimals: 0 })}</span>
                </div>
              )}
              {s.safePerDay !== null && (
                <div className="stat">
                  <span className="stat-label">🛡️ Safe to spend</span>
                  <span className="stat-value">{fmt(s.safePerDay, { decimals: 0 })}<small>/day</small></span>
                  <span className="stat-sub">{s.safeBasis === 'balance' ? 'from bank balance' : 'until month end'}</span>
                </div>
              )}
              <button className="stat link" onClick={() => go('debts')}>
                <span className="stat-label">💳 Debts</span>
                <span className="stat-value">{fmt(s.debtTotal, { decimals: 0 })}</span>
                <span className="stat-sub">{s.debtInterest > 0 ? `${fmt(s.debtInterest, { decimals: 0 })}/mo interest` : 'no interest'}</span>
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Spending by category</h3>
              <button className="btn ghost sm" onClick={() => go('budgets')}>Set budgets</button>
            </div>
            {s.byCategory.length === 0 ? (
              <p className="empty">No spending yet this month. Add a transaction or import a statement.</p>
            ) : (
              <div className="meters">
                {s.byCategory.map((c) => (
                  <div key={c.id} className={`meter ${c.over ? 'over' : ''}`} title={`${c.name}: ${fmt(c.spent)} spent${c.target ? ` of ${fmt(c.target)} ${c.budget ? 'budget' : '(3-month average)'}` : ''}${c.pending ? `, ${fmt(c.pending)} still due` : ''}`}>
                    <Ring value={c.spent} max={c.target || c.spent} size={86} stroke={9} color={c.color} label={c.name}>
                      <span className="meter-icon" aria-hidden>{c.icon}</span>
                    </Ring>
                    <div className="meter-name">{c.name}</div>
                    <div className="meter-val">{fmt(c.spent, { decimals: 0 })}{c.target > 0 && <span className="muted"> / {fmt(c.target, { decimals: 0 })}</span>}</div>
                    {c.over ? <div className="meter-flag">⚠ {fmt(c.spent - c.budget, { decimals: 0 })} over</div>
                      : c.pending > 0 ? <div className="meter-due">+{fmt(c.pending, { decimals: 0 })} due</div>
                      : !c.budget && c.target > 0 ? <div className="meter-due">vs usual</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="dash-col">
          <div className="card">
            <div className="card-head">
              <h3>{monthLabel(view.y, view.m, 'long')}</h3>
              <span className="muted sm">Money in {fmt(s.income, { decimals: 0 })} · Committed {fmt(s.occurrences.filter((o) => o.amount < 0).reduce((a, o) => a - o.amount, 0), { decimals: 0 })}</span>
            </div>
            <MonthCalendar summary={s} selected={selected} onSelect={setSelected} />
            <CalendarLegend />
          </div>

          <div className="card">
            {selDay ? (
              <>
                <div className="card-head"><h3>{weekdayShort(selected)} {shortDate(selected)}</h3>{selDay.spend > 0 && <span className="muted sm">Spent {fmt(selDay.spend)}</span>}</div>
                {selDay.events.length === 0 && selDay.txns.length === 0 && <p className="empty">Nothing on this day.</p>}
                <ul className="list">
                  {selDay.events.map((e) => (
                    <li key={e.key} className="list-row">
                      <span className="dot" style={{ background: EVENT_TYPES[e.type].color }} />
                      <span className="grow">{e.name}<small className="muted"> · {EVENT_TYPES[e.type].label}{e.compulsory ? ' · compulsory' : ''}</small></span>
                      <span className={`badge ${e.status}`}>{e.status === 'done' ? '✓ Paid' : e.status === 'assumed' ? 'Not seen' : 'Due'}</span>
                      <b className={e.amount > 0 ? 'pos' : ''}>{fmt(e.amount, { sign: true })}</b>
                    </li>
                  ))}
                  {selDay.txns.map((tx) => (
                    <li key={tx.id} className="list-row">
                      <span className="dot" style={{ background: state.categories.find((c) => c.id === tx.categoryId)?.color }} />
                      <span className="grow">{tx.description}<small className="muted"> · {state.categories.find((c) => c.id === tx.categoryId)?.name}</small></span>
                      <b className={tx.amount > 0 ? 'pos' : ''}>{fmt(tx.amount, { sign: true })}</b>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="card">
            <div className="card-head"><h3>Coming up · next 14 days</h3><button className="btn ghost sm" onClick={() => go('bills')}>Manage</button></div>
            {soon.length === 0 ? <p className="empty">No bills or paydays in the next two weeks.</p> : (
              <ul className="list">
                {soon.slice(0, 8).map((e) => (
                  <li key={e.key} className="list-row">
                    <span className="when">{e.inDays === 0 ? 'Today' : e.inDays === 1 ? 'Tmrw' : `${e.inDays}d`}</span>
                    <span className="dot" style={{ background: EVENT_TYPES[e.type].color }} />
                    <span className="grow">{e.name}<small className="muted"> · {weekdayShort(e.date)} {shortDate(e.date)}</small></span>
                    {e.compulsory && <span className="badge must">Must pay</span>}
                    <b className={e.amount > 0 ? 'pos' : ''}>{fmt(e.amount, { sign: true })}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
