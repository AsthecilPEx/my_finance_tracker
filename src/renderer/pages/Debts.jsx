import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from '../components/Modal.jsx';
import { DebtForm } from '../components/Forms.jsx';
import { DEBT_TYPES, simulatePayoff, monthlyInterest } from '../../engine/debt.js';
import { addMonths, ordinal, parseISO } from '../../engine/dates.js';
import { financialView } from '../../engine/view.js';
import { formatMoney } from '../../engine/money.js';
import { debtPayment } from '../../engine/summary.js';
import { isCardDebt, isCardEmi, statementFor, closeOnOrBefore, nextClose } from '../../engine/cards.js';
import { CardForm, EmiForm } from '../components/Cards.jsx';

function payoffDate(today, months) {
  if (!isFinite(months)) return 'Never at this rate';
  return parseISO(addMonths(today, months)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export default function Debts() {
  const { state, dispatch, fmt, today } = useApp();
  const [edit, setEdit] = useState(null);
  const [extra, setExtra] = useState(state.settings.debtPlan?.extra ?? 100);
  const chosen = state.settings.debtPlan?.strategy || 'avalanche';
  const [editCard, setEditCard] = useState(null);
  const [editEmi, setEditEmi] = useState(null);
  const view = financialView(state); // foreign-currency debts converted at today's rate
  const owed = view.debts.filter((d) => d.balance > 0);
  const total = owed.reduce((s, d) => s + d.balance, 0);
  // EMI instalments are part of their card's bill, so they aren't added again.
  const minTotal = owed.filter((d) => !isCardEmi(d)).reduce((s, d) => s + (d.minPayment || 0), 0);
  // The payoff plan covers balances that carry interest: not cards you clear in full each month.
  const debts = owed.filter((d) => !(isCardDebt(d) && (d.payMode || 'full') === 'full') && !(isCardEmi(d) && d.tenure === 1));
  const tracked = view.debts.filter(isCardDebt);
  const manual = view.debts.filter((d) => !isCardDebt(d) && !isCardEmi(d));
  const plans = useMemo(() => ({
    minimum: simulatePayoff(debts, { extra: 0 }),
    avalanche: simulatePayoff(debts, { extra, strategy: 'avalanche' }),
    snowball: simulatePayoff(debts, { extra, strategy: 'snowball' }),
  }), [debts, extra]);
  const order = (strategy) => [...debts].sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr));

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Debts & Loans</h1><p className="muted">Everything you owe, and the fastest way to clear it.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>+ Add debt</button>
      </header>

      <div className="kpis">
        <div className="kpi"><span>Total owed</span><b>{fmt(total, { decimals: 0 })}</b></div>
        <div className="kpi"><span>Monthly payments</span><b>{fmt(minTotal, { decimals: 0 })}</b></div>
        <div className="kpi"><span>Interest this month</span><b className="neg">{fmt(monthlyInterest(debts))}</b></div>
        <div className="kpi"><span>Debt-free (minimums only)</span><b>{payoffDate(today, plans.minimum.months)}</b></div>
      </div>

      {tracked.length > 0 && (
        <>
          <h2 className="section-title">💳 Credit cards (from their transactions)</h2>
          <div className="debt-grid">
            {tracked.map((c) => {
              const raw = state.debts.find((x) => x.id === c.id);
              const openClose = nextClose(c, closeOnOrBefore(c, today));
              const soFar = statementFor(state, c, openClose);
              const emis = view.debts.filter((d) => isCardEmi(d) && d.tenure > 1 && d.viaCard === c.id && !d.emi?.done);
              const used = c.creditLimit > 0 ? Math.min(1, c.balance / c.creditLimit) : null;
              return (
                <div key={c.id} className="card debt">
                  <div className="card-head">
                    <div><h3>{c.name}</h3><span className="muted sm">Statement on the {ordinal(c.statementDay)} · due the {ordinal(c.dueDay)} · {c.payMode === 'minimum' ? 'pays the minimum' : c.payMode === 'fixed' ? `pays ${fmt(c.fixedPayment)}` : 'paid in full'}</span></div>
                    <div className="row-actions"><button className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => setEditCard(raw)}>✎</button></div>
                  </div>
                  <div className="debt-bal">{fmt(c.balance, { decimals: 0 })}<small className="muted"> owed</small></div>
                  {used !== null && <div className="progress" aria-label={`${Math.round(used * 100)}% of limit used`}><span style={{ width: `${used * 100}%` }} /></div>}
                  <div className="debt-meta">
                    {used !== null && <span>{Math.round(used * 100)}% of {fmt(c.creditLimit, { decimals: 0 })} limit</span>}
                    {c.apr > 0 && <span className={c.apr >= 15 ? 'neg' : ''}>{c.apr}% APR</span>}
                  </div>
                  {c.nextBill && <CardBill card={c} bill={c.nextBill} soFar={soFar} openClose={openClose} />}
                  {emis.length > 0 && <div className="muted sm">EMI plans on this card: {emis.map((e) => e.name).join(', ')}</div>}
                </div>
              );
            })}
            {view.debts.filter((d) => isCardEmi(d) && d.tenure > 1).map((e) => {
              const st = e.emi;
              const card = view.debts.find((d) => d.id === e.viaCard);
              const txn = state.transactions.find((t) => t.id === e.txnId);
              const raw = state.debts.find((x) => x.id === e.id);
              return (
                <div key={e.id} className={`card debt ${st.done ? 'inactive' : ''}`}>
                  <div className="card-head">
                    <div><h3>{e.name}</h3><span className="muted sm">EMI on {card?.name} · {st.tenure} months{e.apr ? ` at ${e.apr}%` : ' · interest-free'}</span></div>
                    <div className="row-actions">{txn && <button className="icon-btn" aria-label={`Edit ${e.name}`} onClick={() => setEditEmi({ txn, plan: raw })}>✎</button>}</div>
                  </div>
                  <div className="debt-bal">{fmt(st.remaining, { decimals: 0 })}<small className="muted"> left</small></div>
                  <div className="progress" aria-label={`${st.billed} of ${st.tenure} instalments`}><span style={{ width: `${(st.billed / st.tenure) * 100}%` }} /></div>
                  <div className="debt-meta">
                    <span>{st.billed} of {st.tenure} paid</span>
                    <span>{fmt(st.instalment)}/mo on the card bill</span>
                    {st.totalInterest > 0 && <span className="neg">{fmt(st.totalInterest)} interest</span>}
                  </div>
                  <div className="muted sm">{st.done ? 'Finished' : st.next ? `Next instalment on the ${st.next.date} statement` : ''}</div>
                </div>
              );
            })}
          </div>
          <h2 className="section-title">Loans & other debts</h2>
        </>
      )}

      {manual.length === 0 ? (
        <div className="card"><p className="empty">{tracked.length ? 'No loans added. Add loans, car finance, BNPL or money owed to friends to plan a payoff.' : 'No debts added. Add credit cards, loans, car finance, BNPL or money owed to friends to plan a payoff.'}</p></div>
      ) : (
        <div className="debt-grid">
          {manual.map((d) => {
            const paid = d.originalBalance > 0 ? Math.min(1, 1 - d.balance / d.originalBalance) : 0;
            return (
              <div key={d.id} className="card debt">
                <div className="card-head">
                  <div><h3>{d.name}</h3><span className="muted sm">{DEBT_TYPES[d.type] || d.type}{d.dueDay ? ` · due on the ${ordinal(d.dueDay)}` : ''}{d.statementDay ? ` · statement on the ${ordinal(d.statementDay)}` : ''}{d.payMode === 'full' ? ' · paid in full' : d.payMode === 'fixed' ? ' · fixed payment' : ''}</span></div>
                  <div className="row-actions">
                    <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(state.debts.find((x) => x.id === d.id))}>✎</button>
                    <button className="icon-btn danger" aria-label="Delete" onClick={() => dispatch({ type: 'debt/delete', payload: { id: d.id } })}>🗑</button>
                  </div>
                </div>
                <div className="debt-bal">{d.native ? formatMoney(d.native.balance, d.native.currency, { decimals: 0 }) : fmt(d.balance, { decimals: 0 })}</div>
                {d.native && <div className="muted sm">≈ {fmt(d.balance, { decimals: 0 })} at today's rate · EMI {formatMoney(d.native.minPayment, d.native.currency)} ≈ {fmt(d.minPayment)}</div>}
                <div className="progress" aria-label={`${Math.round(paid * 100)}% paid off`}><span style={{ width: `${paid * 100}%` }} /></div>
                <div className="debt-meta">
                  <span>{Math.round(paid * 100)}% paid off</span>
                  <span className={d.apr >= 15 ? 'neg' : ''}>{d.apr || 0}% APR</span>
                  <span>{d.payMode === 'full' ? <>≈ {fmt(debtPayment(d, view.transactions)?.amount || 0)}</> : d.payMode === 'fixed' ? fmt(d.fixedPayment || 0) : d.native ? formatMoney(d.native.minPayment, d.native.currency) : fmt(d.minPayment || 0)}/mo</span>
                </div>
                <div className="muted sm">Cleared {payoffDate(today, plans.avalanche.payoffMonth[d.id] ?? Infinity)} on the plan below</div>
              </div>
            );
          })}
        </div>
      )}

      {debts.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Payoff plan</h3></div>
          <label className="slider">
            <span>Extra per month on top of minimums: <b>{fmt(extra, { decimals: 0 })}</b></span>
            <input type="range" min="0" max="1000" step="10" value={extra} onChange={(e) => setExtra(+e.target.value)} />
          </label>
          <div className="plans">
            {[
              { key: 'avalanche', name: 'Avalanche', desc: 'Highest interest first. Pays the least interest overall.' },
              { key: 'snowball', name: 'Snowball', desc: 'Smallest balance first. Clears debts sooner for quick wins.' },
            ].map((p) => {
              const r = plans[p.key];
              const best = plans.avalanche.totalInterest <= plans.snowball.totalInterest ? 'avalanche' : 'snowball';
              return (
                <div key={p.key} className={`plan ${best === p.key ? 'best' : ''}`}>
                  <div className="plan-head"><h4>{p.name}</h4><span>{best === p.key && <span className="badge done">✓ Cheapest</span>} {chosen === p.key ? <span className="badge must">Your plan</span> : <button className="btn ghost sm" onClick={() => dispatch({ type: 'settings/update', payload: { debtPlan: { strategy: p.key, extra } } })}>Use this</button>}</span></div>
                  <p className="muted sm">{p.desc}</p>
                  <div className="plan-stats">
                    <div><span>Debt-free</span><b>{payoffDate(today, r.months)}</b></div>
                    <div><span>Total interest</span><b>{fmt(r.totalInterest, { decimals: 0 })}</b></div>
                    <div><span>Saved vs minimums</span><b className="pos">{fmt(Math.max(0, plans.minimum.totalInterest - r.totalInterest), { decimals: 0 })}</b></div>
                  </div>
                  <ol className="order">{order(p.key).map((d) => <li key={d.id}>{d.name} <span className="muted">· {fmt(d.balance, { decimals: 0 })} at {d.apr || 0}%</span></li>)}</ol>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : 'Add debt'} onClose={() => setEdit(null)}><DebtForm initial={edit.id ? edit : null} onDone={() => setEdit(null)} /></Modal>}
      {editCard && <Modal title={`Edit ${editCard.name}`} onClose={() => setEditCard(null)}><CardForm initial={editCard} onDone={() => setEditCard(null)} />
        <div className="form-actions"><button className="btn ghost danger" onClick={async () => { await dispatch({ type: 'debt/delete', payload: { id: editCard.id } }); setEditCard(null); }}>Stop tracking as a credit card</button></div></Modal>}
      {editEmi && <Modal title="EMI plan" onClose={() => setEditEmi(null)}><EmiForm txn={editEmi.txn} plan={editEmi.plan} onDone={() => setEditEmi(null)} /></Modal>}
    </div>
  );
}

/** The next bill on a tracked card: amount, what it's made of, and a way to correct it. */
function CardBill({ card, bill, soFar, openClose }) {
  const { fmt, dispatch, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState(false);
  const [amount, setAmount] = useState('');
  const key = `${card.id}:${bill.due}`;
  const save = (e) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!(n >= 0)) return;
    dispatch({ type: 'occ/override', payload: { key, amount: n } });
    notify(`${card.name} bill set to ${fmt(n)}, due ${bill.due}`, 'good');
    setFix(false);
    setAmount('');
  };
  return (
    <>
      <div className="card-bill">
        <div>
          <span className="muted sm">Next bill{bill.entered ? ' (you entered it)' : ''}</span>
          <b>{bill.estimated ? '≈ ' : ''}{fmt(bill.payment)}</b>
          <small className="muted">due {bill.due}{bill.estimated ? ' · estimate until the statement is in' : ` · statement ${bill.start} to ${bill.close}`}</small>
        </div>
        <div>
          <span className="muted sm">This cycle so far</span>
          <b>{fmt(soFar.purchases + soFar.spread - soFar.refunds)}</b>
          <small className="muted">closes {openClose}{soFar.emi ? ` · + ${fmt(soFar.emi)} EMI` : ''}</small>
        </div>
      </div>
      {bill.historyGap && !bill.entered && (
        <p className="callout warn sm">History starts {bill.historyFrom}, so this bill may miss older purchases. Enter the real amount if it differs.</p>
      )}
      <div className="inline-row wrap">
        <button className="linkish sm" onClick={() => setOpen((x) => !x)}>{open ? '▾' : '▸'} What's in this bill</button>
        {bill.entered
          ? <button className="linkish sm" onClick={() => { dispatch({ type: 'occ/reset', payload: { key } }); notify(`Back to the calculated ${fmt(bill.calculated)}`, 'info'); }}>Use Pulse's figure ({fmt(bill.calculated)}) instead</button>
          : <button className="linkish sm" onClick={() => setFix((x) => !x)}>Bill amount is different?</button>}
      </div>
      {fix && (
        <form className="inline-row" onSubmit={save}>
          <input type="number" step="0.01" min="0" inputMode="decimal" className="amount-sm" placeholder={bill.payment.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Real bill amount" autoFocus />
          <button className="btn primary sm" disabled={amount === ''}>Save</button>
          <span className="muted sm">from your card's app or statement</span>
        </form>
      )}
      {open && (
        <ul className="list compact bill-lines">
          {bill.lines.length === 0 && <li className="muted sm">No card transactions in this bill.</li>}
          {bill.lines.map((l, i) => (
            <li key={i} className="list-row">
              <span className="muted nowrap">{l.date}</span>
              <span className="grow">{l.description}{l.kind === 'instalment' && <small className="muted"> · part {l.k} of {l.n} of a {fmt(l.original)} purchase</small>}{l.kind === 'emi' && <small className="muted"> · EMI {l.k} of {l.n}</small>}{l.kind === 'refund' && <small className="muted"> · refund</small>}</span>
              <b className={l.amount < 0 ? 'pos' : ''}>{fmt(l.amount)}</b>
            </li>
          ))}
          <li className="list-row"><span className="grow"><b>Total</b></span><b>{fmt(bill.calculated)}</b></li>
        </ul>
      )}
    </>
  );
}
