import { useState } from 'react';
import { useApp } from '../store.jsx';
import { createDemoState } from '../../engine/demo.js';
import { Field } from '../components/Forms.jsx';

export default function Onboarding() {
  const { dispatch, today } = useApp();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: '', currency: 'GBP', salary: '', payRule: 'day', payDay: 25, nextPay: today, rent: '', rentDay: 1 });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const demo = async () => {
    const s = createDemoState(today);
    await dispatch({ type: 'data/replace', payload: { ...s, settings: { ...s.settings, currency: f.currency } } });
  };

  const finish = async () => {
    await dispatch({ type: 'settings/update', payload: { name: f.name, currency: f.currency } });
    if (parseFloat(f.salary) > 0) {
      await dispatch({
        type: 'recurring/save',
        payload: {
          name: 'Salary', match: 'salary', amount: parseFloat(f.salary), direction: 'in', kind: 'salary', categoryId: 'salary',
          frequency: f.payRule === 'last' ? 'last-working-day' : f.payRule === 'four-weekly' ? 'four-weekly' : 'monthly',
          dayOfMonth: parseInt(f.payDay, 10) || 25, startDate: f.payRule === 'four-weekly' ? f.nextPay : `${today.slice(0, 8)}01`, adjust: 'previous-working',
        },
      });
    }
    if (parseFloat(f.rent) > 0) {
      await dispatch({
        type: 'recurring/save',
        payload: { name: 'Rent / Mortgage', match: 'rent', amount: parseFloat(f.rent), direction: 'out', kind: 'bill', categoryId: 'housing', frequency: 'monthly', dayOfMonth: parseInt(f.rentDay, 10) || 1, startDate: `${today.slice(0, 8)}01`, adjust: 'none', compulsory: true },
      });
    }
    await dispatch({ type: 'settings/update', payload: { onboarded: true } });
  };

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="brand big"><span className="brand-dot" />Pulse Finance</div>
        {step === 0 && (
          <>
            <h1>See where every pound goes.</h1>
            <p className="muted">Category meters, a payday calendar, bill tracking, debt payoff plans and smart tips on where to cut back. Everything stays on this computer.</p>
            <Field label="Currency">
              <select value={f.currency} onChange={set('currency')}>
                <option value="GBP">£ British pound (GBP)</option>
                <option value="EUR">€ Euro (EUR)</option>
              </select>
            </Field>
            <div className="onboard-actions">
              <button className="btn ghost" onClick={demo}>Explore with demo data</button>
              <button className="btn primary" onClick={() => setStep(1)}>Set up my finances →</button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Your pay</h2>
            <p className="muted">Used to plot paydays on your calendar and work out what's left to spend.</p>
            <Field label="Your first name (optional)"><input value={f.name} onChange={set('name')} /></Field>
            <Field label="Take-home pay (after tax)"><input type="number" min="0" step="0.01" value={f.salary} onChange={set('salary')} placeholder="e.g. 2400" /></Field>
            <div className="row2">
              <Field label="When are you paid?">
                <select value={f.payRule} onChange={set('payRule')}>
                  <option value="day">Same date each month</option>
                  <option value="last">Last working day of the month</option>
                  <option value="four-weekly">Every 4 weeks</option>
                </select>
              </Field>
              {f.payRule === 'day' && <Field label="Pay date" hint="Moved to the Friday before if it falls on a weekend or bank holiday"><input type="number" min="1" max="31" value={f.payDay} onChange={set('payDay')} /></Field>}
              {f.payRule === 'four-weekly' && <Field label="Next payday"><input type="date" value={f.nextPay} onChange={set('nextPay')} /></Field>}
            </div>
            <div className="onboard-actions">
              <button className="btn ghost" onClick={() => setStep(0)}>← Back</button>
              <button className="btn primary" onClick={() => setStep(2)}>Next →</button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Your biggest bill</h2>
            <p className="muted">Add rent or mortgage now. You can add other bills, subscriptions and debts later, or import a bank statement and let the app find them.</p>
            <div className="row2">
              <Field label="Rent / mortgage per month"><input type="number" min="0" step="0.01" value={f.rent} onChange={set('rent')} /></Field>
              <Field label="Paid on day"><input type="number" min="1" max="31" value={f.rentDay} onChange={set('rentDay')} /></Field>
            </div>
            <div className="onboard-actions">
              <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn primary" onClick={finish}>Finish</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
