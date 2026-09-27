import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Ring from '../components/Ring.jsx';
import Modal from '../components/Modal.jsx';
import { Field } from '../components/Forms.jsx';
import { EVENT_TYPES, compactMoney } from '../components/events.js';
import { payPlan, bonusPaydayMonths, incomeVariability } from '../../engine/planner.js';
import { profileSummary, describeSchedule } from '../../engine/income.js';
import { shortDate, weekdayShort, daysBetween, parseISO } from '../../engine/dates.js';
import { splitTotals } from '../../engine/split.js';

export default function Planner({ go }) {
  const { state, today, fmt, currency } = useApp();
  const plan = useMemo(() => payPlan(state, today, 8), [state, today]);
  const bonus = useMemo(() => bonusPaydayMonths(state, today), [state, today]);
  const vari = useMemo(() => incomeVariability(state, today), [state, today]);
  const prof = profileSummary(state);
  const potOn = state.settings.billPot?.enabled !== false;
  const [goalEdit, setGoalEdit] = useState(null);

  if (!prof.sources.length && !plan.periods.length) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>Pay Planner</h1></div></header>
        <div className="card"><p className="empty">Tell Pulse how you're paid and the planner will map every payday to the bills it needs to cover.</p><button className="btn primary" onClick={() => go('settings')}>Add my pay</button></div>
      </div>
    );
  }
  const bufferPct = plan.startingBuffer > 0 ? Math.min(1, plan.potBalance / plan.startingBuffer) : 1;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Pay Planner</h1><p className="muted">Bills are monthly. Pay often isn't. This turns your paydays into a steady, predictable routine.</p></div>
      </header>

      <div className="kpis">
        <div className="kpi"><span>Take-home (planned)</span><b className="pos">{fmt(prof.monthly, { decimals: 0 })}<small>/mo</small></b></div>
        <div className="kpi"><span>Bills & debt payments</span><b>{fmt(plan.commitmentsMonthly, { decimals: 0 })}<small>/mo</small></b></div>
        <div className="kpi"><span>Savings goals</span><b>{fmt(plan.goalsMonthly, { decimals: 0 })}<small>/mo</small></b></div>
        <div className="kpi accent"><span>Steady spending money</span><b>{fmt(plan.allowancePerDay, { decimals: 0 })}<small>/day</small></b></div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h3>🔁 Your payday routine</h3></div>
          <p className="muted sm">Do this every time money lands. Bigger paydays put in more, so every pay pulls its weight.</p>
          {prof.sources.map((s) => {
            const pay = s.plannedPerPay;
            const toBills = potOn ? pay * plan.billsShare : 0;
            const toGoals = pay * plan.goalsShare;
            return (
              <div key={s.inc.id} className="routine">
                <div className="routine-head"><b>When {s.inc.name} lands</b><span className="muted sm">{describeSchedule(s.inc.schedule)} · {fmt(pay)}{s.inc.variable ? ' (lowest)' : ''}</span></div>
                <div className="routine-bar" aria-hidden>
                  {toBills > 0 && <span style={{ flex: toBills, background: EVENT_TYPES.bill.color }} />}
                  {toGoals > 0 && <span style={{ flex: toGoals, background: EVENT_TYPES.savings.color }} />}
                  <span style={{ flex: Math.max(0, pay - toBills - toGoals), background: '#12a578' }} />
                </div>
                <ul className="routine-steps">
                  {potOn && <li><span className="swatch" style={{ background: EVENT_TYPES.bill.color }} />Move <b>{fmt(toBills)}</b> to your bills pot</li>}
                  {toGoals > 0 && <li><span className="swatch" style={{ background: EVENT_TYPES.savings.color }} />Move <b>{fmt(toGoals)}</b> to savings goals</li>}
                  <li><span className="swatch" style={{ background: '#12a578' }} />Keep <b>{fmt(pay - toBills - toGoals)}</b> for everyday spending</li>
                </ul>
              </div>
            );
          })}
          {vari && vari.cv > 0.08 && (
            <div className="callout">📉 Your pay has varied between <b>{fmt(vari.min, { decimals: 0 })}</b> and <b>{fmt(vari.max, { decimals: 0 })}</b> a month over the last {vari.months} months. Plan on the low end; anything extra goes to your buffer first.</div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>🛟 Smoothing buffer</h3></div>
          <div className="buffer">
            <Ring value={plan.potBalance} max={plan.startingBuffer || 1} size={120} stroke={12} color={bufferPct >= 1 ? 'var(--good)' : 'var(--warning)'} label="Buffer">
              <div className="w-num">{Math.round(bufferPct * 100)}%</div><div className="w-sub">ready</div>
            </Ring>
            <div>
              <p>To keep every bill paid on time and spend a steady <b>{fmt(plan.allowancePerDay, { decimals: 0 })}/day</b>, you need about <b>{fmt(plan.startingBuffer, { decimals: 0 })}</b> set aside today.</p>
              <p className="muted sm">That's {fmt(plan.billsBuffer, { decimals: 0 })} for bills that land before your pot has built up, plus {fmt(plan.spendBuffer, { decimals: 0 })} to even out the gaps between paydays. You have {fmt(plan.potBalance, { decimals: 0 })} (set in Settings).</p>
              {plan.bufferGap > 0 ? <div className="badge upcoming">Build {fmt(plan.bufferGap, { decimals: 0 })} more, e.g. from your next bonus payday</div> : <div className="badge done">✓ Buffer covered</div>}
            </div>
          </div>
          {bonus.length > 0 && (
            <>
              <h4 style={{ marginTop: 8 }}>🎁 Extra-payday months</h4>
              <p className="muted sm">These months have one more payday than usual, but bills don't go up. Send the extra straight to your buffer or a goal.</p>
              <ul className="list compact">
                {bonus.slice(0, 5).map((b) => <li key={b.key + b.name} className="list-row"><span className="grow">{b.label} · {b.name}</span><b className="pos">+{fmt(b.amount, { decimals: 0 })}</b></li>)}
              </ul>
            </>
          )}
        </div>
      </div>

      <Pots plan={plan} prof={prof} go={go} />

      <div className="card">
        <div className="card-head"><h3>🗓️ Next pay periods</h3></div>
        <ul className="explain">
          <li><b>Period</b>: from a payday up to the day before your next one. "Now" is today until your next pay.</li>
          <li><b>Pay in</b>: what lands on that payday (planned at your lowest pay if it varies).</li>
          <li><b>Bills due</b>: every bill, subscription and debt payment falling in that period.</li>
          <li><b>Bills pot after</b>: what's left in your bills pot once those bills are paid, if you follow the routine. It should never go below £0.</li>
          <li><b>Spending money</b>: your steady allowance for those days ({fmt(plan.allowancePerDay, { decimals: 0 })} × number of days).</li>
        </ul>
        <div className="period-head" aria-hidden><span>Period</span><span>Pay in</span><span>Bills due</span><span>Bills pot after · spending</span></div>
        <div className="periods">
          {plan.periods.map((p) => (
            <div key={p.from} className={`period ${p.current ? 'current' : ''}`}>
              <div className="period-when">
                <b>{p.current ? 'Now' : `${weekdayShort(p.from)} ${shortDate(p.from)}`}</b>
                <span className="muted sm">{p.current ? `until ${shortDate(p.to)}` : `${p.days} days · to ${shortDate(p.to)}`}</span>
              </div>
              <div className="period-in">{p.income > 0 ? <><b className="pos">+{fmt(p.income, { decimals: 0 })}</b><span className="muted sm">{p.names.join(' + ')}</span></> : <span className="muted sm">from what you have now</span>}</div>
              <div className="period-bills">
                {p.bills.length === 0 ? <span className="muted sm">No bills due</span> : p.bills.slice(0, 5).map((b) => (
                  <span key={b.key} className="chip" style={{ '--c': EVENT_TYPES[b.type].color }} title={`${b.name} · ${shortDate(b.date)}`}>{b.name.split(' ')[0]} {compactMoney(b.amount, currency)}</span>
                ))}
                {p.bills.length > 5 && <span className="chip more">+{p.bills.length - 5}</span>}
                {p.shortWithoutPot > 0 && potOn && <div className="warn-line">Paid straight from this pay you'd be {fmt(p.shortWithoutPot, { decimals: 0 })} short. The pot covers it.</div>}
              </div>
              <div className="period-pots">
                <span title="Bills pot balance after this period's bills">🪣 {fmt(p.potAfter, { decimals: 0 })} <small className="muted">in pot</small></span>
                <span className="muted sm">{fmt(p.allowance, { decimals: 0 })} to spend</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>🎯 Savings goals</h3><button className="btn ghost sm" onClick={() => setGoalEdit({ name: '', icon: '🎯', target: '', saved: 0, perMonth: '', targetDate: '' })}>+ New goal</button></div>
        {(state.goals || []).length === 0 ? <p className="empty">No goals yet. Even £5 a payday into an emergency fund makes a real difference.</p> : (
          <div className="goals">
            {state.goals.map((g) => <GoalCard key={g.id} g={g} today={today} onEdit={() => setGoalEdit(g)} />)}
          </div>
        )}
      </div>
      {goalEdit && <GoalModal goal={goalEdit} onClose={() => setGoalEdit(null)} />}
    </div>
  );
}

function GoalCard({ g, today, onEdit }) {
  const { fmt, dispatch } = useApp();
  const pct = g.target ? (g.saved || 0) / g.target : 0;
  const monthsLeft = g.perMonth > 0 ? Math.ceil(Math.max(0, g.target - (g.saved || 0)) / g.perMonth) : null;
  const byDate = g.targetDate ? Math.max(1, Math.round(daysBetween(today, g.targetDate) / 30.4)) : null;
  const needed = byDate ? Math.max(0, g.target - (g.saved || 0)) / byDate : null;
  return (
    <div className="goal">
      <Ring value={g.saved || 0} max={g.target} size={84} stroke={9} color="#3a86ee" label={g.name}><span className="meter-icon">{g.icon || '🎯'}</span></Ring>
      <div className="grow">
        <div className="goal-head"><b>{g.name}</b><button className="icon-btn" aria-label="Edit goal" onClick={onEdit}>✎</button></div>
        <div>{fmt(g.saved || 0, { decimals: 0 })} <span className="muted">of {fmt(g.target, { decimals: 0 })} · {Math.round(pct * 100)}%</span></div>
        <div className="muted sm">
          {g.perMonth ? `${fmt(g.perMonth, { decimals: 0 })}/month` : 'No monthly amount'}
          {monthsLeft !== null && pct < 1 ? ` · done in ~${monthsLeft} month${monthsLeft === 1 ? '' : 's'}` : ''}
          {needed !== null && pct < 1 && g.perMonth < needed ? ` · needs ${fmt(needed, { decimals: 0 })}/mo to hit ${parseISO(g.targetDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}
        </div>
        <div className="inline-row">
          {[10, 25, 50].map((a) => <button key={a} className="btn ghost sm" onClick={() => dispatch({ type: 'goal/contribute', payload: { id: g.id, amount: a } })}>+{fmt(a, { decimals: 0 })}</button>)}
        </div>
      </div>
    </div>
  );
}

function GoalModal({ goal, onClose }) {
  const { dispatch } = useApp();
  const [g, setG] = useState(goal);
  const set = (k) => (e) => setG({ ...g, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    await dispatch({ type: 'goal/save', payload: { ...g, target: +g.target, saved: +g.saved || 0, perMonth: +g.perMonth || 0, targetDate: g.targetDate || null } });
    onClose();
  };
  return (
    <Modal title={goal.id ? `Edit ${goal.name}` : 'New savings goal'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="row2">
          <Field label="Goal"><input required value={g.name} onChange={set('name')} placeholder="e.g. Emergency fund" /></Field>
          <Field label="Icon"><input value={g.icon} onChange={set('icon')} maxLength={4} /></Field>
        </div>
        <div className="row3">
          <Field label="Target"><input type="number" min="1" required value={g.target} onChange={set('target')} /></Field>
          <Field label="Saved so far"><input type="number" min="0" value={g.saved} onChange={set('saved')} /></Field>
          <Field label="Save per month"><input type="number" min="0" value={g.perMonth} onChange={set('perMonth')} /></Field>
        </div>
        <Field label="Target date (optional)"><input type="date" value={g.targetDate || ''} onChange={set('targetDate')} /></Field>
        <div className="form-actions">
          {goal.id && <button type="button" className="btn ghost danger" onClick={() => { dispatch({ type: 'goal/delete', payload: { id: goal.id } }); onClose(); }}>Delete</button>}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** Where the money you've set aside actually is: the bills pot, goal pots and money owed to you. */
function Pots({ plan, prof, go }) {
  const { state, dispatch, fmt, today, notify } = useApp();
  const [amount, setAmount] = useState('');
  const balance = state.settings.billPot?.balance || 0;
  const owed = splitTotals(state, today);
  const suggested = prof.sources.map((s) => ({ name: s.inc.name, amount: Math.round(s.plannedPerPay * plan.billsShare * 100) / 100 })).filter((x) => x.amount > 0);
  const move = (amt, note) => { dispatch({ type: 'pot/move', payload: { amount: amt, note } }); notify(`${amt > 0 ? 'Added' : 'Took'} ${fmt(Math.abs(amt))} ${amt > 0 ? 'to' : 'from'} your bills pot`, 'good'); setAmount(''); };
  return (
    <div className="card">
      <div className="card-head"><h3>🪣 Your pots</h3><span className="muted sm">Money set aside, and where it is</span></div>
      <div className="pots">
        <div className="pot">
          <span className="muted sm">Bills pot</span>
          <span className="pot-amount">{fmt(balance)}</span>
          <span className={`sm ${balance >= plan.startingBuffer ? 'pos' : 'muted'}`}>{balance >= plan.startingBuffer ? '✓ enough to cover upcoming bills' : `${fmt(plan.startingBuffer - balance, { decimals: 0 })} short of the buffer you need`}</span>
          <div className="inline-row">
            {suggested.map((s) => <button key={s.name} className="btn primary sm" onClick={() => move(s.amount, `${s.name} payday`)}>+{fmt(s.amount, { decimals: 0 })} ({s.name.split(' ')[0]})</button>)}
          </div>
          <div className="inline-row">
            <input type="number" min="0" step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
            <button className="btn ghost sm" disabled={!(+amount > 0)} onClick={() => move(+amount, 'Moved in')}>I moved it in</button>
            <button className="btn ghost sm" disabled={!(+amount > 0)} onClick={() => move(-amount, 'Paid a bill')}>Paid a bill from it</button>
          </div>
          {(state.potLog || []).length > 0 && (
            <details className="muted sm"><summary>History</summary>
              <ul className="list compact">{state.potLog.slice(0, 8).map((l) => <li key={l.id} className="list-row"><span className="grow">{new Date(l.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {l.note}</span><span className={l.amount > 0 ? 'pos' : ''}>{fmt(l.amount, { sign: true })}</span></li>)}</ul>
            </details>
          )}
        </div>
        {(state.goals || []).map((g) => (
          <div key={g.id} className="pot">
            <span className="muted sm">{g.icon || '🎯'} {g.name}</span>
            <span className="pot-amount">{fmt(g.saved || 0, { decimals: 0 })}</span>
            <span className="muted sm">of {fmt(g.target, { decimals: 0 })} · goal pot</span>
          </div>
        ))}
        <button className="pot linkish" onClick={() => go('transactions')}>
          <span className="muted sm">🤝 Owed to you (split bills)</span>
          <span className="pot-amount">{fmt(owed.owedToYou)}</span>
          <span className="muted sm">{owed.open} open{owed.overdue ? ` · ${owed.overdue} overdue` : ''}</span>
        </button>
      </div>
      <p className="muted xs">Pulse can't see inside your bank's pots, so record moves here (or keep the balance in step in Settings). Bank-connected pots show under Bank Sync.</p>
    </div>
  );
}
