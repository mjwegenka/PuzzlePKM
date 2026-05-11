import { ipcMain, shell } from 'electron';
import { IPC } from '../../src/shared/ipcChannels.js';
import type { IpcResult, DropboxEntry, TaggedObjectResult } from '../../src/shared/types.js';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '../repositories/projectRepo.js';
import { listRefMats, getRefMat, createRefMat, updateRefMat, deleteRefMat } from '../repositories/refMatRepo.js';
import { listHabits, getHabit, createHabit, updateHabit, deleteHabit } from '../repositories/habitRepo.js';
import { listTags, getTag, createTag, updateTag, deleteTag } from '../repositories/tagRepo.js';
import { getLinksForObject, createLink, deleteLink } from '../repositories/linkRepo.js';
import { getDb } from '../db/db.js';
import { getDropboxAccessToken } from '../auth/dropbox.js';

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

function fail(error: string): IpcResult<never> {
  return { success: false, error };
}

async function browseDropbox(path: string): Promise<DropboxEntry[]> {
  const token = await getDropboxAccessToken();
  if (!token) {
    throw new Error('Not connected to Dropbox');
  }

  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox browse failed: ${response.statusText}`);
  }

  const raw = await response.json() as unknown;
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { entries?: unknown }).entries)) {
    throw new Error('Dropbox browse failed: invalid response shape');
  }
  const data = raw as { entries: Array<{ name: string; path_display: string; '.tag': string }> };

  return data.entries
    .filter((entry): entry is { name: string; path_display: string; '.tag': 'file' | 'folder' } =>
      entry['.tag'] === 'file' || entry['.tag'] === 'folder')
    .map((entry) => ({
      name: entry.name,
      path: entry.path_display,
      type: entry['.tag'],
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

async function openDropboxPath(path: string, type: 'file' | 'folder'): Promise<void> {
  const token = await getDropboxAccessToken();
  if (!token) {
    throw new Error('Not connected to Dropbox');
  }

  if (type === 'folder') {
    const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    await shell.openExternal(`https://www.dropbox.com/home${encodedPath}`);
    return;
  }

  const response = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox open failed: ${response.statusText}`);
  }

  const raw = await response.json() as unknown;
  if (!raw || typeof raw !== 'object' || typeof (raw as { link?: unknown }).link !== 'string') {
    throw new Error('Dropbox open failed: invalid response shape');
  }
  const data = raw as { link: string };
  await shell.openExternal(data.link);
}

export function registerObjectsIpc(): void {
  // ── Projects ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.PROJECT_LIST, () => {
    try { return ok(listProjects()); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.PROJECT_GET, (_e, id: string) => {
    try {
      const p = getProject(id);
      if (!p) return fail('Project not found');
      return ok(p);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.PROJECT_CREATE, (_e, input: Parameters<typeof createProject>[0]) => {
    try { return ok(createProject(input)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.PROJECT_UPDATE, (_e, id: string, input: Parameters<typeof updateProject>[1]) => {
    try {
      const p = updateProject(id, input);
      if (!p) return fail('Project not found');
      return ok(p);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.PROJECT_DELETE, (_e, id: string) => {
    try { return ok(deleteProject(id)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.PROJECT_BROWSE, async (_e, path = '') => {
    try { return ok(await browseDropbox(path)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.PROJECT_OPEN_FILE, async (_e, path: string, type: 'file' | 'folder') => {
    try {
      await openDropboxPath(path, type);
      return ok(true);
    } catch (e) { return fail(String(e)); }
  });

  // ── Reference Materials ───────────────────────────────────────────────────
  ipcMain.handle(IPC.REF_MAT_LIST, () => {
    try { return ok(listRefMats()); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.REF_MAT_GET, (_e, id: string) => {
    try {
      const r = getRefMat(id);
      if (!r) return fail('Reference material not found');
      return ok(r);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.REF_MAT_CREATE, (_e, input: Parameters<typeof createRefMat>[0]) => {
    try { return ok(createRefMat(input)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.REF_MAT_UPDATE, (_e, id: string, input: Parameters<typeof updateRefMat>[1]) => {
    try {
      const r = updateRefMat(id, input);
      if (!r) return fail('Reference material not found');
      return ok(r);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.REF_MAT_DELETE, (_e, id: string) => {
    try { return ok(deleteRefMat(id)); } catch (e) { return fail(String(e)); }
  });

  // ── Habits ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.HABIT_LIST, (_e, date?: string) => {
    try { return ok(listHabits(date)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.HABIT_GET, (_e, id: string) => {
    try {
      const h = getHabit(id);
      if (!h) return fail('Habit not found');
      return ok(h);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.HABIT_CREATE, (_e, input: Parameters<typeof createHabit>[0]) => {
    try { return ok(createHabit(input)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.HABIT_UPDATE, (_e, id: string, input: Parameters<typeof updateHabit>[1]) => {
    try { return ok(updateHabit(id, input)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.HABIT_DELETE, (_e, id: string) => {
    try { return ok(deleteHabit(id)); } catch (e) { return fail(String(e)); }
  });

  // ── Tags ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.TAG_LIST, () => {
    try { return ok(listTags()); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TAG_GET, (_e, id: string) => {
    try {
      const t = getTag(id);
      if (!t) return fail('Tag not found');
      return ok(t);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TAG_GET_OBJECTS, (_e, id: string) => {
    try {
      const db = getDb();
      const results = db.prepare(`
        SELECT tn.id AS id, 'topic-note' AS type, tn.title AS title, '/topic/' || tn.id AS route
        FROM object_tags ot
        JOIN topic_notes tn ON tn.id = ot.object_id
        WHERE ot.tag_id = ? AND ot.object_type = 'topic-note'
        UNION ALL
        SELECT dn.id AS id, 'daily-note' AS type, dn.date AS title, '/daily/' || dn.date AS route
        FROM object_tags ot
        JOIN daily_notes dn ON dn.id = ot.object_id
        WHERE ot.tag_id = ? AND ot.object_type = 'daily-note'
        UNION ALL
        SELECT p.id AS id, 'project' AS type, p.name AS title, '/projects?focus=' || p.id AS route
        FROM object_tags ot
        JOIN projects p ON p.id = ot.object_id
        WHERE ot.tag_id = ? AND ot.object_type = 'project'
        UNION ALL
        SELECT rm.id AS id, 'ref-material' AS type, rm.name AS title, '/references?focus=' || rm.id AS route
        FROM object_tags ot
        JOIN ref_materials rm ON rm.id = ot.object_id
        WHERE ot.tag_id = ? AND ot.object_type = 'ref-material'
        UNION ALL
        SELECT h.id AS id, 'habit' AS type, h.text AS title, '/habits?focus=' || h.id AS route
        FROM object_tags ot
        JOIN habits h ON h.id = ot.object_id
        WHERE ot.tag_id = ? AND ot.object_type = 'habit'
      `).all(id, id, id, id, id) as TaggedObjectResult[];

      return ok(results);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TAG_CREATE, (_e, input: Parameters<typeof createTag>[0]) => {
    try { return ok(createTag(input)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TAG_UPDATE, (_e, id: string, input: Parameters<typeof updateTag>[1]) => {
    try {
      const t = updateTag(id, input);
      if (!t) return fail('Tag not found');
      return ok(t);
    } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.TAG_DELETE, (_e, id: string) => {
    try { return ok(deleteTag(id)); } catch (e) { return fail(String(e)); }
  });

  // ── Links ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.LINK_GET_FOR_OBJECT, (_e, objectId: string) => {
    try { return ok(getLinksForObject(objectId)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.LINK_CREATE, (_e, input: Parameters<typeof createLink>[0]) => {
    try { return ok(createLink(input)); } catch (e) { return fail(String(e)); }
  });

  ipcMain.handle(IPC.LINK_DELETE, (_e, id: string) => {
    try { return ok(deleteLink(id)); } catch (e) { return fail(String(e)); }
  });

  // ── Search ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SEARCH_ALL, (_e, query: string) => {
    try {
      const db = getDb();
      const q = `%${query}%`;
      const results: Array<{ id: string; type: string; title: string; snippet?: string }> = [];

      const topicRows = db.prepare(
        'SELECT id, title, content_markdown FROM topic_notes WHERE title LIKE ? OR content_markdown LIKE ? LIMIT 20'
      ).all(q, q) as Array<{ id: string; title: string; content_markdown: string }>;
      for (const r of topicRows) {
        results.push({ id: r.id, type: 'topic-note', title: r.title, snippet: r.content_markdown.slice(0, 120) });
      }

      const dailyRows = db.prepare(
        'SELECT id, date, content_markdown FROM daily_notes WHERE content_markdown LIKE ? LIMIT 10'
      ).all(q) as Array<{ id: string; date: string; content_markdown: string }>;
      for (const r of dailyRows) {
        results.push({ id: r.id, type: 'daily-note', title: r.date, snippet: r.content_markdown.slice(0, 120) });
      }

      const projectRows = db.prepare(
        'SELECT id, name FROM projects WHERE name LIKE ? LIMIT 10'
      ).all(q) as Array<{ id: string; name: string }>;
      for (const r of projectRows) {
        results.push({ id: r.id, type: 'project', title: r.name });
      }

      const habitRows = db.prepare(
        'SELECT id, text, date FROM habits WHERE text LIKE ? LIMIT 10'
      ).all(q) as Array<{ id: string; text: string; date: string }>;
      for (const r of habitRows) {
        results.push({ id: r.id, type: 'habit', title: r.text, snippet: r.date });
      }

      const tagRows = db.prepare(
        'SELECT id, display_name FROM tags WHERE display_name LIKE ? LIMIT 10'
      ).all(q) as Array<{ id: string; display_name: string }>;
      for (const r of tagRows) {
        results.push({ id: r.id, type: 'tag', title: r.display_name });
      }

      return ok(results);
    } catch (e) { return fail(String(e)); }
  });
}
