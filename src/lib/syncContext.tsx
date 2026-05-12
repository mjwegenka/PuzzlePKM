/**
 * DEC-19: Sync context — provides 30-second auto-sync and a manual trigger
 * available to any component tree. ObjectEditor triggers sync after every save.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { runSync } from './cliService';

const SYNC_INTERVAL_MS = 30_000;

interface SyncState {
  syncing: boolean;
  lastSyncedAt: Date | null;
  syncError: string | null;
  triggerSync: () => void;
}

const SyncContext = createContext<SyncState>({
  syncing: false,
  lastSyncedAt: null,
  syncError: null,
  triggerSync: () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Guard against concurrent syncs
  const syncingRef = useRef(false);

  const doSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await runSync();
      setLastSyncedAt(new Date());
    } catch (err) {
      setSyncError(String(err));
    } finally {
      setSyncing(false);
      syncingRef.current = false;
    }
  }, []);

  // 30-second auto-sync
  useEffect(() => {
    const id = setInterval(doSync, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [doSync]);

  return (
    <SyncContext.Provider value={{ syncing, lastSyncedAt, syncError, triggerSync: doSync }}>
      {children}
    </SyncContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncStatus(): SyncState {
  return useContext(SyncContext);
}

