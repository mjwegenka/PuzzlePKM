#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';

const KEYCHAIN_ACCESS_TOKEN = 'dropbox_access_token';
const KEYCHAIN_ACCOUNT_EMAIL = 'dropbox_account_email';
const KEYCHAIN_ROOT_FOLDER = 'dropbox_root_folder';
const KEYCHAIN_APP_KEY = 'dropbox_app_key';
const KEYCHAIN_APP_SECRET = 'dropbox_app_secret';
const MILLISECONDS_PER_MINUTE = 60_000;
const MAX_NOTE_TITLE_LENGTH = 120;
const MAX_HABIT_TEXT_LENGTH = 255;
const SHELL_HISTORY_SIZE = 200;
const DEFAULT_NOTES_ROOT = '/Dropith';
const DAILY_NOTES_SUBFOLDER = 'daily-notes';
const TOPIC_NOTES_SUBFOLDER = 'topic-notes';
const OAUTH_REDIRECT_URI = 'http://localhost:42813/callback';
const SYNC_INTERVAL_MINUTES_DEFAULT = 15;

const schema = `
  CREATE TABLE IF NOT EXISTS topic_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '{}',
    content_markdown TEXT NOT NULL DEFAULT '',
    linked_object_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_notes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '{}',
    content_markdown TEXT NOT NULL DEFAULT '',
    linked_object_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dropbox_path TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ref_materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dropbox_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS object_tags (
    object_id TEXT NOT NULL,
    object_type TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (object_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS object_links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_id, target_id)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(date);
  CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
  CREATE INDEX IF NOT EXISTS idx_object_tags_object ON object_tags(object_id);
  CREATE INDEX IF NOT EXISTS idx_object_tags_tag ON object_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_source ON object_links(source_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_target ON object_links(target_id);
  CREATE INDEX IF NOT EXISTS idx_habits_date ON habits(date);
  CREATE INDEX IF NOT EXISTS idx_topic_notes_title ON topic_notes(title);
`;

function defaultAppDataDir() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'dropith');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'dropith');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'dropith');
}

const appDataDir = defaultAppDataDir();

function secretsFilePath() {
  return join(appDataDir, 'secrets.json');
}

const dbFile = process.env.DROPITH_DB_PATH ?? join(appDataDir, 'dropith.sqlite');

function getIsoNow() {
  return new Date().toISOString();
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * MILLISECONDS_PER_MINUTE;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function normalize(value) {
  return value?.trim() ?? '';
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function titleFromText(text) {
  const title = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return title?.slice(0, MAX_NOTE_TITLE_LENGTH) ?? 'Untitled note';
}

function parseCsv(value) {
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function parseFrontMatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content.trimStart());
  if (!match) return { data: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].replace(/^\n+/, '');
  const data = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const parsed = safeJsonParse(rawValue, []);
      data[key] = Array.isArray(parsed) ? parsed.map(String) : [];
      continue;
    }

    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        data[key] = JSON.parse(rawValue);
      } catch {
        data[key] = rawValue.slice(1, -1);
      }
      continue;
    }

    data[key] = rawValue;
  }

  return { data, body };
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function parseDailyNoteMarkdownForImport(content, fileName) {
  const now = getIsoNow();
  const { data, body } = parseFrontMatter(content);
  const id = normalize(typeof data.id === 'string' ? data.id : '');
  const fallbackDate = /^\d{4}-\d{2}-\d{2}\.md$/i.test(fileName) ? fileName.slice(0, 10) : '';
  const date = normalize(typeof data.date === 'string' ? data.date : fallbackDate);
  const declaredType = normalize(typeof data.type === 'string' ? data.type : '').toLowerCase();

  if (!id) return null;
  if (!date) return null;
  if (declaredType && declaredType !== 'daily-note') return null;

  return {
    id,
    date,
    content: {},
    contentMarkdown: body,
    linkedObjectIds: parseStringList(data.linkedObjectIds),
    tags: parseStringList(data.tags),
    createdAt: normalize(typeof data.createdAt === 'string' ? data.createdAt : now) || now,
    updatedAt: normalize(typeof data.updatedAt === 'string' ? data.updatedAt : now) || now,
  };
}

function parseTopicNoteMarkdownForImport(content) {
  const now = getIsoNow();
  const { data, body } = parseFrontMatter(content);
  const id = normalize(typeof data.id === 'string' ? data.id : '');
  const declaredType = normalize(typeof data.type === 'string' ? data.type : '').toLowerCase();
  const title = normalize(typeof data.title === 'string' ? data.title : '') || titleFromText(body);

  if (!id) return null;
  if (declaredType && declaredType !== 'topic-note') return null;

  return {
    id,
    title,
    content: {},
    contentMarkdown: body,
    linkedObjectIds: parseStringList(data.linkedObjectIds),
    tags: parseStringList(data.tags),
    createdAt: normalize(typeof data.createdAt === 'string' ? data.createdAt : now) || now,
    updatedAt: normalize(typeof data.updatedAt === 'string' ? data.updatedAt : now) || now,
  };
}

function importNotesFromDirectory(type, directoryPath) {
  const targetPath = resolve(directoryPath);
  if (!existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }

  const files = readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
    .map((entry) => join(targetPath, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    return {
      type,
      path: targetPath,
      scanned: 0,
      created: 0,
      updated: 0,
      failed: 0,
      failures: [],
    };
  }

  return withDb((db) => {
    const failures = [];
    let created = 0;
    let updated = 0;

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const content = readFileSync(filePath, 'utf8');
        if (type === 'daily-note') {
          const parsed = parseDailyNoteMarkdownForImport(content, fileName);
          if (!parsed) {
            throw new Error('Daily Note front matter must include both id and date fields');
          }
          const existing = getDailyNote(db, parsed.id) ?? getDailyNote(db, parsed.date);
          if (existing) {
            updateDailyNoteRecord(db, existing.id, parsed);
            updated += 1;
          } else {
            createDailyNoteRecord(db, parsed);
            created += 1;
          }
          continue;
        }

        const parsed = parseTopicNoteMarkdownForImport(content);
        if (!parsed) {
          throw new Error('Topic Note front matter must include an id field');
        }
        const existing = getTopicNote(db, parsed.id);
        if (existing) {
          updateTopicNoteRecord(db, parsed.id, parsed);
          updated += 1;
        } else {
          createTopicNoteRecord(db, parsed);
          created += 1;
        }
      } catch (error) {
        failures.push({
          file: fileName,
          error: String(error instanceof Error ? error.message : error),
        });
      }
    }

    return {
      type,
      path: targetPath,
      scanned: files.length,
      created,
      updated,
      failed: failures.length,
      failures,
    };
  });
}

function withDb(action) {
  const db = openDb();
  try {
    return action(db);
  } finally {
    db.close();
  }
}

function openDb() {
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  ensureSchema(db);
  return db;
}

function ensureSchema(db) {
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    db.prepare(statement).run();
  }
}

function withTransaction(db, action) {
  db.exec('BEGIN');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function withDbAsync(action) {
  const db = openDb();
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

function getTagDisplayNames(db, objectId) {
  const rows = db.prepare(`
    SELECT t.display_name
    FROM object_tags ot
    JOIN tags t ON t.id = ot.tag_id
    WHERE ot.object_id = ?
    ORDER BY t.display_name ASC
  `).all(objectId);
  return rows.map((row) => row.display_name);
}

function ensureTagIds(db, displayNames) {
  const normalizedNames = Array.from(new Set(displayNames.map((name) => name.trim()).filter(Boolean)));
  const ids = [];
  for (const displayName of normalizedNames) {
    const name = displayName.toLowerCase();
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (existing?.id) {
      ids.push(existing.id);
      continue;
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO tags (id, name, display_name, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, displayName, getIsoNow());
    ids.push(id);
  }
  return ids;
}

function syncObjectTags(db, objectId, objectType, tagNames) {
  db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(objectId);
  if (!tagNames) return;
  const tagIds = ensureTagIds(db, tagNames);
  const insert = db.prepare('INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, ?, ?)');
  for (const tagId of tagIds) {
    insert.run(objectId, objectType, tagId);
  }
}

function getTopicNote(db, id) {
  const row = db.prepare('SELECT * FROM topic_notes WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: 'topic-note',
    title: row.title,
    content: safeJsonParse(row.content, {}),
    contentMarkdown: row.content_markdown,
    linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTopicNotes(db) {
  return db.prepare('SELECT id, title, content_markdown, created_at, updated_at FROM topic_notes ORDER BY updated_at DESC').all().map((row) => ({
    id: row.id,
    title: row.title,
    preview: row.content_markdown.slice(0, 80),
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createTopicNoteRecord(db, input) {
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO topic_notes (id, title, content, content_markdown, linked_object_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.title,
      JSON.stringify(input.content ?? {}),
      input.contentMarkdown,
      JSON.stringify(input.linkedObjectIds ?? []),
      input.createdAt,
      input.updatedAt,
    );
    syncObjectTags(db, input.id, 'topic-note', input.tags ?? []);
    return getTopicNote(db, input.id);
  });
}

function updateTopicNoteRecord(db, id, input) {
  const existing = getTopicNote(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];

  if (input.title !== undefined) {
    fields.push('title = ?');
    values.push(input.title);
  }
  if (input.content !== undefined) {
    fields.push('content = ?');
    values.push(JSON.stringify(input.content));
  }
  if (input.contentMarkdown !== undefined) {
    fields.push('content_markdown = ?');
    values.push(input.contentMarkdown);
  }
  if (input.linkedObjectIds !== undefined) {
    fields.push('linked_object_ids = ?');
    values.push(JSON.stringify(input.linkedObjectIds));
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE topic_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'topic-note', input.tags);
    }
    return getTopicNote(db, id);
  });
}

function deleteTopicNoteRecord(db, id) {
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM topic_notes WHERE id = ?').run(id);
    return result.changes > 0;
  });
}

function findDailyNoteRow(db, reference) {
  return db.prepare('SELECT * FROM daily_notes WHERE id = ? OR date = ?').get(reference, reference) ?? null;
}

function mapDailyNote(db, row) {
  return {
    id: row.id,
    type: 'daily-note',
    date: row.date,
    content: safeJsonParse(row.content, {}),
    contentMarkdown: row.content_markdown,
    linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDailyNote(db, reference) {
  const row = findDailyNoteRow(db, reference);
  return row ? mapDailyNote(db, row) : null;
}

function listDailyNotes(db) {
  return db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all().map((row) => ({
    id: row.id,
    date: row.date,
    preview: row.content_markdown.slice(0, 80),
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createDailyNoteRecord(db, input) {
  const existing = db.prepare('SELECT id FROM daily_notes WHERE date = ?').get(input.date);
  if (existing?.id) {
    throw new Error(`A daily note already exists for ${input.date}`);
  }

  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO daily_notes (id, date, content, content_markdown, linked_object_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.date,
      JSON.stringify(input.content ?? {}),
      input.contentMarkdown,
      JSON.stringify(input.linkedObjectIds ?? []),
      input.createdAt,
      input.updatedAt,
    );
    syncObjectTags(db, input.id, 'daily-note', input.tags ?? []);
    return getDailyNote(db, input.id);
  });
}

function updateDailyNoteRecord(db, reference, input) {
  const existing = findDailyNoteRow(db, reference);
  if (!existing) return null;
  const nextDate = input.date ?? existing.date;
  const duplicate = db.prepare('SELECT id FROM daily_notes WHERE date = ? AND id != ?').get(nextDate, existing.id);
  if (duplicate?.id) {
    throw new Error(`A daily note already exists for ${nextDate}`);
  }

  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];

  if (input.date !== undefined) {
    fields.push('date = ?');
    values.push(input.date);
  }
  if (input.content !== undefined) {
    fields.push('content = ?');
    values.push(JSON.stringify(input.content));
  }
  if (input.contentMarkdown !== undefined) {
    fields.push('content_markdown = ?');
    values.push(input.contentMarkdown);
  }
  if (input.linkedObjectIds !== undefined) {
    fields.push('linked_object_ids = ?');
    values.push(JSON.stringify(input.linkedObjectIds));
  }

  values.push(existing.id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE daily_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, existing.id, 'daily-note', input.tags);
    }
    return getDailyNote(db, existing.id);
  });
}

function deleteDailyNoteRecord(db, reference) {
  const existing = findDailyNoteRow(db, reference);
  if (!existing) return false;
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(existing.id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(existing.id, existing.id);
    const result = db.prepare('DELETE FROM daily_notes WHERE id = ?').run(existing.id);
    return result.changes > 0;
  });
}

function getProject(db, id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: 'project',
    name: row.name,
    dropboxPath: row.dropbox_path,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProjects(db) {
  return db.prepare('SELECT * FROM projects ORDER BY name ASC').all().map((row) => ({
    id: row.id,
    name: row.name,
    dropboxPath: row.dropbox_path,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createProjectRecord(db, input) {
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO projects (id, name, dropbox_path, start_date, end_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.dropboxPath, input.startDate || null, input.endDate || null, input.createdAt, input.updatedAt);
    syncObjectTags(db, input.id, 'project', input.tags ?? []);
    return getProject(db, input.id);
  });
}

function updateProjectRecord(db, id, input) {
  const existing = getProject(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];

  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.dropboxPath !== undefined) {
    fields.push('dropbox_path = ?');
    values.push(input.dropboxPath);
  }
  if (input.startDate !== undefined) {
    fields.push('start_date = ?');
    values.push(input.startDate || null);
  }
  if (input.endDate !== undefined) {
    fields.push('end_date = ?');
    values.push(input.endDate || null);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'project', input.tags);
    }
    return getProject(db, id);
  });
}

function deleteProjectRecord(db, id) {
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  });
}

function getRefMat(db, id) {
  const row = db.prepare('SELECT * FROM ref_materials WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: 'ref-material',
    name: row.name,
    dropboxPath: row.dropbox_path,
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listRefMats(db) {
  return db.prepare('SELECT * FROM ref_materials ORDER BY name ASC').all().map((row) => ({
    id: row.id,
    name: row.name,
    dropboxPath: row.dropbox_path,
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createRefMatRecord(db, input) {
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO ref_materials (id, name, dropbox_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.dropboxPath, input.createdAt, input.updatedAt);
    syncObjectTags(db, input.id, 'ref-material', input.tags ?? []);
    return getRefMat(db, input.id);
  });
}

function updateRefMatRecord(db, id, input) {
  const existing = getRefMat(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];

  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.dropboxPath !== undefined) {
    fields.push('dropbox_path = ?');
    values.push(input.dropboxPath);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE ref_materials SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'ref-material', input.tags);
    }
    return getRefMat(db, id);
  });
}

function deleteRefMatRecord(db, id) {
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM ref_materials WHERE id = ?').run(id);
    return result.changes > 0;
  });
}

function getHabit(db, id) {
  const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: 'habit',
    text: row.text,
    date: row.date,
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listHabits(db) {
  return db.prepare('SELECT * FROM habits ORDER BY date DESC, created_at ASC').all().map((row) => ({
    id: row.id,
    text: row.text,
    date: row.date,
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function sanitizeHabitText(text) {
  return text.length > MAX_HABIT_TEXT_LENGTH
    ? { text: text.slice(0, MAX_HABIT_TEXT_LENGTH), truncated: true }
    : { text, truncated: false };
}

function createHabitRecord(db, input) {
  const sanitized = sanitizeHabitText(input.text);
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO habits (id, text, date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, sanitized.text, input.date, input.createdAt, input.updatedAt);
    syncObjectTags(db, input.id, 'habit', input.tags ?? []);
    return { ...getHabit(db, input.id), truncated: sanitized.truncated };
  });
}

function updateHabitRecord(db, id, input) {
  const existing = getHabit(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];
  let truncated = false;

  if (input.text !== undefined) {
    const sanitized = sanitizeHabitText(input.text);
    truncated = sanitized.truncated;
    fields.push('text = ?');
    values.push(sanitized.text);
  }
  if (input.date !== undefined) {
    fields.push('date = ?');
    values.push(input.date);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'habit', input.tags);
    }
    return { ...getHabit(db, id), truncated };
  });
}

function deleteHabitRecord(db, id) {
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM habits WHERE id = ?').run(id);
    return result.changes > 0;
  });
}

function getTag(db, reference) {
  const row = db.prepare('SELECT * FROM tags WHERE id = ? OR name = ?').get(reference, reference.toLowerCase());
  if (!row) return null;
  return {
    id: row.id,
    type: 'tag',
    name: row.name,
    displayName: row.display_name,
    createdAt: row.created_at,
    objects: db.prepare(`
      SELECT object_id, object_type
      FROM object_tags
      WHERE tag_id = ?
      ORDER BY object_type ASC, object_id ASC
    `).all(row.id).map((entry) => ({ id: entry.object_id, type: entry.object_type })),
  };
}

function listTags(db) {
  return db.prepare('SELECT * FROM tags ORDER BY name ASC').all().map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    createdAt: row.created_at,
    objectCount: db.prepare('SELECT COUNT(*) AS count FROM object_tags WHERE tag_id = ?').get(row.id).count,
  }));
}

function createTagRecord(db, displayName) {
  const name = normalize(displayName).toLowerCase();
  if (!name) throw new Error('Tag display name is required');
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
  if (existing?.id) return getTag(db, existing.id);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tags (id, name, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, name, displayName.trim(), getIsoNow());
  return getTag(db, id);
}

function updateTagRecord(db, reference, input) {
  const existing = getTag(db, reference);
  if (!existing) return null;
  const nextDisplayName = normalize(input.displayName);
  if (!nextDisplayName) throw new Error('Tag display name is required');
  const duplicate = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(nextDisplayName.toLowerCase(), existing.id);
  if (duplicate?.id) throw new Error(`Another tag already uses ${nextDisplayName}`);
  db.prepare('UPDATE tags SET name = ?, display_name = ? WHERE id = ?').run(nextDisplayName.toLowerCase(), nextDisplayName, existing.id);
  return getTag(db, existing.id);
}

function deleteTagRecord(db, reference) {
  const existing = getTag(db, reference);
  if (!existing) return false;
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE tag_id = ?').run(existing.id);
    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(existing.id);
    return result.changes > 0;
  });
}

function getLinks(db, objectId) {
  const sql = objectId
    ? 'SELECT * FROM object_links WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM object_links ORDER BY created_at DESC';
  const rows = objectId ? db.prepare(sql).all(objectId, objectId) : db.prepare(sql).all();
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    sourceType: row.source_type,
    targetType: row.target_type,
    createdAt: row.created_at,
  }));
}

function createLinkRecord(db, input) {
  const existing = db.prepare('SELECT * FROM object_links WHERE source_id = ? AND target_id = ?').get(input.sourceId, input.targetId);
  if (existing) {
    return {
      id: existing.id,
      sourceId: existing.source_id,
      targetId: existing.target_id,
      sourceType: existing.source_type,
      targetType: existing.target_type,
      createdAt: existing.created_at,
    };
  }

  db.prepare(`
    INSERT INTO object_links (id, source_id, target_id, source_type, target_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.sourceId, input.targetId, input.sourceType, input.targetType, input.createdAt);
  return getLinks(db).find((link) => link.id === input.id) ?? null;
}

function deleteLinkRecord(db, id) {
  const result = db.prepare('DELETE FROM object_links WHERE id = ?').run(id);
  return result.changes > 0;
}

function listObjects(type) {
  return withDb((db) => {
    switch (type) {
      case 'topic-note': return listTopicNotes(db);
      case 'daily-note': return listDailyNotes(db);
      case 'project': return listProjects(db);
      case 'ref-material': return listRefMats(db);
      case 'habit': return listHabits(db);
      case 'tag': return listTags(db);
      case 'link': return getLinks(db);
      default: throw new Error(`Unsupported type: ${type}`);
    }
  });
}

function getObject(type, reference) {
  return withDb((db) => {
    switch (type) {
      case 'topic-note': return getTopicNote(db, reference);
      case 'daily-note': return getDailyNote(db, reference);
      case 'project': return getProject(db, reference);
      case 'ref-material': return getRefMat(db, reference);
      case 'habit': return getHabit(db, reference);
      case 'tag': return getTag(db, reference);
      case 'link': return getLinks(db).find((link) => link.id === reference) ?? null;
      default: throw new Error(`Unsupported type: ${type}`);
    }
  });
}

function resolveType(token) {
  const value = normalize(token).toLowerCase();
  if (!value) return null;
  const aliases = new Map([
    ['topic-note', 'topic-note'],
    ['topic-notes', 'topic-note'],
    ['note', 'topic-note'],
    ['notes', 'topic-note'],
    ['daily-note', 'daily-note'],
    ['daily-notes', 'daily-note'],
    ['daily', 'daily-note'],
    ['project', 'project'],
    ['projects', 'project'],
    ['ref-material', 'ref-material'],
    ['ref-materials', 'ref-material'],
    ['reference', 'ref-material'],
    ['references', 'ref-material'],
    ['reference-material', 'ref-material'],
    ['reference-materials', 'ref-material'],
    ['habit', 'habit'],
    ['habits', 'habit'],
    ['tag', 'tag'],
    ['tags', 'tag'],
    ['link', 'link'],
    ['links', 'link'],
  ]);
  return aliases.get(value) ?? null;
}

function formatCompact(value) {
  return JSON.stringify(value, null, 2);
}

function printRecords(type, rows) {
  if (!rows.length) {
    console.log(`No ${type} found.`);
    return;
  }

  for (const row of rows) {
    switch (type) {
      case 'topic-note':
        console.log(`${row.id}\t${row.updatedAt}\t${row.title}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'daily-note':
        console.log(`${row.id}\t${row.date}\t${row.preview}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'project':
        console.log(`${row.id}\t${row.name}\t${row.dropboxPath || '(no path)'}`);
        break;
      case 'ref-material':
        console.log(`${row.id}\t${row.name}\t${row.dropboxPath || '(no path)'}`);
        break;
      case 'habit':
        console.log(`${row.id}\t${row.date}\t${row.text}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'tag':
        console.log(`${row.id}\t${row.displayName}\t${row.objectCount} objects`);
        break;
      case 'link':
        console.log(`${row.id}\t${row.sourceType}:${row.sourceId} -> ${row.targetType}:${row.targetId}`);
        break;
      default:
        console.log(formatCompact(row));
    }
  }
}

function printSection(title, rows, type) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  printRecords(type, rows);
}

function browseTarget(target, value) {
  const normalizedTarget = normalize(target).toLowerCase();

  if (!normalizedTarget || normalizedTarget === 'all') {
    withDb((db) => {
      printSection('Topic Notes', listTopicNotes(db), 'topic-note');
      printSection('Daily Notes', listDailyNotes(db), 'daily-note');
      printSection('Projects', listProjects(db), 'project');
      printSection('Reference Materials', listRefMats(db), 'ref-material');
      printSection('Habits', listHabits(db), 'habit');
      printSection('Tags', listTags(db), 'tag');
    });
    return;
  }

  if (normalizedTarget === 'notes') {
    withDb((db) => {
      printSection('Topic Notes', listTopicNotes(db), 'topic-note');
      printSection('Daily Notes', listDailyNotes(db), 'daily-note');
    });
    return;
  }

  if (normalizedTarget === 'directories') {
    withDb((db) => {
      printSection('Projects', listProjects(db), 'project');
      printSection('Reference Materials', listRefMats(db), 'ref-material');
    });
    return;
  }

  if (normalizedTarget === 'files' || normalizedTarget === 'fs') {
    const targetPath = resolve(value || '.');
    if (!existsSync(targetPath)) {
      throw new Error(`Path not found: ${targetPath}`);
    }
    const entries = readdirSync(targetPath, { withFileTypes: true })
      .map((entry) => ({
        kind: entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file',
        name: entry.name,
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    console.log(targetPath);
    if (!entries.length) {
      console.log('(empty directory)');
      return;
    }
    for (const entry of entries) {
      console.log(`${entry.kind}\t${entry.name}`);
    }
    return;
  }

  const type = resolveType(normalizedTarget);
  if (!type) {
    throw new Error(`Unknown browse target: ${target}`);
  }
  printRecords(type, listObjects(type));
}

function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of line) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function readSecretStore() {
  const filePath = secretsFilePath();
  if (!existsSync(filePath)) {
    return { version: 1, values: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const legacyEncrypted = Boolean(parsed?.encrypted);
    const values = {};
    for (const [key, value] of Object.entries(parsed?.values ?? {})) {
      if (typeof value === 'string') {
        values[key] = { payload: value, encrypted: legacyEncrypted };
      } else if (value && typeof value === 'object' && typeof value.payload === 'string') {
        values[key] = { payload: value.payload, encrypted: Boolean(value.encrypted) };
      }
    }
    return { version: 1, values };
  } catch {
    return { version: 1, values: {} };
  }
}

function writeSecretStore(store) {
  const filePath = secretsFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function hasNonEmptyValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function createPromptInterface() {
  return createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY && stdout.isTTY),
    historySize: SHELL_HISTORY_SIZE,
  });
}

function encodeUnencryptedSecret(value) {
  return {
    encrypted: false,
    payload: Buffer.from(value, 'utf8').toString('base64'),
  };
}

function decodeUnencryptedSecret(entry) {
  if (!entry || entry.encrypted) return null;
  try {
    return Buffer.from(entry.payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function getDropboxAccessToken() {
  const store = readSecretStore();
  return decodeUnencryptedSecret(store.values[KEYCHAIN_ACCESS_TOKEN]) ?? null;
}

function getDropboxRootFolder() {
  const store = readSecretStore();
  return decodeUnencryptedSecret(store.values[KEYCHAIN_ROOT_FOLDER]) ?? DEFAULT_NOTES_ROOT;
}

function saveDropboxToken(accessToken, email) {
  const store = readSecretStore();
  store.values[KEYCHAIN_ACCESS_TOKEN] = encodeUnencryptedSecret(accessToken);
  if (email) store.values[KEYCHAIN_ACCOUNT_EMAIL] = encodeUnencryptedSecret(email);
  writeSecretStore(store);
}

function saveDropboxRootFolder(rootFolder) {
  const store = readSecretStore();
  store.values[KEYCHAIN_ROOT_FOLDER] = encodeUnencryptedSecret(rootFolder);
  writeSecretStore(store);
}

function getSettingsState() {
  const store = readSecretStore();
  const keyEntry = store.values[KEYCHAIN_APP_KEY];
  const secretEntry = store.values[KEYCHAIN_APP_SECRET];
  const tokenEntry = store.values[KEYCHAIN_ACCESS_TOKEN];
  const emailEntry = store.values[KEYCHAIN_ACCOUNT_EMAIL];
  const rootEntry = store.values[KEYCHAIN_ROOT_FOLDER];
  const envKey = normalize(process.env.DROPBOX_APP_KEY);
  const envSecret = normalize(process.env.DROPBOX_APP_SECRET);

  const appKeySource = keyEntry ? 'in-app' : (envKey ? 'environment' : 'none');
  const appSecretSource = secretEntry ? 'in-app' : (envSecret ? 'environment' : 'none');
  let source = 'mixed';
  if (appKeySource === 'none' && appSecretSource === 'none') source = 'none';
  else if (appKeySource === 'in-app' && appSecretSource === 'in-app') source = 'in-app';
  else if (appKeySource === 'environment' && appSecretSource === 'environment') source = 'environment';

  return {
    dbPath: dbFile,
    secretsPath: secretsFilePath(),
    dropbox: {
      appKeySet: Boolean(keyEntry || envKey),
      appSecretSet: Boolean(secretEntry || envSecret),
      source,
      isConnected: Boolean(tokenEntry),
      accountEmail: decodeUnencryptedSecret(emailEntry) ?? (emailEntry ? '(stored securely)' : undefined),
      rootFolder: decodeUnencryptedSecret(rootEntry) ?? undefined,
    },
  };
}

function setDropboxSettings(appKey, appSecret) {
  const key = normalize(appKey);
  const secret = normalize(appSecret);
  if (!key || !secret) {
    throw new Error('Both Dropbox App Key and App Secret are required');
  }
  const store = readSecretStore();
  store.values[KEYCHAIN_APP_KEY] = encodeUnencryptedSecret(key);
  store.values[KEYCHAIN_APP_SECRET] = encodeUnencryptedSecret(secret);
  writeSecretStore(store);
  return getSettingsState();
}

function clearDropboxSettings() {
  const store = readSecretStore();
  delete store.values[KEYCHAIN_APP_KEY];
  delete store.values[KEYCHAIN_APP_SECRET];
  writeSecretStore(store);
  return getSettingsState();
}

function disconnectDropboxSettings() {
  const store = readSecretStore();
  delete store.values[KEYCHAIN_ACCESS_TOKEN];
  delete store.values[KEYCHAIN_ACCOUNT_EMAIL];
  delete store.values[KEYCHAIN_ROOT_FOLDER];
  writeSecretStore(store);
  return getSettingsState();
}

// ── Note sync: path helpers ───────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
}

function dailyNoteDropboxPath(rootFolder, date) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${DAILY_NOTES_SUBFOLDER}/${date}.md`;
}

function topicNoteDropboxPath(rootFolder, title, id) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  const slug = slugify(title || 'untitled');
  const shortId = id.slice(0, 8);
  return `${root}/${TOPIC_NOTES_SUBFOLDER}/${slug}-${shortId}.md`;
}

function dailyNotesFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${DAILY_NOTES_SUBFOLDER}`;
}

function topicNotesFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${TOPIC_NOTES_SUBFOLDER}`;
}

// ── Note sync: YAML front matter ──────────────────────────────────────────────

function yamlStringArray(values) {
  if (values.length === 0) return '[]';
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

function serializeFrontMatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${yamlStringArray(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ── Note sync: serialization ──────────────────────────────────────────────────

function dailyNoteToMarkdown(fields) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'daily-note',
    date: fields.date,
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  return fields.contentMarkdown ? `${fm}\n\n${fields.contentMarkdown}` : `${fm}\n`;
}

function topicNoteToMarkdown(fields) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'topic-note',
    title: fields.title,
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  return fields.contentMarkdown ? `${fm}\n\n${fields.contentMarkdown}` : `${fm}\n`;
}

function parseDailyNoteMarkdown(content) {
  const { data, body } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.date !== 'string' || !data.date) return null;
  return {
    id: data.id,
    date: data.date,
    contentMarkdown: body,
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    linkedObjectIds: Array.isArray(data.linkedObjectIds) ? data.linkedObjectIds.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function parseTopicNoteMarkdown(content) {
  const { data, body } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.title !== 'string') return null;
  return {
    id: data.id,
    title: data.title,
    contentMarkdown: body,
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    linkedObjectIds: Array.isArray(data.linkedObjectIds) ? data.linkedObjectIds.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

// ── Dropbox API helpers ───────────────────────────────────────────────────────

async function dropboxUploadText(token, path, content) {
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true }),
    },
    body: content,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox upload failed (${response.status}): ${detail || response.statusText}`);
  }
}

async function dropboxDownloadText(token, path) {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });
  if (response.status === 409) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox download failed (${response.status}): ${detail || response.statusText}`);
  }
  return response.text();
}

async function dropboxEnsureFolder(token, path) {
  const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (!response.ok && response.status !== 409) {
    const detail = await response.text().catch(() => '');
    if (!detail.includes('path/conflict/folder') && !detail.includes('path/conflict')) {
      throw new Error(`Dropbox create_folder failed (${response.status}): ${detail || response.statusText}`);
    }
  }
}

async function dropboxListMdFiles(token, folderPath) {
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath }),
  });
  if (response.status === 409) return [];
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox list_folder failed (${response.status}): ${detail || response.statusText}`);
  }
  const raw = await response.json();
  return raw.entries
    .filter((e) => e['.tag'] === 'file' && e.name.endsWith('.md'))
    .map((e) => ({ name: e.name, path: e.path_display }));
}

async function dropboxGetAccountEmail(token) {
  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return '';
  const data = await response.json();
  return data.email ?? '';
}

// ── Dropbox OAuth helpers ─────────────────────────────────────────────────────

function buildDropboxAuthUrl(appKey, state) {
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    redirect_uri: OAUTH_REDIRECT_URI,
    token_access_type: 'offline',
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeDropboxCode(code, appKey, appSecret) {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: OAUTH_REDIRECT_URI,
    client_id: appKey,
    client_secret: appSecret,
  });
  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok) {
    throw new Error(`Dropbox token exchange failed: ${response.statusText}`);
  }
  return response.json();
}

function openUrlInBrowser(url) {
  try {
    if (platform() === 'darwin') {
      execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    } else if (platform() === 'win32') {
      execSync(`start "" ${JSON.stringify(url)}`, { stdio: 'ignore', shell: true });
    } else {
      execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    }
  } catch {
    // Browser open failed — user can open the URL manually
  }
}

// ── Sync: note list helpers (include full content for upload) ─────────────────

function listDailyNotesForSync(db) {
  return db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all().map((row) => ({
    id: row.id,
    date: row.date,
    contentMarkdown: row.content_markdown,
    linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
    tagNames: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function listTopicNotesForSync(db) {
  return db.prepare('SELECT * FROM topic_notes ORDER BY updated_at DESC').all().map((row) => ({
    id: row.id,
    title: row.title,
    contentMarkdown: row.content_markdown,
    linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
    tagNames: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ── Sync: reconcile helpers ───────────────────────────────────────────────────

async function fetchAllDailyNotesFromDropbox(token, rootFolder) {
  const files = await dropboxListMdFiles(token, dailyNotesFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await dropboxDownloadText(token, f.path);
      return content ? parseDailyNoteMarkdown(content) : null;
    }),
  );
  return settled
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

async function fetchAllTopicNotesFromDropbox(token, rootFolder) {
  const files = await dropboxListMdFiles(token, topicNotesFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await dropboxDownloadText(token, f.path);
      return content ? parseTopicNoteMarkdown(content) : null;
    }),
  );
  return settled
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

async function reconcileDailyNotesDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, errors: [] };

  const dropboxNotes = await fetchAllDailyNotesFromDropbox(token, rootFolder);
  const dropboxByDate = new Map(dropboxNotes.map((n) => [n.date, n]));

  for (const fields of dropboxNotes) {
    try {
      const existing = getDailyNote(db, fields.date);
      if (!existing) {
        createDailyNoteRecord(db, {
          id: fields.id,
          date: fields.date,
          content: {},
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: fields.tagNames,
          createdAt: fields.createdAt,
          updatedAt: fields.updatedAt,
        });
        result.imported++;
      } else if (new Date(fields.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        updateDailyNoteRecord(db, existing.id, {
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: fields.tagNames,
          updatedAt: fields.updatedAt,
        });
        result.updated++;
      }
    } catch (e) {
      result.errors.push(`daily-note ${fields.date}: ${String(e)}`);
    }
  }

  const localNotes = listDailyNotesForSync(db);
  for (const note of localNotes) {
    if (!dropboxByDate.has(note.date)) {
      try {
        await dropboxEnsureFolder(token, dailyNotesFolderPath(rootFolder));
        await dropboxUploadText(token, dailyNoteDropboxPath(rootFolder, note.date), dailyNoteToMarkdown(note));
        result.uploaded++;
      } catch (e) {
        result.errors.push(`daily-note upload ${note.date}: ${String(e)}`);
      }
    }
  }

  return result;
}

async function reconcileTopicNotesDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, errors: [] };

  const dropboxNotes = await fetchAllTopicNotesFromDropbox(token, rootFolder);
  const dropboxById = new Map(dropboxNotes.map((n) => [n.id, n]));

  for (const fields of dropboxNotes) {
    try {
      const existing = getTopicNote(db, fields.id);
      if (!existing) {
        createTopicNoteRecord(db, {
          id: fields.id,
          title: fields.title,
          content: {},
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: fields.tagNames,
          createdAt: fields.createdAt,
          updatedAt: fields.updatedAt,
        });
        result.imported++;
      } else if (new Date(fields.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        updateTopicNoteRecord(db, existing.id, {
          title: fields.title,
          contentMarkdown: fields.contentMarkdown,
          linkedObjectIds: fields.linkedObjectIds,
          tags: fields.tagNames,
          updatedAt: fields.updatedAt,
        });
        result.updated++;
      }
    } catch (e) {
      result.errors.push(`topic-note ${fields.id}: ${String(e)}`);
    }
  }

  const localNotes = listTopicNotesForSync(db);
  for (const note of localNotes) {
    if (!dropboxById.has(note.id)) {
      try {
        await dropboxEnsureFolder(token, topicNotesFolderPath(rootFolder));
        await dropboxUploadText(token, topicNoteDropboxPath(rootFolder, note.title, note.id), topicNoteToMarkdown(note));
        result.uploaded++;
      } catch (e) {
        result.errors.push(`topic-note upload ${note.id}: ${String(e)}`);
      }
    }
  }

  return result;
}

async function runSync() {
  const token = getDropboxAccessToken();
  if (!token) throw new Error('Not connected to Dropbox. Run: dropith auth connect');
  const rootFolder = getDropboxRootFolder();
  return withDbAsync(async (db) => {
    const [dailyResult, topicResult] = await Promise.all([
      reconcileDailyNotesDb(db, token, rootFolder),
      reconcileTopicNotesDb(db, token, rootFolder),
    ]);
    return {
      imported: dailyResult.imported + topicResult.imported,
      updated: dailyResult.updated + topicResult.updated,
      uploaded: dailyResult.uploaded + topicResult.uploaded,
      errors: [...dailyResult.errors, ...topicResult.errors],
    };
  });
}

async function runSyncWatch(intervalMinutes) {
  console.log(`Dropith sync daemon — syncing every ${intervalMinutes} minute(s). Press Ctrl+C to stop.`);

  let running = true;
  process.on('SIGINT', () => {
    running = false;
    stdout.write('\nSync daemon stopping.\n');
  });
  process.on('SIGTERM', () => {
    running = false;
    stdout.write('\nSync daemon stopping.\n');
  });

  while (running) {
    const now = new Date().toISOString();
    process.stdout.write(`[${now}] Syncing...`);
    try {
      const result = await runSync();
      console.log(` done — imported: ${result.imported}, updated: ${result.updated}, uploaded: ${result.uploaded}, errors: ${result.errors.length}`);
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          console.error(`  [error] ${error}`);
        }
      }
    } catch (err) {
      console.log(` failed — ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMinutes * MILLISECONDS_PER_MINUTE));
  }
}

// ── Auth connect ──────────────────────────────────────────────────────────────

async function runAuthConnect() {
  const store = readSecretStore();
  const appKey = decodeUnencryptedSecret(store.values[KEYCHAIN_APP_KEY]) ?? normalize(process.env.DROPBOX_APP_KEY);
  const appSecret = decodeUnencryptedSecret(store.values[KEYCHAIN_APP_SECRET]) ?? normalize(process.env.DROPBOX_APP_SECRET);

  if (!appKey || !appSecret) {
    throw new Error('Dropbox App Key and Secret are not configured. Run: dropith settings set dropbox <key> <secret>');
  }

  const state = randomUUID();
  const authUrl = buildDropboxAuthUrl(appKey, state);

  console.log('\nDropbox OAuth — opening browser for authorization.');
  console.log(`If the browser does not open automatically, visit:\n  ${authUrl}\n`);
  openUrlInBrowser(authUrl);

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/callback') {
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (!code || returnedState !== state) {
        res.end('<html><body>Authorization failed. You can close this window.</body></html>');
        server.close();
        reject(new Error('Invalid OAuth state or missing authorization code'));
        return;
      }

      try {
        const tokens = await exchangeDropboxCode(code, appKey, appSecret);
        const email = await dropboxGetAccountEmail(tokens.access_token);
        saveDropboxToken(tokens.access_token, email);
        res.end('<html><body>Connected to Dropbox! You can close this window.</body></html>');
        server.close();
        resolve({ email });
      } catch (err) {
        res.end('<html><body>Authorization failed. You can close this window.</body></html>');
        server.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.listen(42813, () => {
      console.log('Waiting for Dropbox authorization callback on http://localhost:42813/callback ...');
      console.log('(Timeout in 5 minutes)');
    });

    server.on('error', (err) => reject(err));

    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out after 5 minutes'));
    }, 300_000);
  });
}

async function prompt(rl, label, options = {}) {
  const suffix = options.showDefault && hasNonEmptyValue(options.defaultValue) ? ` [${options.defaultValue}]` : '';
  const hint = options.allowClear ? ' (blank keeps current, - clears)' : '';
  const answer = await rl.question(`${label}${suffix}${hint}: `);
  const trimmed = answer.trim();

  if (!trimmed) {
    if (options.required) {
      console.log(`${label} is required.`);
      return prompt(rl, label, options);
    }
    return options.defaultValue ?? '';
  }

  if (options.allowClear && trimmed === '-') {
    return '';
  }

  return trimmed;
}

async function promptList(rl, label, current = []) {
  const answer = await prompt(rl, label, {
    defaultValue: current.join(', '),
    showDefault: current.length > 0,
    allowClear: true,
  });
  if (answer === current.join(', ')) return current;
  return parseCsv(answer);
}

async function promptYesNo(rl, label, defaultValue = false) {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  const answer = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

function openInEditor(currentContent = '') {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
  const tmpFile = join(tmpdir(), `dropith-edit-${randomUUID()}.md`);
  try {
    writeFileSync(tmpFile, currentContent, 'utf8');
    const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
    if (result.error) throw result.error;
    return readFileSync(tmpFile, 'utf8');
  } finally {
    try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

async function promptMultiline(rl, label, currentValue = null) {
  if (stdin.isTTY) {
    const editorName = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
    console.log(`Opening ${label.toLowerCase()} in ${editorName}...`);
    return openInEditor(currentValue ?? '');
  }

  // Fallback for non-TTY contexts (piped input, CI, etc.)
  if (currentValue !== null) {
    const shouldEdit = await promptYesNo(rl, `${label} (current content will be replaced)`, false);
    if (!shouldEdit) return currentValue;
  }

  console.log(`${label} (finish with a single '.' on its own line)`);
  const lines = [];
  while (true) {
    const line = await rl.question('... ');
    if (line === '.') break;
    lines.push(line);
  }
  return lines.join('\n');
}

async function createObjectInteractive(type, rl) {
  const db = openDb();
  try {
    const createdAt = getIsoNow();
    const updatedAt = createdAt;

    switch (type) {
      case 'topic-note': {
        const title = await prompt(rl, 'Title', { required: true });
        const contentMarkdown = await promptMultiline(rl, 'Content');
        const linkedObjectIds = parseCsv(await prompt(rl, 'Linked object IDs (comma separated)'));
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createTopicNoteRecord(db, {
          id: randomUUID(),
          title,
          content: {},
          contentMarkdown,
          linkedObjectIds,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'daily-note': {
        const date = await prompt(rl, 'Date', { defaultValue: localDateString(), showDefault: true, required: true });
        const contentMarkdown = await promptMultiline(rl, 'Content');
        const linkedObjectIds = parseCsv(await prompt(rl, 'Linked object IDs (comma separated)'));
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createDailyNoteRecord(db, {
          id: randomUUID(),
          date,
          content: {},
          contentMarkdown,
          linkedObjectIds,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'project': {
        const name = await prompt(rl, 'Name', { required: true });
        const dropboxPath = await prompt(rl, 'Dropbox path');
        const startDate = await prompt(rl, 'Start date (YYYY-MM-DD)');
        const endDate = await prompt(rl, 'End date (YYYY-MM-DD)');
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createProjectRecord(db, {
          id: randomUUID(),
          name,
          dropboxPath,
          startDate,
          endDate,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'ref-material': {
        const name = await prompt(rl, 'Name', { required: true });
        const dropboxPath = await prompt(rl, 'Dropbox path');
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createRefMatRecord(db, {
          id: randomUUID(),
          name,
          dropboxPath,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'habit': {
        const text = await prompt(rl, 'Habit text', { required: true });
        const date = await prompt(rl, 'Date', { defaultValue: localDateString(), showDefault: true, required: true });
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createHabitRecord(db, {
          id: randomUUID(),
          text,
          date,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'tag': {
        const displayName = await prompt(rl, 'Tag name', { required: true });
        return createTagRecord(db, displayName);
      }
      case 'link': {
        const sourceType = resolveType(await prompt(rl, 'Source type', { required: true }));
        const sourceId = await prompt(rl, 'Source id', { required: true });
        const targetType = resolveType(await prompt(rl, 'Target type', { required: true }));
        const targetId = await prompt(rl, 'Target id', { required: true });
        if (!sourceType || !targetType || sourceType === 'link' || targetType === 'link') {
          throw new Error('Links require valid non-link object types');
        }
        return createLinkRecord(db, {
          id: randomUUID(),
          sourceId,
          targetId,
          sourceType,
          targetType,
          createdAt,
        });
      }
      default:
        throw new Error(`Unsupported type: ${type}`);
    }
  } finally {
    db.close();
  }
}

async function updateObjectInteractive(type, reference, rl) {
  const db = openDb();
  try {
    switch (type) {
      case 'topic-note': {
        const existing = getTopicNote(db, reference);
        if (!existing) return null;
        const title = await prompt(rl, 'Title', { defaultValue: existing.title, showDefault: true });
        const contentMarkdown = await promptMultiline(rl, 'Content', existing.contentMarkdown);
        const linkedObjectIds = await promptList(rl, 'Linked object IDs (comma separated)', existing.linkedObjectIds);
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateTopicNoteRecord(db, existing.id, {
          title,
          content: existing.content,
          contentMarkdown,
          linkedObjectIds,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'daily-note': {
        const existing = getDailyNote(db, reference);
        if (!existing) return null;
        const date = await prompt(rl, 'Date', { defaultValue: existing.date, showDefault: true });
        const contentMarkdown = await promptMultiline(rl, 'Content', existing.contentMarkdown);
        const linkedObjectIds = await promptList(rl, 'Linked object IDs (comma separated)', existing.linkedObjectIds);
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateDailyNoteRecord(db, existing.id, {
          date,
          content: existing.content,
          contentMarkdown,
          linkedObjectIds,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'project': {
        const existing = getProject(db, reference);
        if (!existing) return null;
        const name = await prompt(rl, 'Name', { defaultValue: existing.name, showDefault: true });
        const dropboxPath = await prompt(rl, 'Dropbox path', { defaultValue: existing.dropboxPath, showDefault: Boolean(existing.dropboxPath), allowClear: true });
        const startDate = await prompt(rl, 'Start date (YYYY-MM-DD)', { defaultValue: existing.startDate, showDefault: Boolean(existing.startDate), allowClear: true });
        const endDate = await prompt(rl, 'End date (YYYY-MM-DD)', { defaultValue: existing.endDate, showDefault: Boolean(existing.endDate), allowClear: true });
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateProjectRecord(db, existing.id, {
          name,
          dropboxPath,
          startDate,
          endDate,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'ref-material': {
        const existing = getRefMat(db, reference);
        if (!existing) return null;
        const name = await prompt(rl, 'Name', { defaultValue: existing.name, showDefault: true });
        const dropboxPath = await prompt(rl, 'Dropbox path', { defaultValue: existing.dropboxPath, showDefault: Boolean(existing.dropboxPath), allowClear: true });
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateRefMatRecord(db, existing.id, {
          name,
          dropboxPath,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'habit': {
        const existing = getHabit(db, reference);
        if (!existing) return null;
        const text = await prompt(rl, 'Habit text', { defaultValue: existing.text, showDefault: true });
        const date = await prompt(rl, 'Date', { defaultValue: existing.date, showDefault: true });
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateHabitRecord(db, existing.id, {
          text,
          date,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'tag': {
        const existing = getTag(db, reference);
        if (!existing) return null;
        const displayName = await prompt(rl, 'Tag name', { defaultValue: existing.displayName, showDefault: true });
        return updateTagRecord(db, existing.id, { displayName });
      }
      default:
        throw new Error(`Interactive update is not supported for ${type}`);
    }
  } finally {
    db.close();
  }
}

function printHelp() {
  console.log(`Dropith CLI

Usage:
  dropith                   Start the interactive shell
  dropith shell             Start the interactive shell
  dropith help              Show help
  dropith add <text>        Quick-create a topic note
  dropith list [type]       List topic notes or another object type
  dropith get <type> <id>   Show one object as JSON
  dropith create <type>     Create an object with guided prompts
  dropith import <type> <dir>
                           Batch import Markdown notes from a directory
  dropith update <type> <id-or-date>
                           Update an object with guided prompts
  dropith delete <type> <id-or-date>
                           Delete an object
  dropith browse [target]   Browse notes, directories, files, or all objects

Dropbox auth:
  dropith auth [status]     Show Dropbox connection status
  dropith auth connect      Authenticate with Dropbox via OAuth (opens browser)
  dropith auth disconnect   Clear stored Dropbox connection token

Sync:
  dropith sync              Sync notes with Dropbox (one-shot)
  dropith sync --watch      Run background sync daemon (default interval: ${SYNC_INTERVAL_MINUTES_DEFAULT}m)
    [--interval <minutes>]    Override sync interval in minutes

Settings:
  dropith settings show     Show CLI-visible app settings
  dropith settings set dropbox [appKey appSecret]
                           Save Dropbox app credentials
  dropith settings set root-folder <path>
                           Set Dropbox root folder (default: ${DEFAULT_NOTES_ROOT})
  dropith settings clear dropbox
                           Clear saved Dropbox app credentials
  dropith settings disconnect dropbox
                           Clear stored Dropbox connection state

Object types:
  topic-note, daily-note, project, ref-material, habit, tag, link

Browse targets:
  all, notes, directories, files, <object-type>

Shell shortcuts:
  Ctrl+C / Ctrl+D           Exit the interactive shell
  Note content editing      Opens in $EDITOR (default: vi); use VIM commands
                            to edit (:w to save, :q to quit, :q! to discard)

Environment:
  DROPITH_DB_PATH           Optional absolute path to a Dropith SQLite database
  DROPBOX_APP_KEY           Dropbox app key fallback for settings state
  DROPBOX_APP_SECRET        Dropbox app secret fallback for settings state
`);
}

async function runSettings(args, rl) {
  const action = normalize(args[0]).toLowerCase();
  const target = normalize(args[1]).toLowerCase();

  if (!action || action === 'show') {
    console.log(formatCompact(getSettingsState()));
    return;
  }

  if (action === 'set' && target === 'dropbox') {
    let appKey = args[2];
    let appSecret = args[3];

    if ((!appKey || !appSecret) && rl) {
      appKey = await prompt(rl, 'Dropbox App Key', { required: true });
      appSecret = await prompt(rl, 'Dropbox App Secret', { required: true });
    }

    console.log(formatCompact(setDropboxSettings(appKey, appSecret)));
    return;
  }

  if (action === 'clear' && target === 'dropbox') {
    console.log(formatCompact(clearDropboxSettings()));
    return;
  }

  if (action === 'disconnect' && target === 'dropbox') {
    console.log(formatCompact(disconnectDropboxSettings()));
    return;
  }

  if (action === 'set' && target === 'root-folder') {
    let folder = normalize(args[2]);
    if (!folder && rl) {
      folder = await prompt(rl, 'Dropbox root folder (e.g. /Dropith)', { required: true });
    }
    if (!folder) throw new Error('Root folder path is required');
    saveDropboxRootFolder(folder);
    console.log(formatCompact(getSettingsState()));
    return;
  }

  throw new Error('Unknown settings command');
}

async function executeTokens(tokens, context = {}) {
  const [command, ...args] = tokens;
  const action = normalize(command).toLowerCase();
  const rl = context.rl ?? null;

  if (!action || action === 'help' || action === '--help' || action === '-h' || action === '?') {
    printHelp();
    return;
  }

  if (action === 'exit' || action === 'quit') {
    console.log('Use Ctrl+C or Ctrl+D to exit the interactive shell.');
    return;
  }

  if (action === 'shell') {
    await startShell();
    return;
  }

  if (action === 'add') {
    const text = args.join(' ').trim();
    if (!text) throw new Error('Please provide note text: dropith add <text>');
    const created = withDb((db) => createTopicNoteRecord(db, {
      id: randomUUID(),
      title: titleFromText(text),
      content: {},
      contentMarkdown: text,
      linkedObjectIds: [],
      tags: [],
      createdAt: getIsoNow(),
      updatedAt: getIsoNow(),
    }));
    console.log(`Added topic note ${created.id}`);
    return;
  }

  if (action === 'list') {
    const type = resolveType(args[0] ?? 'topic-note');
    if (!type) throw new Error(`Unknown type: ${args[0]}`);
    printRecords(type, listObjects(type));
    return;
  }

  if (action === 'get') {
    const type = resolveType(args[0]);
    const reference = args[1];
    if (!type || !reference) throw new Error('Usage: dropith get <type> <id-or-date>');
    const record = getObject(type, reference);
    if (!record) throw new Error(`${type} not found: ${reference}`);
    console.log(formatCompact(record));
    return;
  }

  if (action === 'create') {
    const type = resolveType(args[0]);
    if (!type) throw new Error('Usage: dropith create <type>');
    const promptRl = rl ?? createPromptInterface();
    try {
      const created = await createObjectInteractive(type, promptRl);
      console.log(formatCompact(created));
    } finally {
      if (!rl) promptRl.close();
    }
    return;
  }

  if (action === 'import') {
    const type = resolveType(args[0]);
    const directory = args[1];
    if ((type !== 'daily-note' && type !== 'topic-note') || !directory) {
      throw new Error('Usage: dropith import <daily-note|topic-note> <directory>');
    }
    console.log(formatCompact(importNotesFromDirectory(type, directory)));
    return;
  }

  if (action === 'update') {
    const type = resolveType(args[0]);
    const reference = args[1];
    if (!type || !reference) throw new Error('Usage: dropith update <type> <id-or-date>');
    const promptRl = rl ?? createPromptInterface();
    try {
      const updated = await updateObjectInteractive(type, reference, promptRl);
      if (!updated) throw new Error(`${type} not found: ${reference}`);
      console.log(formatCompact(updated));
    } finally {
      if (!rl) promptRl.close();
    }
    return;
  }

  if (action === 'delete' || action === 'remove') {
    const type = action === 'remove' ? 'topic-note' : resolveType(args[0]);
    const reference = action === 'remove' ? args[0] : args[1];

    if (!type || !reference) {
      const usage = action === 'remove'
        ? 'Usage: dropith remove <id> or dropith delete <type> <id-or-date>'
        : 'Usage: dropith delete <type> <id-or-date>';
      throw new Error(usage);
    }

    const deleted = withDb((db) => {
      switch (type) {
        case 'topic-note': return deleteTopicNoteRecord(db, reference);
        case 'daily-note': return deleteDailyNoteRecord(db, reference);
        case 'project': return deleteProjectRecord(db, reference);
        case 'ref-material': return deleteRefMatRecord(db, reference);
        case 'habit': return deleteHabitRecord(db, reference);
        case 'tag': return deleteTagRecord(db, reference);
        case 'link': return deleteLinkRecord(db, reference);
        default: throw new Error(`Unsupported type: ${type}`);
      }
    });

    if (!deleted) throw new Error(`${type} not found: ${reference}`);
    console.log(`Deleted ${type} ${reference}`);
    return;
  }

  if (action === 'browse') {
    browseTarget(args[0] ?? 'all', args[1]);
    return;
  }

  if (action === 'settings') {
    await runSettings(args, rl);
    return;
  }

  if (action === 'auth') {
    const subAction = normalize(args[0]).toLowerCase();
    if (!subAction || subAction === 'status') {
      console.log(formatCompact(getSettingsState().dropbox));
      return;
    }
    if (subAction === 'connect') {
      const result = await runAuthConnect();
      console.log(`Connected to Dropbox${result.email ? ` as ${result.email}` : ''}.`);
      return;
    }
    if (subAction === 'disconnect') {
      console.log(formatCompact(disconnectDropboxSettings()));
      return;
    }
    throw new Error('Usage: dropith auth [status|connect|disconnect]');
  }

  if (action === 'sync') {
    const watch = args.includes('--watch') || args.includes('--daemon');
    const intervalIdx = args.findIndex((a) => a === '--interval');
    const intervalMinutes = intervalIdx >= 0
      ? (parseInt(args[intervalIdx + 1], 10) || SYNC_INTERVAL_MINUTES_DEFAULT)
      : SYNC_INTERVAL_MINUTES_DEFAULT;

    if (watch) {
      await runSyncWatch(intervalMinutes);
      return;
    }

    console.log('Syncing with Dropbox...');
    const result = await runSync();
    console.log(`Sync complete — imported: ${result.imported}, updated: ${result.updated}, uploaded: ${result.uploaded}, errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(`  [error] ${error}`);
      }
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function startShell() {
  const rl = createPromptInterface();
  let interrupted = false;

  rl.on('SIGINT', () => {
    interrupted = true;
    stdout.write('\nLeaving Dropith shell.\n');
    rl.close();
  });

  console.log('Dropith shell');
  console.log(`Database: ${dbFile}`);
  console.log('Type help for commands. Exit with Ctrl+C or Ctrl+D.');

  try {
    while (true) {
      let line;
      try {
        line = await rl.question('dropith> ');
      } catch {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        await executeTokens(tokenize(trimmed), { rl });
      } catch (error) {
        console.error(String(error instanceof Error ? error.message : error));
      }
    }
  } finally {
    rl.close();
    if (!interrupted) {
      console.log('Leaving Dropith shell.');
    }
  }
}

async function main() {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) {
    await startShell();
    return;
  }

  try {
    await executeTokens(tokens);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

await main();
