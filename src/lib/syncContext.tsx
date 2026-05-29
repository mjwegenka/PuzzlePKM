/**
 * DEC-18 / DEC-33: Sync context — provides auto/manual sync status while
 * desktop sync itself runs in a native background task so the foreground UI
 * stays responsive during long reconciliations.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getBackgroundSyncStatus, startBackgroundSync } from './cliService';

const SYNC_INTERVAL_MS = 30_000;
const SYNC_STATUS_POLL_MS = 1_000;

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

  const scheduledSyncRef = useRef<number | null>(null);
  const latestStatusRef = useRef({
    syncing: false,
    lastSucceededAt: null as number | null,
    lastError: null as string | null,
  });

  const applySyncStatus = useCallback((status: { syncing: boolean; lastSucceededAt: number | null; lastError: string | null }) => {
    const previous = latestStatusRef.current;
    latestStatusRef.current = status;
    setSyncing(status.syncing);
    setSyncError(status.lastError ?? null);
    setLastSyncedAt(typeof status.lastSucceededAt === 'number' ? new Date(status.lastSucceededAt) : null);

    if (previous.syncing && !status.syncing && !status.lastError && status.lastSucceededAt !== previous.lastSucceededAt) {
      window.dispatchEvent(new Event('puzzlepkm:objects-updated'));
    }
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    try {
      const status = await getBackgroundSyncStatus();
      applySyncStatus(status);
    } catch (err) {
      const message = String(err);
      setSyncing(false);
      setSyncError(message);
    }
  }, [applySyncStatus]);

  const doSync = useCallback(async () => {
    try {
      const result = await startBackgroundSync();
      applySyncStatus(result.status);
    } catch (err) {
      setSyncError(String(err));
    }
  }, [applySyncStatus]);

  useEffect(() => {
    void refreshSyncStatus();
  }, [refreshSyncStatus]);

  useEffect(() => {
    if (!syncing) return;
    const id = window.setInterval(() => {
      void refreshSyncStatus();
    }, SYNC_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshSyncStatus, syncing]);

  // 30-second auto-sync
  useEffect(() => {
    const id = window.setInterval(() => {
      void doSync();
    }, SYNC_INTERVAL_MS);
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

