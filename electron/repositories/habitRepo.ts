import { getDb } from '../db/db.js';
import type { Habit } from '../../src/shared/types.js';

const MAX_HABIT_LENGTH = 255;

interface HabitRow {
  id: string;
  text: string;
  date: string;
  created_at: string;
  updated_at: string;
}

function rowToHabit(row: HabitRow, tags: string[]): Habit {
  return {
    id: row.id,
    type: 'habit',
    text: row.text,
    date: row.date,
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

function sanitizeText(text: string): { text: string; truncated: boolean } {
  if (text.length > MAX_HABIT_LENGTH) {
    return { text: text.slice(0, MAX_HABIT_LENGTH), truncated: true };
  }
  return { text, truncated: false };
}

export function listHabits(date?: string): Habit[] {
  const db = getDb();
  const rows = date
    ? db.prepare('SELECT * FROM habits WHERE date = ? ORDER BY created_at ASC').all(date) as HabitRow[]
    : db.prepare('SELECT * FROM habits ORDER BY date DESC, created_at ASC').all() as HabitRow[];
  return rows.map((row) => rowToHabit(row, getTagsForObject(row.id)));
}

export function getHabit(id: string): Habit | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as HabitRow | undefined;
  if (!row) return null;
  return rowToHabit(row, getTagsForObject(id));
}

export interface CreateHabitInput {
  id: string;
  text: string;
  date: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createHabit(input: CreateHabitInput): { habit: Habit; truncated: boolean } {
  const db = getDb();
  const { text, truncated } = sanitizeText(input.text);
  const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'habit', ?)`);

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO habits (id, text, date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, text, input.date, input.createdAt, input.updatedAt);
    for (const tagId of input.tags) {
      insertTag.run(input.id, tagId);
    }
  });
  run();
  return { habit: getHabit(input.id)!, truncated };
}

export interface UpdateHabitInput {
  text?: string;
  date?: string;
  tags?: string[];
  updatedAt: string;
}

export function updateHabit(id: string, input: UpdateHabitInput): { habit: Habit | null; truncated: boolean } {
  const db = getDb();
  if (!getHabit(id)) return { habit: null, truncated: false };

  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [input.updatedAt];
  let truncated = false;

  if (input.text !== undefined) {
    const sanitized = sanitizeText(input.text);
    truncated = sanitized.truncated;
    fields.push('text = ?');
    values.push(sanitized.text);
  }
  if (input.date !== undefined) { fields.push('date = ?'); values.push(input.date); }

  values.push(id);

  const run = db.transaction(() => {
    db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'habit', ?)`);
      for (const tagId of input.tags) {
        insertTag.run(id, tagId);
      }
    }
  });
  run();
  return { habit: getHabit(id), truncated };
}

export function deleteHabit(id: string): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM habits WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return run() as boolean;
}
