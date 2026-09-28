import { useEffect, useState } from 'react';
import { useApp } from './store.jsx';
import { api, isDesktop } from './api.js';
import Modal from './components/Modal.jsx';
import { TxnForm } from './components/Forms.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Bills from './pages/Bills.jsx';
import Debts from './pages/Debts.jsx';
import Insights from './pages/Insights.jsx';
import Budgets from './pages/Budgets.jsx';
import Connect from './pages/Connect.jsx';
import Planner from './pages/Planner.jsx';
import Receipts from './pages/Receipts.jsx';
import AIPlan from './pages/AIPlan.jsx';
import Help from './pages/Help.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import { APP_VERSION } from '../config.js';
import { receiptInbox } from '../engine/receipts.js';
import Settings from './pages/Settings.jsx';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉', Component: Dashboard },
  { id: 'planner', label: 'Pay Planner', icon: '⇶', Component: Planner },
  { id: 'insights', label: 'Insights', icon: '✦', Component: Insights },
  { id: 'receipts', label: 'Receipts', icon: '🧾', Component: Receipts },
  { id: 'transactions', label: 'Transactions', icon: '≡', Component: Transactions },
  { id: 'bills', label: 'Bills & Income', icon: '↻', Component: Bills },
  { id: 'debts', label: 'Debts & Loans', icon: '◔', Component: Debts },
  { id: 'budgets', label: 'Budgets & Caps', icon: '◎', Component: Budgets },
  { id: 'ai', label: 'AI Plan', icon: '✧', Component: AIPlan },
  { id: 'connect', label: 'Bank Sync', icon: '⇅', Component: Connect },
  { id: 'settings', label: 'Settings', icon: '⚙', Component: Settings },
  { id: 'help', label: 'Help & feedback', icon: '?', Component: Help },
];

export default function App() {
  const { state, toast, today } = useApp();
  const [page, setPage] = useState('dashboard');
  const inboxCount = state.settings.receiptPrompts === false ? 0 : receiptInbox(state, today).length;
  // The main process can ask us to open a page (e.g. from a notification click).
  useEffect(() => api.onNavigate?.((p) => PAGES.some((x) => x.id === p) && setPage(p)), []);
  const [adding, setAdding] = useState(false);

  if (!state.settings.onboarded) return <Onboarding />;
  const { Component } = PAGES.find((p) => p.id === page);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><span className="brand-dot" />Pulse</div>
        {PAGES.map((p) => (
          <button key={p.id} className={`nav ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)}>
            <span className="nav-icon" aria-hidden>{p.icon}</span>{p.label}
            {p.id === 'receipts' && inboxCount > 0 && <span className="nav-badge" aria-label={`${inboxCount} to itemise`}>{inboxCount}</span>}
          </button>
        ))}
        <div className="sidebar-foot">
          <button className="btn primary block" onClick={() => setAdding(true)}>+ Add transaction</button>
          {isDesktop && <button className="btn ghost block" onClick={() => api.toggleWidget()}>▣ Desktop widget</button>}
          {state.settings.demo && <div className="demo-flag">Demo data: reset it in Settings</div>}
          <div className="version">v{APP_VERSION}</div>
        </div>
      </nav>
      <main className="content">
        <UpdateBanner />
        <Component go={setPage} />
      </main>
      {adding && <Modal title="Add transaction" onClose={() => setAdding(false)}><TxnForm onDone={() => setAdding(false)} /></Modal>}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}
    </div>
  );
}
