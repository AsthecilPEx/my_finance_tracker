import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { APP_VERSION, DOWNLOAD_URL } from '../../config.js';

const CHANGES = [
  { v: '0.4', items: ['Automatic updates', 'Help & feedback', 'Friendlier error screen'] },
  { v: '0.3', items: ['Split bills with repayment linking', 'Any currency with live exchange rates', '"Needs your attention" dashboard panel', 'Pots, clearer Pay Planner, right-click menus', 'Security hardening'] },
  { v: '0.2', items: ['Pay profiles with UK take-home pay', 'Pay Planner for irregular pay', 'Receipts with offline photo reading', 'Spend caps and AI plans'] },
  { v: '0.1', items: ['Dashboard, calendar, bills, debts, insights and desktop widget'] },
];

const FAQ = [
  ['Windows says "Windows protected your PC". Is it safe?', 'Yes. Pulse isn\'t signed with a paid Microsoft certificate yet, so Windows warns about any new app from a small developer. Click "More info" → "Run anyway". You only see this once.'],
  ['Where is my data? Can anyone else see it?', 'Everything is stored only on this computer, in %APPDATA%\\Pulse Finance. There is no account and no server, so nobody (including the person who shared the app) can see your finances. A backup is kept automatically every day for 14 days.'],
  ['What does Pulse connect to on the internet?', 'Only three things: daily exchange rates, update checks from GitHub, and your bank if you choose to connect it (read-only). Nothing about your finances is ever uploaded.'],
  ['How do I get my transactions in?', 'Three options, all read-only. 1) Bank Sync connects your bank through Open Banking. 2) The watched folder auto-imports any bank statement CSV you download. 3) Import a statement file by hand. Or just add transactions yourself.'],
  ['Do I need my own Enable Banking account for bank sync?', 'Yes. Each person creates their own free Enable Banking application and links their own accounts. That is what keeps your bank data private to you. Bank Sync walks you through it.'],
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
