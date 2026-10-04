import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from './Modal.jsx';
import { Field } from './Forms.jsx';
import { unclassifiedAccounts, cardDebts, closeOnOrBefore, nextClose, emiSchedule, instalmentFor, isCardDebt } from '../../engine/cards.js';
import { ordinal, todayISO } from '../../engine/dates.js';

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
        <p>Pulse found <b>{a.account}</b> in {SOURCE_LABEL[a.source] || 'your import'}: {a.count} transaction{a.count === 1 ? '' : 's'} from {a.first} to {a.last}.</p>
        <p className="muted"><b>Is this a credit card?</b> If it is, Pulse tracks its purchases, works out each monthly bill from them, lets you turn big purchases into EMI plans, and makes sure paying the bill isn't counted as spending twice.</p>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => setLater((l) => [...l, a.account])}>Ask me later</button>
          <button type="button" className="btn ghost" onClick={() => { dispatch({ type: 'account/classify', payload: { account: a.account, kind: 'bank' } }); notify(`${a.account} saved as a bank account`, 'good'); }}>No, it's a bank account</button>
          <button type="button" className={`btn ${a.likelyCard ? 'primary' : 'ghost'}`} onClick={() => setSetup({ cardAccount: a.account, name: a.account, flipSign: a.looksFlipped, suggestedFlip: a.looksFlipped })}>Yes, it's a credit card</button>
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
    flipSign: false, openBalance: initial?.balanceAsOf?.amount ?? '', openDate: initial?.balanceAsOf?.date || todayISO(), ...initial,
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
  const sampleClose = f.statementDay ? `the ${ordinal(+f.statementDay)}` : 'your statement date';
  // A card you'd added by hand on the Debts page would now be counted twice.
  const words = [f.name, f.match, f.cardAccount].map((x) => String(x || '').toLowerCase().trim()).filter(Boolean);
  const manualTwin = (state.debts || []).find((d) => !d.cardAccount && d.type === 'credit-card' && words.some((w) => [d.name, d.lender, d.match].some((x) => String(x || '').toLowerCase().includes(w) || w.includes(String(x || '').toLowerCase().trim() || '\u0000'))));
  return (
    <form onSubmit={submit} className="form">
      <div className="row2">
        <Field label="Card name"><input required value={f.name} onChange={set('name')} placeholder="e.g. Barclaycard" /></Field>
        <Field label="Account in your imports"><input readOnly value={f.cardAccount} /></Field>
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
      {f.payMode !== 'full' && <Field label="Bill payment on your bank statement" hint="Text on your bank statement when you pay this card, so it's treated as a transfer, not spending."><input value={f.match} onChange={set('match')} placeholder={(f.name || 'barclaycard').toLowerCase()} /></Field>}
      <div className="row2">
        <Field label="Balance owed now (optional)" hint="Makes the balance exact. Leave blank to work it out from your statements."><input type="number" step="0.01" min="0" value={f.openBalance} onChange={set('openBalance')} /></Field>
        <Field label="As of"><input type="date" value={f.openDate} onChange={set('openDate')} /></Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={!!f.flipSign} onChange={set('flipSign')} />
        <span><b>Purchases show as positive numbers in this card's file.</b> Many card exports do this; Pulse flips them so purchases count as spending.{f.suggestedFlip ? ' Pulse spotted this in your file.' : ''}</span>
      </label>
      {manualTwin && (
        <div className="callout warn">
          <p>You also added <b>{manualTwin.name}</b> by hand on the Debts page. Once this card is tracked from its transactions, that entry would count it twice.</p>
          <button type="button" className="btn ghost sm" onClick={() => { dispatch({ type: 'debt/delete', payload: { id: manualTwin.id } }); notify(`Removed the manual ${manualTwin.name} entry`, 'info'); }}>Remove the manual entry</button>
        </div>
      )}
      <p className="muted sm">Each bill covers purchases from the day after one statement up to {sampleClose}, minus refunds, plus any EMI instalments. It's shown on your calendar on its due date and ticked off when the payment appears.</p>
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
  const submit = async (e) => {
    e.preventDefault();
    await dispatch({ type: 'emi/save', payload: { ...f, id: plan?.id, txnId: txn.id } });
    notify(`${f.name}: ${fmt(instalmentFor(+f.principal, +f.apr || 0, n))} a month for ${n} months, now on your Debts page`, 'good');
    onDone();
  };
  return (
    <form onSubmit={submit} className="form">
      <p className="muted">{txn.description} on {txn.date} with {card.name}: <b>{fmt(Math.abs(txn.amount))}</b></p>
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
          <p className="muted sm">Interest {fmt(interest)} · total cost {fmt(rows.reduce((s, r) => s + r.amount, 0))}. The purchase stops counting as one {fmt(+f.principal)} spend; each instalment counts in the month it's billed.</p>
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
