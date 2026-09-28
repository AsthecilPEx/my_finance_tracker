import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { todayISO } from '../engine/dates.js';
import { formatMoney } from '../engine/money.js';
import { categoryMap } from '../engine/categories.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, setState] = useState(null);
  const [today, setToday] = useState(todayISO());
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api.getState().then(setState);
    const off = api.onState(setState);
    // Roll the date over at midnight so "today" stays correct in a long-running app.
    const timer = setInterval(() => setToday(todayISO()), 60_000);
    return () => { off?.(); clearInterval(timer); };
  }, []);

  const dispatch = useCallback(async (action) => {
    const next = await api.dispatch(action);
    setState(next);
    return next;
  }, []);

  const notify = useCallback((message, kind = 'info') => {
    const id = Date.now();
    setToast({ message, kind, id });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 4000);
  }, []);

  const value = useMemo(() => {
    if (!state) return null;
    const currency = state.settings.currency || 'GBP';
    return {
      state,
      dispatch,
      today,
      currency,
      cats: categoryMap(state.categories),
      fmt: (n, o) => formatMoney(n, currency, o),
      notify,
      toast,
    };
  }, [state, dispatch, today, notify, toast]);

  if (!value) return <div className="boot">Loading…</div>;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
