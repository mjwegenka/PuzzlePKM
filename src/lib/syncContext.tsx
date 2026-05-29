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
  triggerSyncInBackground: () => void;
}

const SyncContext = createContext<SyncState>({
  syncing: false,
  lastSyncedAt: null,
  syncError: null,
  triggerSync: () => {},
  triggerSyncInBackground: () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Guard against concurrent syncs
  const syncingRef = useRef(false);
  const scheduledSyncRef = useRef<number | null>(null);

  const doSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await runSync();
      setLastSyncedAt(new Date());
      window.dispatchEvent(new Event('puzzlepkm:objects-updated'));
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

  const triggerSyncInBackground = useCallback(() => {
    if (scheduledSyncRef.current !== null) {
      window.clearTimeout(scheduledSyncRef.current);
    }
    scheduledSyncRef.current = window.setTimeout(() => {
      scheduledSyncRef.current = null;
      void doSync();
    }, 1200);
  }, [doSync]);

  useEffect(() => {
    return () => {
      if (scheduledSyncRef.current !== null) {
        window.clearTimeout(scheduledSyncRef.current);
      }
    };
  }, []);

  return (
    <SyncContext.Provider value={{ syncing, lastSyncedAt, syncError, triggerSync: doSync, triggerSyncInBackground }}>
      {children}
    </SyncContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncStatus(): SyncState {
  return useContext(SyncContext);
}

