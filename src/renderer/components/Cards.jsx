import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from './Modal.jsx';
import { Field } from './Forms.jsx';
import { unclassifiedAccounts, cardDebts, closeOnOrBefore, nextClose, emiSchedule, instalmentFor, isCardDebt, planOf, planApr } from '../../engine/cards.js';
import { ordinal, todayISO } from '../../engine/dates.js';

// Monzo Flex's options; you pick the one your app is set to.
const FLEX_PLAN = { mode: 'full', freeMonths: 3, apr: 39, maxMonths: 24, minInstalment: 5, options: [3, 6, 12, 24] };
const PLAN_MODES = [
  { id: 'full', title: 'Each purchase in full on the next bill', sub: 'Normal credit cards · Flex "Pay in full"' },
  { id: 'choose', title: 'I choose for every purchase', sub: 'In full or 3, 6, 12 or 24 months · Flex "Choose for every purchase"' },
  { id: 'minimum', title: 'Minimum monthly payment', sub: 'Every purchase over up to 24 months · Flex "Minimum monthly payment"' },
  { id: 'split', title: 'Same split for every purchase', sub: 'e.g. always 3 months' },
];

const SOURCE_LABEL = { csv: 'a statement file', watch: 'your watched folder', bank: 'bank sync', monzo: 'Monzo', truelayer: 'bank sync' };

/**
 * Shown over any page when imported transactions arrive under an account Pulse hasn't seen:
 * is it a bank account or a credit card? Cards get set up straight away.
 */
export function NewAccountPrompt() {
  const { state, dispatch, notify } = useApp();
  const [later, setLater] = useState([]);
  const [setup, setSetup] = useState(null);
  const pending = useMemo(() => unclassifiedAccounts(state).filter((a) => !later.includes(a.account)), [state, later]);
  const a = pending[0];
  if (!a && !setup) return null;

  if (setup) {
    return (
      <Modal title={`Set up ${setup.cardAccount} as a credit card`} onClose={() => setSetup(null)}>
        <CardForm initial={setup} onDone={() => setSetup(null)} />
      </Modal>
    );
  }
  return (
    <Modal title="New account found" onClose={() => setLater((l) => [...l, a.account])}>
      <div className="form">
        <p>New account from {SOURCE_LABEL[a.source] || 'your import'}: <b>{a.account}</b> <span className="muted sm">({a.count} transaction{a.count === 1 ? '' : 's'} so far)</span></p>
        <p><b>Is it a credit card?</b> If yes, Pulse will:</p>
        <ul className="tidy">
          <li>work out each bill from its purchases, once you set its dates</li>
          <li>let you turn big purchases into EMI plans</li>
          <li>not count paying the bill as extra spending</li>
        </ul>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => setLater((l) => [...l, a.account])}>Ask me later</button>
          <button type="button" className="btn ghost" onClick={() => { dispatch({ type: 'account/classify', payload: { account: a.account, kind: 'bank' } }); notify(`${a.account} saved as a bank account`, 'good'); }}>No, it's a bank account</button>
          <button type="button" className={`btn ${a.likelyCard ? 'primary' : 'ghost'}`} onClick={() => setSetup({ cardAccount: a.account, name: a.account, flipSign: a.looksFlipped, suggestedFlip: a.looksFlipped, ...(a.flex ? { plan: { ...FLEX_PLAN }, match: 'monzo flex' } : {}) })}>Yes, it's a credit card</button>
        </div>
      </div>
    </Modal>
  );
}

/** Card details: statement date, due date, how it's paid. Editable any time from Debts or Settings. */
export function CardForm({ initial, onDone }) {
  const { state, dispatch, notify, fmt } = useApp();
  const [f, setF] = useState(() => ({
    name: '', statementDay: '', dueDay: '', payMode: 'full', minPct: 3, minFloor: 25, fixedPayment: '', apr: '', creditLimit: '', match: '',
    flipSign: false, plan: initial?.plan?.mode ? initial.plan : planOf(initial || {}), openBalance: initial?.balanceAsOf?.amount ?? '', openDate: initial?.balanceAsOf?.date || todayISO(), ...initial,
  }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const submit = async (e) => {
    e.preventDefault();
    const { openBalance, openDate, suggestedFlip, nextBill, emi, ...rest } = f;
    await dispatch({
      type: 'card/save',
      payload: { ...rest, match: f.match || f.name, balanceAsOf: openBalance !== '' && openBalance !== null ? { amount: +openBalance, date: openDate } : undefined },
    });
    notify(`${f.name} is set up. Its bills now come from its transactions.`, 'good');
    onDone();
  };
  // A card you'd added by hand on the Debts page would now be counted twice.
  const words = [f.name, f.match, f.cardAccount].map((x) => String(x || '').toLowerCase().trim()).filter(Boolean);
  const manualTwin = (state.debts || []).find((d) => !d.cardAccount && d.type === 'credit-card' && words.some((w) => [d.name, d.lender, d.match].some((x) => String(x || '').toLowerCase().includes(w) || w.includes(String(x || '').toLowerCase().trim() || '\u0000'))));
  return (
    <form onSubmit={submit} className="form">
      <div className="row2">
        <Field label="Card name"><input required value={f.name} onChange={set('name')} placeholder="e.g. Barclaycard" /></Field>
        <Field label="Linked to transactions from" hint="Filled in for you."><input readOnly value={f.cardAccount} /></Field>
      </div>
      <div className="row2">
        <Field label="Statement date (day of month)" hint="When each monthly statement is issued."><input type="number" min="1" max="31" required value={f.statementDay} onChange={set('statementDay')} placeholder="e.g. 28" /></Field>
        <Field label="Payment due (day of month)" hint="When the bill must be paid."><input type="number" min="1" max="31" required value={f.dueDay} onChange={set('dueDay')} placeholder="e.g. 20" /></Field>
      </div>
      <div className="row2">
        <Field label="How you pay each bill">
          <select value={f.payMode} onChange={set('payMode')}>
            <option value="full">The full statement balance</option>
            <option value="minimum">The minimum payment</option>
            <option value="fixed">A fixed amount</option>
          </select>
        </Field>
        {f.payMode === 'fixed' ? (
          <Field label="Fixed amount each month"><input type="number" step="0.01" min="0" required value={f.fixedPayment} onChange={set('fixedPayment')} /></Field>
        ) : f.payMode === 'minimum' ? (
          <div className="row2 tight">
            <Field label="Minimum: % of balance"><input type="number" step="0.1" min="0" value={f.minPct} onChange={set('minPct')} /></Field>
            <Field label="but at least"><input type="number" step="1" min="0" value={f.minFloor} onChange={set('minFloor')} /></Field>
          </div>
        ) : <Field label="Interest rate (APR %)" hint="Charged if you don't pay in full."><input type="number" step="0.01" min="0" value={f.apr} onChange={set('apr')} /></Field>}
      </div>
      <div className="row2">
        {f.payMode !== 'full' && <Field label="Interest rate (APR %)"><input type="number" step="0.01" min="0" value={f.apr} onChange={set('apr')} /></Field>}
        <Field label="Credit limit (optional)"><input type="number" step="1" min="0" value={f.creditLimit} onChange={set('creditLimit')} /></Field>
        {f.payMode === 'full' && <Field label="Bill payment on your bank statement" hint="So paying the card isn't counted as spending."><input value={f.match} onChange={set('match')} placeholder={(f.name || 'barclaycard').toLowerCase()} /></Field>}
      </div>
      {f.payMode !== 'full' && <Field label="Bill payment on your bank statement" hint="So paying the card isn't counted as spending."><input value={f.match} onChange={set('match')} placeholder={(f.name || 'barclaycard').toLowerCase()} /></Field>}
      <div className="row2">
        <Field label="Balance owed now (optional)" hint="Leave blank to use your statements."><input type="number" step="0.01" min="0" value={f.openBalance} onChange={set('openBalance')} /></Field>
        <Field label="As of"><input type="date" value={f.openDate} onChange={set('openDate')} /></Field>
      </div>
      <PlanPicker value={f.plan} onChange={(plan) => setF((x) => ({ ...x, plan }))} />
      <label className="check">
        <input type="checkbox" checked={!!f.flipSign} onChange={set('flipSign')} />
        <span><b>Purchases show as positive numbers</b> in this card's file{f.suggestedFlip ? ' (Pulse spotted this)' : ''}</span>
      </label>
      {manualTwin && (
        <div className="callout warn">
          <p>You also added <b>{manualTwin.name}</b> by hand on Debts. Remove it so it isn't counted twice.</p>
          <button type="button" className="btn ghost sm" onClick={() => { dispatch({ type: 'debt/delete', payload: { id: manualTwin.id } }); notify(`Removed the manual ${manualTwin.name} entry`, 'info'); }}>Remove the manual entry</button>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary">Save card</button>
      </div>
    </form>
  );
}

/** Turn a card purchase into an EMI plan (instalments on each statement), tracked on Debts. */
export function EmiForm({ txn, plan, onDone }) {
  const { state, dispatch, notify, fmt } = useApp();
  const card = cardDebts(state).find((c) => c.cardAccount === txn.account);
  const first = card ? (closeOnOrBefore(card, txn.date) === txn.date ? txn.date : nextClose(card, closeOnOrBefore(card, txn.date))) : txn.date;
  const options = card ? [first, nextClose(card, first), nextClose(card, nextClose(card, first))] : [first];
  const [f, setF] = useState(() => ({
    name: plan?.name || `${txn.description} EMI`,
    principal: plan?.principal ?? Math.abs(txn.amount),
    tenure: plan?.tenure ?? 6,
    apr: plan?.apr ?? 0,
    fee: plan?.fee ?? 0,
    firstClose: plan?.firstClose || first,
  }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const n = Math.max(1, parseInt(f.tenure, 10) || 1);
  const rows = card && +f.principal > 0 ? emiSchedule({ principal: +f.principal, apr: +f.apr || 0, tenure: n, fee: +f.fee || 0, firstClose: f.firstClose }, card) : [];
  const interest = rows.reduce((s, r) => s + r.interest, 0);
  if (!card) return <p className="error">Set up {txn.account} as a credit card first.</p>;
  const payInFull = async () => {
    await dispatch({ type: 'emi/save', payload: { name: `${txn.description} (paid in full)`, principal: Math.abs(txn.amount), tenure: 1, apr: 0, fee: 0, firstClose: first, id: plan?.id, txnId: txn.id } });
    notify(`${txn.description} will be paid in full on the ${first} bill`, 'good');
    onDone();
  };
  const submit = async (e) => {
    e.preventDefault();
    await dispatch({ type: 'emi/save', payload: { ...f, id: plan?.id, txnId: txn.id } });
    notify(`${f.name}: ${fmt(instalmentFor(+f.principal, +f.apr || 0, n))} a month for ${n} months, now on your Debts page`, 'good');
    onDone();
  };
  return (
    <form onSubmit={submit} className="form">
      <p className="muted">{txn.description} on {txn.date} with {card.name}: <b>{fmt(Math.abs(txn.amount))}</b></p>
      {planOf(card).mode !== 'full' && (
        <div className="callout">
          <p className="sm">{card.name}'s options:</p>
          <PlanChips card={card} txn={txn} current={plan} onDone={onDone} />
        </div>
      )}
      <div className="row2">
        <Field label="Plan name"><input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Amount converted to EMI"><input type="number" step="0.01" min="1" max={Math.abs(txn.amount)} required value={f.principal} onChange={set('principal')} /></Field>
      </div>
      <div className="row2">
        <Field label="Months (tenure)"><input type="number" min="1" max="120" required value={f.tenure} onChange={set('tenure')} list="emi-tenures" /></Field>
        <Field label="Interest rate (APR %)" hint="0 for an interest-free plan."><input type="number" step="0.01" min="0" value={f.apr} onChange={set('apr')} /></Field>
      </div>
      <datalist id="emi-tenures">{[3, 6, 9, 12, 18, 24, 36].map((m) => <option key={m} value={m} />)}</datalist>
      <div className="row2">
        <Field label="One-off processing fee"><input type="number" step="0.01" min="0" value={f.fee} onChange={set('fee')} /></Field>
        <Field label="First instalment on the statement of">
          <select value={f.firstClose} onChange={set('firstClose')}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        </Field>
      </div>
      {rows.length > 0 && (
        <div className="callout">
          <p><b>{fmt(rows[Math.min(1, rows.length - 1)].amount)} a month</b> for {n} months{+f.fee > 0 ? ` (first one ${fmt(rows[0].amount)} with the fee)` : ''}. Last instalment on the {rows[rows.length - 1].date} statement.</p>
          <p className="muted sm">Interest {fmt(interest)} · total {fmt(rows.reduce((s, r) => s + r.amount, 0))} · counted as spending one instalment a month</p>
        </div>
      )}
      <div className="form-actions">
        {plan && <button type="button" className="btn ghost danger" onClick={async () => { await dispatch({ type: 'debt/delete', payload: { id: plan.id } }); notify('EMI plan removed. The purchase counts as normal again.', 'info'); onDone(); }}>Remove EMI plan</button>}
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary">{plan ? 'Save plan' : 'Convert to EMI'}</button>
      </div>
    </form>
  );
}

/** Settings: every imported account and whether it's a bank account or a credit card. */
export function AccountsList() {
  const { state, dispatch, notify } = useApp();
  const [edit, setEdit] = useState(null);
  const accounts = useMemo(() => {
    const m = new Map();
    for (const t of state.transactions) if (t.account && !['manual', 'demo'].includes(t.source) && !t.virtual) m.set(t.account, (m.get(t.account) || 0) + 1);
    for (const c of cardDebts(state)) if (!m.has(c.cardAccount)) m.set(c.cardAccount, 0);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.transactions, state.debts]);
  if (!accounts.length) return <p className="muted sm">Accounts appear here once you import statements or connect a bank.</p>;
  const cardFor = (acc) => cardDebts(state).find((c) => c.cardAccount === acc);
  return (
    <>
      <ul className="list">
        {accounts.map(([acc, n]) => {
          const card = cardFor(acc);
          const kind = card ? 'card' : state.accountTypes?.[acc] || '';
          return (
            <li key={acc} className="list-row">
              <span aria-hidden>{card ? '💳' : '🏦'}</span>
              <span className="grow"><b>{acc}</b><small className="muted"> · {n} transactions{card ? ` · statement on the ${ordinal(card.statementDay)}, due the ${ordinal(card.dueDay)}` : ''}</small></span>
              <select aria-label={`Type of ${acc}`} value={kind} onChange={(e) => {
                const v = e.target.value;
                if (v === 'card') setEdit(card || { cardAccount: acc, name: acc });
                else if (card) dispatch({ type: 'debt/delete', payload: { id: card.id } }).then(() => notify(`${acc} is now a bank account`, 'info'));
                else dispatch({ type: 'account/classify', payload: { account: acc, kind: v } });
              }}>
                {!kind && <option value="">Not set</option>}
                <option value="bank">Bank account</option>
                <option value="card">Credit card</option>
              </select>
              {card && <button className="btn ghost sm" onClick={() => setEdit(card)}>Edit card</button>}
            </li>
          );
        })}
      </ul>
      {edit && <Modal title={isCardDebt(edit) ? `Edit ${edit.name}` : `Set up ${edit.cardAccount} as a credit card`} onClose={() => setEdit(null)}><CardForm initial={edit} onDone={() => setEdit(null)} /></Modal>}
    </>
  );
}

/** "How purchases are paid": the same choices as Monzo Flex's default payment option. */
function PlanPicker({ value, onChange }) {
  const p = { ...FLEX_PLAN, months: 3, ...(value || {}) };
  const set = (k) => (e) => onChange({ ...p, [k]: e.target.value });
  return (
    <fieldset className="plan-picker">
      <legend>How purchases are paid</legend>
      {PLAN_MODES.map((m) => (
        <label key={m.id} className={`plan-opt ${p.mode === m.id ? 'on' : ''}`}>
          <input type="radio" name="plan-mode" checked={p.mode === m.id} onChange={() => onChange({ ...p, mode: m.id })} />
          <span><b>{m.title}</b><small className="muted">{m.sub}</small></span>
        </label>
      ))}
      {p.mode === 'split' && (
        <div className="row2">
          <Field label="Months per purchase"><input type="number" min="2" max="36" value={p.months} onChange={set('months')} /></Field>
          <Field label="Interest (APR %)"><input type="number" step="0.01" min="0" value={p.apr} onChange={set('apr')} /></Field>
        </div>
      )}
      {p.mode === 'choose' && (
        <Field label="Plan lengths this card offers (months)" hint="Flex: 3, 6, 12, 24"><input value={Array.isArray(p.options) ? p.options.join(', ') : p.options ?? '3, 6, 12, 24'} onChange={set('options')} /></Field>
      )}
      {(p.mode === 'choose' || p.mode === 'minimum') && (
        <div className="row2">
          <Field label="Interest-free up to (months)" hint="Flex: 3"><input type="number" min="0" max="24" value={p.freeMonths} onChange={set('freeMonths')} /></Field>
          <Field label="Interest on longer plans (APR %)" hint="Your Flex rate"><input type="number" step="0.01" min="0" value={p.apr} onChange={set('apr')} /></Field>
        </div>
      )}
      {p.mode === 'minimum' && (
        <div className="row2">
          <Field label="Longest plan (months)"><input type="number" min="2" max="36" value={p.maxMonths} onChange={set('maxMonths')} /></Field>
          <Field label="Smallest monthly payment" hint="Small purchases get fewer months"><input type="number" step="0.5" min="0" value={p.minInstalment} onChange={set('minInstalment')} /></Field>
        </div>
      )}
    </fieldset>
  );
}

/** Quick plan buttons for a card purchase: in full, or one of the card's plan lengths. */
export function PlanChips({ card, txn, current, onDone }) {
  const { dispatch, notify, fmt } = useApp();
  const pl = planOf(card);
  const first = closeOnOrBefore(card, txn.date) === txn.date ? txn.date : nextClose(card, closeOnOrBefore(card, txn.date));
  const choose = async (months) => {
    const apr = planApr(card, months);
    await dispatch({ type: 'emi/save', payload: { id: current?.id, txnId: txn.id, name: months === 1 ? `${txn.description} (paid in full)` : `${txn.description} · ${months} months`, principal: Math.abs(txn.amount), tenure: months, apr, fee: 0, firstClose: first } });
    notify(months === 1 ? `${txn.description}: in full on the next bill` : `${txn.description}: ${fmt(instalmentFor(Math.abs(txn.amount), apr, months))}/mo for ${months} months${apr ? ` at ${apr}%` : ', interest-free'}`, 'good');
    onDone?.();
  };
  return (
    <div className="inline-row wrap plan-chips">
      <button type="button" className={`btn sm ${current?.tenure === 1 ? 'primary' : 'ghost'}`} onClick={() => choose(1)}>In full</button>
      {pl.options.map((m) => (
        <button key={m} type="button" className={`btn sm ${current?.tenure === m ? 'primary' : 'ghost'}`} onClick={() => choose(m)} title={planApr(card, m) ? `${planApr(card, m)}% APR` : 'Interest-free'}>
          {m} mo{planApr(card, m) ? '' : ' · 0%'}
        </button>
      ))}
    </div>
  );
}
