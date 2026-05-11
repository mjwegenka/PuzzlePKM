import { getDb } from '../db/db.js';
import type { Tag } from '../../src/shared/types.js';

interface TagRow {
  id: string;
  name: string;
  display_name: string;
  created_at: string;
}

function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function listTags(): Tag[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tags ORDER BY name ASC').all() as TagRow[];
  return rows.map(rowToTag);
}

export function getTag(id: string): Tag | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
  if (!row) return null;
  return rowToTag(row);
}

export function getTagByName(name: string): Tag | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tags WHERE name = ?').get(name.toLowerCase()) as TagRow | undefined;
  if (!row) return null;
  return rowToTag(row);
}

export interface CreateTagInput {
  id: string;
  displayName: string;
  createdAt: string;
}

export function createTag(input: CreateTagInput): Tag {
  const db = getDb();
  const name = input.displayName.toLowerCase();

  const existing = getTagByName(name);
  if (existing) return existing;

  db.prepare(`
    INSERT INTO tags (id, name, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(input.id, name, input.displayName, input.createdAt);

  return getTag(input.id)!;
}

export interface UpdateTagInput {
  displayName?: string;
}

export function updateTag(id: string, input: UpdateTagInput): Tag | null {
  const db = getDb();
  if (!getTag(id)) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(input.displayName);
    fields.push('name = ?');
    values.push(input.displayName.toLowerCase());
  }

  if (fields.length === 0) return getTag(id);

  values.push(id);
  db.prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getTag(id);
}

export function deleteTag(id: string): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM object_tags WHERE tag_id = ?').run(id);
    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return run() as boolean;
}
