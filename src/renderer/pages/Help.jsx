import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { APP_VERSION, DOWNLOAD_URL } from '../../config.js';

const CHANGES = [
  { v: '0.4', items: ['Edit any single payday or bill from the calendar (amount, hours worked, date, skip)', 'Automatic updates', 'Help & feedback', 'Friendlier error screen', 'Fix: text boxes not accepting typing on Windows'] },
  { v: '0.3', items: ['Split bills with repayment linking', 'Any currency with live exchange rates', '"Needs your attention" dashboard panel', 'Pots, clearer Pay Planner, right-click menus', 'Security hardening'] },
  { v: '0.2', items: ['Pay profiles with UK take-home pay', 'Pay Planner for irregular pay', 'Receipts with offline photo reading', 'Spend caps and AI plans'] },
  { v: '0.1', items: ['Dashboard, calendar, bills, debts, insights and desktop widget'] },
];

const FAQ = [
  ['Windows says "Windows protected your PC". Is it safe?', 'Yes. Pulse isn\'t signed with a paid Microsoft certificate yet, so Windows warns about any new app from a small developer. Click "More info" → "Run anyway". You only see this once.'],
  ['Where is my data? Can anyone else see it?', 'Everything is stored only on this computer, in %APPDATA%\\Pulse Finance. There is no account and no server, so nobody (including the person who shared the app) can see your finances. A backup is kept automatically every day for 14 days.'],
  ['What does Pulse connect to on the internet?', 'Only three things: daily exchange rates, update checks from GitHub, and your bank if you choose to connect it (read-only). Nothing about your finances is ever uploaded.'],
  ['How do I get my transactions in?', 'All options are read-only. Monzo (current, joint and Flex) can sync live using Monzo\'s own free developer access. For Lloyds, HSBC, Barclays, Revolut and other UK banks, download a statement CSV: point the watched folder at your Downloads and Pulse imports it automatically, recognising each bank\'s format. You can also add transactions by hand.'],
  ['Why can\'t Lloyds, HSBC, Barclays or Revolut sync live?', 'UK banks only share live data with regulated companies under a business contract. The free personal options (like Enable Banking\'s restricted mode) cover EU banks only. Statements are the reliable free route, and Pulse reminds you when one is due.'],
  ['Do I need my own Monzo developer client?', 'Yes. Each person creates their own at developers.monzo.com and approves it in their own Monzo app. That keeps your bank data private to you. Monzo asks you to re-approve every 90 days; Pulse reminds you a week before.'],
  ['How does Pulse handle my credit card?', 'When a card\'s transactions come in (statement file or bank sync), Pulse asks if the account is a credit card. Give its statement date, due date and how you pay it, and Pulse works out each bill from the card\'s purchases, refunds and EMI instalments. Purchases count as spending when you make them; paying the bill from your bank is a transfer, so nothing is counted twice. Change it any time in Settings → Your accounts.'],
  ['My Monzo Flex (or card) bill in Pulse doesn\'t match the app', 'On the Debts page open the card and click "What\'s in this bill" to see every line. Common fixes: set the right statement day (Flex: the day before your bills cut off) and due day; under "How purchases are paid" pick the same option as your Flex app (Pay in full, Choose for every purchase, or Minimum monthly payment); change any single purchase from Transactions to match the app. If Pulse says its history starts too late, reconnect Monzo and approve within 5 minutes to bring in older purchases, or just type the real bill amount under "Bill amount is different?".'],
  ['How do I turn a big card purchase into EMI?', 'Open Transactions, find the purchase (filter by the card) and click Convert to EMI. Enter the months, interest rate, any fee and the first statement. The purchase comes out of that month\'s bill, an instalment is added to each statement, and the plan appears on Debts & Loans so you can track what\'s left.'],
  ['What does "amount varies" mean on a bill?', 'For bills that change each time (energy, water, phone usage, a credit card paid in full), Pulse plans with the average of your last 3 payments, ticks the bill off whatever the real amount is, and asks you for the real amount when it is due.'],
  ['How do updates work?', 'Pulse checks for a new version in the background. When one is downloaded you\'ll see "Restart to update". Your data isn\'t touched. (The portable version doesn\'t update itself. Use the installer for that.)'],
  ['How do I move to a new PC?', 'Settings → Export backup, copy the file across, then Settings → Restore backup on the new PC.'],
  ['Is this financial advice?', 'No. Pulse is a budgeting tool. Tax, take-home and payoff figures are estimates, and AI plans are suggestions you choose whether to apply. For big decisions, check with your lender or a qualified adviser.'],
  ['The tax numbers look slightly different from my payslip', 'Pulse estimates take-home pay from your tax code, pension and student loan. Things like tax refunds, benefits in kind or emergency codes can make your payslip differ a little. You can always switch to "I know my take-home" instead.'],
];

export default function Help() {
  const { notify } = useApp();
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [kind, setKind] = useState('idea');
  useEffect(() => { api.info?.().then(setInfo).catch(() => {}); }, []);

  const send = () => {
    api.feedback({ subject: kind === 'bug' ? 'Pulse: problem report' : 'Pulse: feedback', body: msg, includeLog: kind === 'bug' });
    notify('Your email app should open with the message ready to send', 'good');
  };

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Help & feedback</h1><p className="muted">Pulse Finance {APP_VERSION}</p></div></header>

      <div className="card">
        <h3>🚀 Getting started in 5 minutes</h3>
        <ol className="steps-list">
          <li><b>Tell Pulse how you're paid.</b> Settings → Profile & Pay. Your paydays appear on the calendar.</li>
          <li><b>Add your regular bills</b> on Bills & Income: rent, council tax, phone, subscriptions.</li>
          <li><b>Add any debts</b> on Debts & Loans, in any currency.</li>
          <li><b>Bring in transactions</b> from Bank Sync, or add a few by hand.</li>
          <li><b>Follow your payday routine</b> on the Pay Planner, and answer the "Needs your attention" questions on the Dashboard.</li>
        </ol>
      </div>

      <div className="card">
        <h3>❓ Common questions</h3>
        <div className="faq">
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </div>

      <div className="card">
        <h3>💬 Send feedback or report a problem</h3>
        <div className="seg">
          <button className={kind === 'idea' ? 'on in' : ''} onClick={() => setKind('idea')}>💡 Idea or feedback</button>
          <button className={kind === 'bug' ? 'on out' : ''} onClick={() => setKind('bug')}>🐞 Something's wrong</button>
        </div>
        <textarea rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={kind === 'bug' ? 'What happened, and what were you doing just before?' : 'What would make Pulse more useful for you?'} />
        <p className="muted xs">This opens your email app with the message ready. {kind === 'bug' ? 'It adds the app version and recent error messages (never your financial data). You can read everything before sending.' : 'It adds the app version.'}</p>
        <button className="btn primary" disabled={!msg.trim()} onClick={send}>Open email</button>
      </div>

      <div className="card">
        <h3>🤝 Share Pulse with a friend</h3>
        <p className="muted">Send them this link. It always points to the latest version.</p>
        <div className="inline-row">
          <input readOnly value={DOWNLOAD_URL} className="grow" onFocus={(e) => e.target.select()} />
          <button className="btn ghost" onClick={async () => { await api.copyText(DOWNLOAD_URL); notify('Link copied', 'good'); }}>Copy link</button>
        </div>
      </div>

      <div className="card">
        <h3>🆕 What's new</h3>
        {CHANGES.map((c) => (
          <div key={c.v} className="changes"><b>v{c.v}</b><ul>{c.items.map((i) => <li key={i}>{i}</li>)}</ul></div>
        ))}
        {isDesktop && info && <p className="muted xs">Pulse {info.version} · Electron {info.electron} · {info.platform}</p>}
      </div>
    </div>
  );
}
