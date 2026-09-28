import { createRoot } from 'react-dom/client';
import { AppProvider } from './store.jsx';
import App from './App.jsx';
import Widget from './Widget.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { DialogProvider } from './components/Dialogs.jsx';
import { api } from './api.js';
import './styles.css';

const isWidget = window.location.hash.startsWith('#widget');
window.addEventListener('error', (e) => api.logError?.(e.message, e.error?.stack));
window.addEventListener('unhandledrejection', (e) => api.logError?.(String(e.reason?.message || e.reason), e.reason?.stack));
document.body.classList.toggle('widget-body', isWidget);

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><AppProvider><DialogProvider>{isWidget ? <Widget /> : <App />}</DialogProvider></AppProvider></ErrorBoundary>,
);
