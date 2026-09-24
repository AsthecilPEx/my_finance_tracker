import { createRoot } from 'react-dom/client';
import { AppProvider } from './store.jsx';
import App from './App.jsx';
import Widget from './Widget.jsx';
import './styles.css';

const isWidget = window.location.hash.startsWith('#widget');
document.body.classList.toggle('widget-body', isWidget);

createRoot(document.getElementById('root')).render(
  <AppProvider>{isWidget ? <Widget /> : <App />}</AppProvider>,
);
