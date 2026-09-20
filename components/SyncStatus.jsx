'use client';
// Honest sync status for the conservative-polling model.
//   green  Synced   - last fetch succeeded (data is as fresh as lastSync)
//   yellow Syncing  - a fetch is in progress
//   red    Offline  - last fetch failed
// We NEVER claim realtime; this only reflects the last successful poll.
import { useCallback, useState } from 'react';

export function useSyncStatus() {
  const [status, setStatus] = useState('ok');
  const [lastSync, setLastSync] = useState(null);

  const withStatus = useCallback(async (fn) => {
    setStatus('syncing');
    try {
      await fn();
      setStatus('ok');
      setLastSync(new Date());
    } catch (err) {
      if (!err || err.status !== 401) setStatus('offline');
      throw err;
    }
  }, []);

  return { status, lastSync, withStatus };
}

export function SyncPill({ status = 'ok', lastSync }) {
  const cfg =
    status === 'syncing'
      ? { dot: 'bg-amber-400 animate-pulse', label: 'Syncing', cls: 'text-amber-700 border-amber-200 bg-amber-50' }
      : status === 'offline'
        ? { dot: 'bg-red-500', label: 'Offline', cls: 'text-red-700 border-red-200 bg-red-50' }
        : { dot: 'bg-emerald-500', label: 'Synced', cls: 'text-emerald-700 border-emerald-200 bg-emerald-50' };

  const title =
    lastSync && status !== 'offline'
      ? `Last sync: ${lastSync.toLocaleTimeString()}. Refreshes automatically every ~30 seconds.`
      : status === 'offline'
        ? 'Connection problem. Retrying on next refresh.'
        : 'Waiting for first sync.';

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cfg.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      <span className="hidden sm:inline">{cfg.label}</span>
    </span>
  );
}
