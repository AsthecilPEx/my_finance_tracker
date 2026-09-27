import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Shows "Restart to update" once a new version has downloaded in the background. */
export function useUpdateStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    api.updates?.status().then(setStatus).catch(() => {});
    return api.updates?.onStatus?.(setStatus);
  }, []);
  return status;
}

export default function UpdateBanner() {
  const status = useUpdateStatus();
  const [hidden, setHidden] = useState(false);
  if (hidden || status?.state !== 'ready') return null;
  return (
    <div className="update-banner" role="status">
      <span>✨ <b>Pulse {status.available}</b> is ready. Restart to update (takes a few seconds, your data is untouched).</span>
      <button className="btn primary sm" onClick={() => api.updates.install()}>Restart now</button>
      <button className="linkish muted sm" onClick={() => setHidden(true)}>Later</button>
    </div>
  );
}
