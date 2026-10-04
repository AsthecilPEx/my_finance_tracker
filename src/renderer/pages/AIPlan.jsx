import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { buildPrompt, parsePlan, diffPlan } from '../../engine/aiplan.js';

export default function AIPlan() {
  const { state, today, fmt, dispatch, notify } = useApp();
  const [situation, setSituation] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [reply, setReply] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const prompt = useMemo(() => buildPrompt(state, today, situation), [state, today, situation]);
  const changes = useMemo(() => (result?.plan ? diffPlan(state, result.plan, (n) => fmt(n)) : []), [result, state, fmt]);
  const groups = [...new Set(changes.map((c) => c.group))];

  const copy = async () => {
    await api.copyText(prompt);
    notify('Prompt copied. Paste it into ChatGPT, Claude, Gemini or Copilot.', 'good');
  };
  const check = (text = reply) => {
    const r = parsePlan(text, state);
    setResult(r);
    if (r.plan) setSelected(new Set(diffPlan(state, r.plan).map((c) => c.id)));
  };
  const openFile = async () => {
    const f = await api.plan.openFile();
    if (f) { setReply(f.text); check(f.text); }
  };
  const apply = async () => {
    await dispatch({ type: 'plan/apply', payload: { plan: result.plan, selected: [...selected] } });
    notify(`Applied ${selected.size} change${selected.size === 1 ? '' : 's'} from "${result.plan.title}"`, 'good');
    setResult(null);
    setReply('');
  };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="page narrow">
      <header className="page-head">
        <div><h1>AI Plan</h1><p className="muted">Ask any AI assistant for a plan, then load it in. Nothing changes until you tick it.</p></div>
      </header>

      <div className="card step-card">
        <div className="step-num">1</div>
        <div className="grow">
          <h3>Describe what's going on (optional)</h3>
          <textarea rows={4} value={situation} onChange={(e) => setSituation(e.target.value)} placeholder="e.g. I'm paid weekly on zero-hours, rent is due on the 1st and I always struggle that week. I want to clear my credit card by summer and save for a deposit." />
          <p className="muted sm">Includes a summary of your finances; leaves out your name, accounts and transactions.</p>
          <div className="inline-row wrap">
            <button className="btn primary" onClick={copy}>📋 Copy prompt</button>
            <button className="btn ghost" onClick={() => api.saveText(prompt, 'pulse-ai-prompt.txt')}>Save as file</button>
            <button className="linkish muted" onClick={() => setShowPrompt((x) => !x)}>{showPrompt ? 'Hide' : 'Preview'} prompt</button>
          </div>
          {showPrompt && <pre className="prompt-preview">{prompt}</pre>}
        </div>
      </div>

      <div className="card step-card">
        <div className="step-num">2</div>
        <div className="grow">
          <h3>Paste it into your AI assistant</h3>
          <p className="muted">Answer any questions it asks. It finishes with a block of code starting <code>{'{ "pulsePlanVersion": 1'}</code>.</p>
        </div>
      </div>

      <div className="card step-card">
        <div className="step-num">3</div>
        <div className="grow">
          <h3>Bring the plan back</h3>
          <textarea rows={6} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste the AI's whole reply here (or just the JSON block)" />
          <div className="inline-row wrap">
            <button className="btn primary" disabled={!reply.trim()} onClick={() => check()}>Check plan</button>
            <button className="btn ghost" onClick={openFile}>Open a saved reply…</button>
          </div>
          {result?.errors?.length > 0 && <div className="callout bad">{result.errors.map((e) => <div key={e}>⚠ {e}</div>)}</div>}
          {result?.plan && (
            <div className="plan-preview">
              <h3>{result.plan.title}</h3>
              {result.plan.strategy && <div className="band-pill">{result.plan.strategy}</div>}
              {result.plan.summary && <p>{result.plan.summary}</p>}
              {groups.map((g) => (
                <div key={g}>
                  <h4>{g}</h4>
                  {changes.filter((c) => c.group === g).map((c) => (
                    <label key={c.id} className="check change-row"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /><span>{c.text}</span></label>
                  ))}
                </div>
              ))}
              {changes.length === 0 && <p className="muted">This plan matches your current setup, so there's nothing to change.</p>}
              {result.plan.tips.length > 0 && <><h4>Tips from the plan</h4><ul className="tips">{result.plan.tips.map((t) => <li key={t}>{t}</li>)}</ul></>}
              {result.warnings.length > 0 && <details className="muted sm"><summary>{result.warnings.length} note{result.warnings.length === 1 ? '' : 's'} from checking the plan</summary><ul>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
              <div className="form-actions">
                <button className="btn ghost" onClick={() => setResult(null)}>Discard</button>
                <button className="btn primary" disabled={!selected.size} onClick={apply}>Apply {selected.size} change{selected.size === 1 ? '' : 's'}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(state.planHistory || []).length > 0 && (
        <div className="card">
          <h3>Plan history</h3>
          <ul className="list">
            {state.planHistory.map((h) => (
              <li key={h.id} className="list-row">
                <span className="grow"><b>{h.title}</b><small className="muted"> · {new Date(h.appliedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {h.changes} changes{h.undone ? ' · undone' : ''}{h.superseded ? ' · replaced by a newer version' : ''}</small>{h.tips?.length > 0 && <div className="muted sm">💡 {h.tips[0]}</div>}</span>
                {!h.undone && h.before && <button className="btn ghost sm" onClick={() => { dispatch({ type: 'plan/undo', payload: { id: h.id } }); notify('Plan undone: budgets, caps, goals and pauses restored', 'good'); }}>Undo</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
