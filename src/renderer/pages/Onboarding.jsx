import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { createDemoState } from '../../engine/demo.js';
import { newIncome, profileSummary, describeSchedule } from '../../engine/income.js';
import { payPlan } from '../../engine/planner.js';
import { newId } from '../../engine/state.js';
import { Field } from '../components/Forms.jsx';
import IncomeEditor from '../components/IncomeEditor.jsx';

const BILL_PRESETS = [
  { key: 'rent', name: 'Rent / mortgage', icon: '🏠', categoryId: 'housing', day: 1, compulsory: true, match: 'rent' },
  { key: 'council', name: 'Council tax', icon: '🏛️', categoryId: 'utilities', day: 1, compulsory: true, match: 'council tax' },
  { key: 'energy', name: 'Gas & electricity', icon: '⚡', categoryId: 'utilities', day: 5, compulsory: true, match: 'energy' },
  { key: 'water', name: 'Water', icon: '💧', categoryId: 'utilities', day: 12, compulsory: true, match: 'water' },
  { key: 'phone', name: 'Mobile phone', icon: '📱', categoryId: 'utilities', day: 18, compulsory: true, match: 'mobile' },
  { key: 'broadband', name: 'Broadband', icon: '🌐', categoryId: 'utilities', day: 20, compulsory: true, match: 'broadband' },
  { key: 'tv', name: 'TV licence', icon: '📺', categoryId: 'utilities', day: 1, compulsory: true, match: 'tv licen' },
  { key: 'insurance', name: 'Insurance', icon: '🛡️', categoryId: 'insurance', day: 10, compulsory: true, match: 'insurance' },
  { key: 'gym', name: 'Gym', icon: '💪', categoryId: 'health', day: 3, compulsory: false, match: 'gym', kind: 'subscription' },
  { key: 'streaming', name: 'Streaming (Netflix, Spotify…)', icon: '🎬', categoryId: 'subscriptions', day: 8, compulsory: false, match: 'netflix', kind: 'subscription' },
];

const STEPS = ['You', 'Pay', 'Bills', 'Safety net', 'Ready'];

export default function Onboarding() {
  const { state, dispatch, today, fmt } = useApp();
  const [step, setStep] = useState(0);
  // Re-running the wizard starts from what's already saved, so nothing is duplicated.
  const [me, setMe] = useState({ name: state.profile?.name || '', currency: state.settings.currency || 'GBP', region: state.profile?.region || 'ruk' });
  const [incomes, setIncomes] = useState(state.profile?.incomes?.length ? state.profile.incomes : [newIncome()]);
  const existingBills = new Set((state.recurring || []).map((r) => r.name.toLowerCase()));
  const [tab, setTab] = useState(0);
  const [bills, setBills] = useState({});
  const [pot, setPot] = useState(true);
  const [goal, setGoal] = useState({ name: 'Emergency fund', target: '', perMonth: '' });

  const draftState = useMemo(() => {
    const recurring = Object.entries(bills).filter(([, b]) => b.on && +b.amount > 0).map(([k, b]) => {
      const p = BILL_PRESETS.find((x) => x.key === k);
      return { id: k, name: p.name, match: p.match, amount: +b.amount, direction: 'out', kind: p.kind || 'bill', categoryId: p.categoryId, frequency: 'monthly', dayOfMonth: +b.day || p.day, startDate: `${today.slice(0, 8)}01`, adjust: 'none', compulsory: p.compulsory, active: true };
    });
    const goals = +goal.target > 0 ? [{ id: 'g', name: goal.name || 'Savings', icon: '🛟', target: +goal.target, saved: 0, perMonth: +goal.perMonth || 0, active: true }] : [];
    return { profile: { ...me, incomes }, recurring, debts: [], goals, transactions: [], settings: { billPot: { enabled: pot } } };
  }, [bills, incomes, me, pot, goal, today]);
  const prof = profileSummary(draftState);
  const plan = useMemo(() => (step === 4 ? payPlan(draftState, today, 4) : null), [draftState, step, today]);
  const billsMonthly = draftState.recurring.reduce((s, r) => s + r.amount, 0);

  const demo = async () => {
    const s = createDemoState(today);
    await dispatch({ type: 'data/replace', payload: { ...s, settings: { ...s.settings, currency: me.currency } } });
  };

  const finish = async () => {
    await dispatch({ type: 'settings/update', payload: { currency: me.currency, billPot: { enabled: pot, balance: 0 } } });
    await dispatch({ type: 'profile/update', payload: { name: me.name.trim(), region: me.region } });
    for (const inc of incomes) await dispatch({ type: 'income/save', payload: inc });
    for (const r of draftState.recurring) if (!existingBills.has(r.name.toLowerCase())) await dispatch({ type: 'recurring/save', payload: { ...r, id: newId() } });
    for (const g of draftState.goals) await dispatch({ type: 'goal/save', payload: { ...g, id: newId() } });
    await dispatch({ type: 'settings/update', payload: { onboarded: true } });
  };

  const hi = me.name.trim() ? `, ${me.name.trim()}` : '';
  const inc = incomes[tab];

  return (
    <div className="onboard">
      <div className={`onboard-card ${step === 1 ? 'wide' : ''}`}>
        <div className="onboard-top">
          <div className="brand big"><span className="brand-dot" />Pulse Finance</div>
          <ol className="stepper">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i < step ? '✓' : i + 1}<span>{s}</span></li>)}</ol>
        </div>

        {step === 0 && (
          <>
            <h1>Hello! Let's make money feel simple.</h1>
            <p className="muted">A plan built around <b>your</b> paydays. Takes about two minutes.</p>
            <Field label="What should we call you?"><input autoFocus value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} placeholder="Your first name" /></Field>
            <div className="row2">
              <Field label="Where do you pay tax?">
                <select value={me.region} onChange={(e) => setMe({ ...me, region: e.target.value })}>
                  <option value="ruk">England, Wales or NI</option>
                  <option value="scotland">Scotland</option>
                </select>
              </Field>
              <Field label="Currency">
                <select value={me.currency} onChange={(e) => setMe({ ...me, currency: e.target.value })}>
                  <option value="GBP">£ Pound sterling</option>
                  <option value="EUR">€ Euro</option>
                </select>
              </Field>
            </div>
            <p className="privacy-note">🔒 <b>Private by design.</b> No account, no cloud: your data stays on this computer.</p>
            <div className="onboard-actions">
              <button className="btn ghost" onClick={demo}>Just explore with demo data</button>
              <button className="btn primary" onClick={() => setStep(1)}>Let's go →</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>How do you get paid{hi}?</h2>
            <p className="muted">Add every income: jobs, shifts, benefits, freelance. Each gets its own paydays on your calendar.</p>
            <div className="tabs">
              {incomes.map((x, i) => <button key={x.id} className={`tab ${i === tab ? 'on' : ''}`} onClick={() => setTab(i)}>{x.name || `Income ${i + 1}`}</button>)}
              <button className="tab add" onClick={() => { setIncomes([...incomes, newIncome({ name: `Income ${incomes.length + 1}`, pensionPct: 0, taxCode: 'BR' })]); setTab(incomes.length); }}>+ Add another income</button>
            </div>
            <IncomeEditor value={inc} region={me.region} onChange={(v) => setIncomes(incomes.map((x, i) => (i === tab ? v : x)))} />
            {incomes.length > 1 && <button className="btn ghost sm danger" onClick={() => { setIncomes(incomes.filter((_, i) => i !== tab)); setTab(0); }}>Remove this income</button>}
            <div className="onboard-actions">
              <button className="btn ghost" onClick={() => setStep(0)}>← Back</button>
              <span className="muted">≈ {fmt(prof.monthly, { decimals: 0 })} a month take-home</span>
              <button className="btn primary" onClick={() => setStep(2)}>Next →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Your regular bills</h2>
            <p className="muted">Tick what you pay and roughly how much. Skip anything you're unsure of.</p>
            <div className="preset-list">
              {BILL_PRESETS.map((p) => {
                const b = bills[p.key] || { on: false, amount: '', day: p.day };
                const upd = (patch) => setBills({ ...bills, [p.key]: { ...b, ...patch } });
                return (
                  <div key={p.key} className={`preset ${b.on ? 'on' : ''}`}>
                    <label className="check inline"><input type="checkbox" checked={b.on} onChange={(e) => upd({ on: e.target.checked })} /><span>{p.icon} {p.name}</span></label>
                    {b.on && (
                      <>
                        <input type="number" min="0" step="0.01" placeholder="£ / month" value={b.amount} onChange={(e) => upd({ amount: e.target.value })} autoFocus />
                        <span className="muted sm">on day</span>
                        <input type="number" min="1" max="31" value={b.day} onChange={(e) => upd({ day: e.target.value })} className="day-input" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="onboard-actions">
              <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
              <span className="muted">{fmt(billsMonthly, { decimals: 0 })} a month in bills</span>
              <button className="btn primary" onClick={() => setStep(3)}>Next →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Build a safety net</h2>
            <label className={`option-card ${pot ? 'on' : ''}`}>
              <input type="checkbox" checked={pot} onChange={(e) => setPot(e.target.checked)} />
              <div>
                <b>🪣 Use a bills pot</b>
                <p className="muted">Each payday, Pulse tells you how much to set aside for bills.</p>
              </div>
            </label>
            <div className="card inset">
              <b>🎯 A first savings goal (optional)</b>
              <div className="row3">
                <Field label="Goal"><input value={goal.name} onChange={(e) => setGoal({ ...goal, name: e.target.value })} /></Field>
                <Field label="Target"><input type="number" min="0" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} placeholder="e.g. 1000" /></Field>
                <Field label="Save per month"><input type="number" min="0" value={goal.perMonth} onChange={(e) => setGoal({ ...goal, perMonth: e.target.value })} placeholder="e.g. 50" /></Field>
              </div>
            </div>
            <div className="onboard-actions">
              <button className="btn ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn primary" onClick={() => setStep(4)}>Next →</button>
            </div>
          </>
        )}

        {step === 4 && plan && (
          <>
            <h1>You're all set{hi}! 🎉</h1>
            <div className="ready-grid">
              <div className="ready"><span>Take-home</span><b className="pos">{fmt(prof.monthly, { decimals: 0 })}</b><small>a month</small></div>
              <div className="ready"><span>Bills</span><b>{fmt(plan.commitmentsMonthly, { decimals: 0 })}</b><small>a month</small></div>
              {plan.goalsMonthly > 0 && <div className="ready"><span>Goals</span><b>{fmt(plan.goalsMonthly, { decimals: 0 })}</b><small>a month</small></div>}
              <div className="ready"><span>Steady spending</span><b>{fmt(plan.allowancePerDay, { decimals: 0 })}</b><small>a day</small></div>
            </div>
            <ul className="list compact">
              {prof.sources.map((s) => <li key={s.inc.id} className="list-row"><span className="grow">💼 {s.inc.name} · <span className="muted">{describeSchedule(s.inc.schedule)}</span></span><b>{fmt(s.plannedPerPay)}</b></li>)}
            </ul>
            {pot && plan.billsShare > 0 && <p className="muted">🪣 Move <b>{Math.round(plan.billsShare * 100)}%</b> of each payday to your bills pot{plan.startingBuffer > 0 ? <>, starting with about <b>{fmt(plan.startingBuffer, { decimals: 0 })}</b></> : ''}.</p>}
            {prof.monthly > 0 && plan.commitmentsMonthly + plan.goalsMonthly > prof.monthly && <p className="error">⚠ Your bills and goals are more than your take-home. The Pay Planner and Insights pages will help you find room.</p>}
            <div className="onboard-actions">
              <button className="btn ghost" onClick={() => setStep(3)}>← Back</button>
              <button className="btn primary" onClick={finish}>Open my dashboard →</button>
            </div>
            <p className="muted xs">You can change any of this later in Settings → Profile & Pay.</p>
          </>
        )}
      </div>
    </div>
  );
}
