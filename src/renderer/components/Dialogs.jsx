import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';

// In-app replacements for window.confirm / window.prompt. The native versions break keyboard
// focus in Electron on Windows (text boxes stop accepting typing afterwards), and prompt()
// isn't supported in Electron at all, so the app must never use them.
const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const open = useCallback((d) => new Promise((resolve) => setDialog({ ...d, resolve })), []);
  const close = (value) => { dialog?.resolve(value); setDialog(null); };
  const api = useRef({
    confirm: (opts) => open({ kind: 'confirm', ...opts }),
    prompt: (opts) => open({ kind: 'prompt', ...opts }),
  });
  return (
    <DialogContext.Provider value={api.current}>
      {children}
      {dialog && <DialogView dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.defaultValue ?? '');
  const inputRef = useRef(null);
  const okRef = useRef(null);
  useEffect(() => { (inputRef.current || okRef.current)?.focus(); }, []);
  const cancelValue = dialog.kind === 'confirm' ? false : null;
  const submit = (e) => { e?.preventDefault(); onClose(dialog.kind === 'confirm' ? true : value); };
  return (
    <Modal title={dialog.title || 'Please confirm'} onClose={() => onClose(cancelValue)}>
      <form className="form" onSubmit={submit}>
        {dialog.message && <p className="dialog-message">{dialog.message}</p>}
        {dialog.kind === 'prompt' && (
          <input ref={inputRef} type={dialog.inputType || 'text'} step="any" value={value} onChange={(e) => setValue(e.target.value)} aria-label={dialog.title} />
        )}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => onClose(cancelValue)}>{dialog.cancelLabel || 'Cancel'}</button>
          <button ref={okRef} type="submit" className={`btn ${dialog.danger ? 'danger' : 'primary'}`}>{dialog.okLabel || 'OK'}</button>
        </div>
      </form>
    </Modal>
  );
}

export const useDialog = () => useContext(DialogContext);
