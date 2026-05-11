import { ipcMain } from 'electron';
import { IPC } from '../../src/shared/ipcChannels.js';
import type { IpcResult } from '../../src/shared/types.js';
import {
  listTopicNotes,
  getTopicNote,
  createTopicNote,
  updateTopicNote,
  deleteTopicNote,
} from '../repositories/topicNoteRepo.js';
import {
  getDailyNote,
  getDailyNoteByDate,
  upsertDailyNote,
  deleteDailyNote,
  listDailyNotes,
} from '../repositories/dailyNoteRepo.js';
import { getDropboxAccessToken, getDropboxAuthState } from '../auth/dropbox.js';
import {
  DEFAULT_NOTES_ROOT,
  fetchDailyNoteFromDropbox,
  pushDailyNoteToDropbox,
  pushTopicNoteToDropbox,
  type DailyNoteSyncFields,
  type TopicNoteSyncFields,
} from '../dropbox/noteSync.js';
import { resolveTagNames, resolveTagIds } from './sync.js';

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail(error: string): IpcResult<never> {
  return { success: false, error };
}

/** Push a daily note to Dropbox in the background (fire-and-forget). */
function pushDailyNoteAsync(noteId: string): void {
  (async () => {
    try {
      const authState = await getDropboxAuthState();
      if (!authState.isConnected) return;
      const token = await getDropboxAccessToken();
      if (!token) return;
      const note = getDailyNote(noteId);
      if (!note) return;
      const rootFolder = authState.rootFolder ?? DEFAULT_NOTES_ROOT;
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
    } catch (e) {
      console.warn('[Sync] Background push of daily note failed:', String(e));
    }
  })();
}

/** Push a topic note to Dropbox in the background (fire-and-forget). */
function pushTopicNoteAsync(noteId: string): void {
  (async () => {
    try {
      const authState = await getDropboxAuthState();
      if (!authState.isConnected) return;
      const token = await getDropboxAccessToken();
      if (!token) return;
      const note = getTopicNote(noteId);
      if (!note) return;
      const rootFolder = authState.rootFolder ?? DEFAULT_NOTES_ROOT;
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
    } catch (e) {
      console.warn('[Sync] Background push of topic note failed:', String(e));
    }
  })();
}

export function registerNotesIpc(): void {
  // ── Topic Notes ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.TOPIC_NOTE_LIST, () => {
    try { return ok(listTopicNotes()); }
    catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TOPIC_NOTE_GET, (_e, id: string) => {
    try {
      const note = getTopicNote(id);
      if (!note) return fail('Note not found');
      return ok(note);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TOPIC_NOTE_CREATE, (_e, input: Parameters<typeof createTopicNote>[0]) => {
    try {
      const note = createTopicNote(input);
      pushTopicNoteAsync(note.id);
      return ok(note);
    }
    catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TOPIC_NOTE_UPDATE, (_e, id: string, input: Parameters<typeof updateTopicNote>[1]) => {
    try {
      const note = updateTopicNote(id, input);
      if (!note) return fail('Note not found');
      pushTopicNoteAsync(note.id);
      return ok(note);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TOPIC_NOTE_DELETE, (_e, id: string) => {
    try { return ok(deleteTopicNote(id)); }
    catch (e) { return fail(String(e)); }
  });

  // ── Daily Notes ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.DAILY_NOTE_LIST, () => {
    try { return ok(listDailyNotes()); }
    catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.DAILY_NOTE_GET, (_e, id: string) => {
    try {
      const note = getDailyNote(id);
      if (!note) return fail('Daily note not found');
      return ok(note);
    } catch (e) { return fail(String(e)); }
  });

  /**
   * Load a daily note by date.
   * DEC-28: Dropbox is canonical. If connected, check Dropbox first.
   *  - If found in Dropbox and newer than DB: upsert DB from Dropbox, return result.
   *  - If not in Dropbox but in DB: push DB version to Dropbox in the background.
   *  - Falls back to local DB on any Dropbox error.
   */
  ipcMain.handle(IPC.DAILY_NOTE_GET_BY_DATE, async (_e, date: string) => {
    try {
      try {
        const authState = await getDropboxAuthState();
        if (authState.isConnected) {
          const token = await getDropboxAccessToken();
          if (token) {
            const rootFolder = authState.rootFolder ?? DEFAULT_NOTES_ROOT;
            const dropboxFields = await fetchDailyNoteFromDropbox(date, token, rootFolder);

            if (dropboxFields) {
              // Dropbox version found — upsert to DB if it is newer
              const existing = getDailyNoteByDate(date);
              if (!existing || new Date(dropboxFields.updatedAt) > new Date(existing.updatedAt)) {
                upsertDailyNote({
                  id: dropboxFields.id,
                  date: dropboxFields.date,
                  contentMarkdown: dropboxFields.contentMarkdown,
                  linkedObjectIds: dropboxFields.linkedObjectIds,
                  tags: resolveTagIds(dropboxFields.tagNames),
                  now: dropboxFields.updatedAt,
                });
              }
            } else {
              // Not in Dropbox — push local DB version if it exists
              const localNote = getDailyNoteByDate(date);
              if (localNote) {
                pushDailyNoteAsync(localNote.id);
              }
            }
          }
        }
      } catch (dropboxErr) {
        console.warn('[Sync] Dropbox check failed for daily note, using local DB:', String(dropboxErr));
      }

      const note = getDailyNoteByDate(date);
      if (!note) return fail('Daily note not found for date');
      return ok(note);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.DAILY_NOTE_UPSERT, (_e, input: Parameters<typeof upsertDailyNote>[0]) => {
    try {
      const note = upsertDailyNote(input);
      pushDailyNoteAsync(note.id);
      return ok(note);
    }
    catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.DAILY_NOTE_DELETE, (_e, id: string) => {
    try { return ok(deleteDailyNote(id)); }
    catch (e) { return fail(String(e)); }
  });
}
