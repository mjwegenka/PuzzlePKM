import { getDb } from '../db/db.js';
import type { DailyNote } from '../../src/shared/types.js';

interface DailyNoteRow {
  id: string;
  date: string;
  content: string;
  content_markdown: string;
  linked_object_ids: string;
  created_at: string;
  updated_at: string;
}

function rowToDailyNote(row: DailyNoteRow, tags: string[]): DailyNote {
  return {
    id: row.id,
    type: 'daily-note',
    date: row.date,
    content: JSON.parse(row.content || '{}'),
    contentMarkdown: row.content_markdown,
    linkedObjectIds: JSON.parse(row.linked_object_ids || '[]'),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getTagsForObject(id: string): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT tag_id FROM object_tags WHERE object_id = ?').all(id) as { tag_id: string }[];
  return rows.map((r) => r.tag_id);
}

export function listDailyNotes(): DailyNote[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all() as DailyNoteRow[];
  return rows.map((row) => rowToDailyNote(row, getTagsForObject(row.id)));
}

export function getDailyNote(id: string): DailyNote | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM daily_notes WHERE id = ?').get(id) as DailyNoteRow | undefined;
  if (!row) return null;
  return rowToDailyNote(row, getTagsForObject(id));
}

export function getDailyNoteByDate(date: string): DailyNote | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM daily_notes WHERE date = ?').get(date) as DailyNoteRow | undefined;
  if (!row) return null;
  return rowToDailyNote(row, getTagsForObject(row.id));
}

export interface UpsertDailyNoteInput {
  id: string;
  date: string;
  content?: object;
  contentMarkdown?: string;
  linkedObjectIds?: string[];
  tags?: string[];
  now: string;
}

export function upsertDailyNote(input: UpsertDailyNoteInput): DailyNote {
  const db = getDb();
  const existing = getDailyNoteByDate(input.date);

  const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'daily-note', ?)`);
  const deleteTags = db.prepare('DELETE FROM object_tags WHERE object_id = ?');

  if (existing) {
    const fields: string[] = ['updated_at = ?'];
    const values: unknown[] = [input.now];

    if (input.content !== undefined) { fields.push('content = ?'); values.push(JSON.stringify(input.content)); }
    if (input.contentMarkdown !== undefined) { fields.push('content_markdown = ?'); values.push(input.contentMarkdown); }
    if (input.linkedObjectIds !== undefined) { fields.push('linked_object_ids = ?'); values.push(JSON.stringify(input.linkedObjectIds)); }

    values.push(existing.id);

    const run = db.transaction(() => {
      db.prepare(`UPDATE daily_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        deleteTags.run(existing.id);
        for (const tagId of input.tags) {
          insertTag.run(existing.id, tagId);
        }
      }
    });
    run();
    return getDailyNote(existing.id)!;
  } else {
    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO daily_notes (id, date, content, content_markdown, linked_object_ids, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.date,
        JSON.stringify(input.content ?? {}),
        input.contentMarkdown ?? '',
        JSON.stringify(input.linkedObjectIds ?? []),
        input.now,
        input.now
      );
      for (const tagId of input.tags ?? []) {
        insertTag.run(input.id, tagId);
      }
    });
    run();
    return getDailyNote(input.id)!;
  }
}

export function deleteDailyNote(id: string): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM daily_notes WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return run() as boolean;
}
