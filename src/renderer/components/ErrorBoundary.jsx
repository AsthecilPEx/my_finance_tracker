import { Component } from 'react';
import { api } from '../api.js';

/** If a screen crashes, show a friendly message with a one-click bug report instead of a blank window. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    api.logError?.(error.message, `${error.stack || ''}\n${info?.componentStack || ''}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <div className="crash-icon" aria-hidden>🛠️</div>
          <h2>Something went wrong on this screen</h2>
          <p className="muted">Your data is safe: it's saved on this computer and backed up daily. Reloading usually fixes this.</p>
          <pre className="crash-detail">{String(error.message).slice(0, 300)}</pre>
          <div className="inline-row wrap">
            <button className="btn primary" onClick={() => window.location.reload()}>Reload Pulse</button>
            <button className="btn ghost" onClick={() => api.feedback({ subject: 'Pulse crashed', body: `What I was doing when it happened:\n\n\nError: ${error.message}\n${String(error.stack || '').split('\n').slice(0, 6).join('\n')}`, includeLog: true })}>Report this problem</button>
          </div>
        </div>
      </div>
    );
  }
}
