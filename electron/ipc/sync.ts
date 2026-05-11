/**
 * Sync IPC handlers and background consistency check.
 *
 * DEC-28: Dropbox is the canonical source. On load, Dropbox is checked first.
 *         If Dropbox has a newer version (by updatedAt), it wins.
 * DEC-29: A background consistency check runs after manual sync triggers and on
 *         the periodic auto-sync timer.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../src/shared/ipcChannels.js';
import type { IpcResult, SyncStatus } from '../../src/shared/types.js';
import { getDropboxAccessToken, getDropboxAuthState } from '../auth/dropbox.js';
import {
  listDailyNotes,
  getDailyNoteByDate,
  upsertDailyNote,
} from '../repositories/dailyNoteRepo.js';
import {
  listTopicNotes,
  getTopicNote,
  createTopicNote,
  updateTopicNote,
} from '../repositories/topicNoteRepo.js';
import { getTag, getTagByName, createTag } from '../repositories/tagRepo.js';
import {
  DEFAULT_NOTES_ROOT,
  fetchAllDailyNotesFromDropbox,
  fetchAllTopicNotesFromDropbox,
  pushDailyNoteToDropbox,
  pushTopicNoteToDropbox,
  type DailyNoteSyncFields,
  type TopicNoteSyncFields,
} from '../dropbox/noteSync.js';

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail(error: string): IpcResult<never> {
  return { success: false, error };
}

let syncStatus: SyncStatus = { isSyncing: false };

function broadcastSyncStatus(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC.SYNC_STATUS_CHANGED, syncStatus);
  });
}

// ── Tag resolution helpers ────────────────────────────────────────────────────

/** Resolve a note's tag IDs to display names for Dropbox serialization. */
export function resolveTagNames(tagIds: string[]): string[] {
  return tagIds
    .map((id) => getTag(id)?.displayName)
    .filter((name): name is string => name !== undefined);
}

/**
 * Resolve tag display names from Dropbox front matter to local tag IDs.
 * Creates tags that don't exist yet.
 */
export function resolveTagIds(tagNames: string[]): string[] {
  const ids: string[] = [];
  const now = new Date().toISOString();
  for (const name of tagNames) {
    if (!name.trim()) continue;
    const existing = getTagByName(name);
    if (existing) {
      ids.push(existing.id);
    } else {
      try {
        const created = createTag({
          id: crypto.randomUUID(),
          displayName: name,
          createdAt: now,
        });
        ids.push(created.id);
      } catch {
        // Race condition or invalid name — skip this tag
      }
    }
  }
  return ids;
}

// ── Consistency check ─────────────────────────────────────────────────────────

interface CheckResult {
  imported: number;
  uploaded: number;
  errors: string[];
}

async function reconcileDailyNotes(
  token: string,
  rootFolder: string,
): Promise<CheckResult> {
  const result: CheckResult = { imported: 0, uploaded: 0, errors: [] };

  // Fetch all Dropbox daily notes
  const dropboxNotes = await fetchAllDailyNotesFromDropbox(token, rootFolder);
  const dropboxByDate = new Map(dropboxNotes.map((n) => [n.date, n]));

  // Import/update DB from Dropbox (Dropbox is canonical)
  for (const fields of dropboxNotes) {
    try {
      const existing = getDailyNoteByDate(fields.date);
      if (!existing) {
        upsertDailyNote({
          id: fields.id,
          date: fields.date,
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: resolveTagIds(fields.tagNames),
          now: fields.updatedAt,
        });
        result.imported++;
      } else if (new Date(fields.updatedAt) > new Date(existing.updatedAt)) {
        upsertDailyNote({
          id: existing.id,
          date: fields.date,
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: resolveTagIds(fields.tagNames),
          now: fields.updatedAt,
        });
      }
    } catch (e) {
      result.errors.push(`daily-note ${fields.date}: ${String(e)}`);
    }
  }

  // Upload local notes that are missing from Dropbox
  const localNotes = listDailyNotes();
  for (const note of localNotes) {
    if (!dropboxByDate.has(note.date)) {
      try {
        const syncFields: DailyNoteSyncFields = {
          id: note.id,
          date: note.date,
          contentMarkdown: note.contentMarkdown,
          tagNames: resolveTagNames(note.tags),
          linkedObjectIds: note.linkedObjectIds,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        };
        await pushDailyNoteToDropbox(syncFields, token, rootFolder);
        result.uploaded++;
      } catch (e) {
        result.errors.push(`daily-note upload ${note.date}: ${String(e)}`);
      }
    }
  }

  return result;
}

async function reconcileTopicNotes(
  token: string,
  rootFolder: string,
): Promise<CheckResult> {
  const result: CheckResult = { imported: 0, uploaded: 0, errors: [] };

  const dropboxNotes = await fetchAllTopicNotesFromDropbox(token, rootFolder);
  const dropboxById = new Map(dropboxNotes.map((n) => [n.id, n]));

  // Import/update DB from Dropbox
  for (const fields of dropboxNotes) {
    try {
      const existing = getTopicNote(fields.id);
      if (!existing) {
        createTopicNote({
          id: fields.id,
          title: fields.title,
          content: {},
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: resolveTagIds(fields.tagNames),
          createdAt: fields.createdAt,
          updatedAt: fields.updatedAt,
        });
        result.imported++;
      } else if (new Date(fields.updatedAt) > new Date(existing.updatedAt)) {
        updateTopicNote(existing.id, {
          title: fields.title,
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: resolveTagIds(fields.tagNames),
          updatedAt: fields.updatedAt,
        });
      }
    } catch (e) {
      result.errors.push(`topic-note ${fields.id}: ${String(e)}`);
    }
  }

  // Upload local topic notes missing from Dropbox
  const localNotes = listTopicNotes();
  for (const note of localNotes) {
    if (!dropboxById.has(note.id)) {
      try {
        const syncFields: TopicNoteSyncFields = {
          id: note.id,
          title: note.title,
          contentMarkdown: note.contentMarkdown,
          tagNames: resolveTagNames(note.tags),
          linkedObjectIds: note.linkedObjectIds,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        };
        await pushTopicNoteToDropbox(syncFields, token, rootFolder);
        result.uploaded++;
      } catch (e) {
        result.errors.push(`topic-note upload ${note.id}: ${String(e)}`);
      }
    }
  }

  return result;
}

export async function triggerSync(): Promise<void> {
  const token = await getDropboxAccessToken();
  if (!token) {
    syncStatus = { isSyncing: false, error: 'Not connected to Dropbox' };
    broadcastSyncStatus();
    return;
  }

  syncStatus = { isSyncing: true };
  broadcastSyncStatus();

  try {
    const authState = await getDropboxAuthState();
    const rootFolder = authState.rootFolder ?? DEFAULT_NOTES_ROOT;

    const [dailyResult, topicResult] = await Promise.all([
      reconcileDailyNotes(token, rootFolder),
      reconcileTopicNotes(token, rootFolder),
    ]);

    const allErrors = [...dailyResult.errors, ...topicResult.errors];
    const totalImported = dailyResult.imported + topicResult.imported;
    const totalUploaded = dailyResult.uploaded + topicResult.uploaded;

    if (allErrors.length > 0) {
      console.warn('[Sync] Completed with errors:', allErrors);
    }
    console.log(
      `[Sync] Done — imported: ${totalImported}, uploaded: ${totalUploaded}, errors: ${allErrors.length}`,
    );

    syncStatus = {
      isSyncing: false,
      lastSyncAt: new Date().toISOString(),
      ...(allErrors.length > 0 && { error: `${allErrors.length} item(s) failed to sync` }),
    };
  } catch (e) {
    syncStatus = { isSyncing: false, error: String(e) };
  }

  broadcastSyncStatus();
}

export function registerSyncIpc(): void {
  ipcMain.handle(IPC.SYNC_GET_STATUS, () => ok(syncStatus));

  ipcMain.handle(IPC.SYNC_TRIGGER, async () => {
    try {
      await triggerSync();
      return ok(syncStatus);
    } catch (e) { return fail(String(e)); }
  });
}
