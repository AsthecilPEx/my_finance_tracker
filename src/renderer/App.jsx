import { useState } from 'react';
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
import Settings from './pages/Settings.jsx';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉', Component: Dashboard },
  { id: 'insights', label: 'Insights', icon: '✦', Component: Insights },
  { id: 'transactions', label: 'Transactions', icon: '≡', Component: Transactions },
  { id: 'bills', label: 'Bills & Income', icon: '↻', Component: Bills },
  { id: 'debts', label: 'Debts & Loans', icon: '◔', Component: Debts },
  { id: 'budgets', label: 'Budgets', icon: '◎', Component: Budgets },
  { id: 'connect', label: 'Import & Sync', icon: '⇅', Component: Connect },
  { id: 'settings', label: 'Settings', icon: '⚙', Component: Settings },
];

export default function App() {
  const { state, toast } = useApp();
  const [page, setPage] = useState('dashboard');
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
          </button>
        ))}
        <div className="sidebar-foot">
          <button className="btn primary block" onClick={() => setAdding(true)}>+ Add transaction</button>
          {isDesktop && <button className="btn ghost block" onClick={() => api.toggleWidget()}>▣ Desktop widget</button>}
          {state.settings.demo && <div className="demo-flag">Demo data: reset it in Settings</div>}
        </div>
      </nav>
      <main className="content">
        <Component go={setPage} />
      </main>
      {adding && <Modal title="Add transaction" onClose={() => setAdding(false)}><TxnForm onDone={() => setAdding(false)} /></Modal>}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}
    </div>
  );
}
