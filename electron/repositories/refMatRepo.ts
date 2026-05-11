import { getDb } from '../db/db.js';
import type { ReferenceMaterial } from '../../src/shared/types.js';

interface RefMatRow {
  id: string;
  name: string;
  dropbox_path: string;
  created_at: string;
  updated_at: string;
}

function rowToRefMat(row: RefMatRow, tags: string[]): ReferenceMaterial {
  return {
    id: row.id,
    type: 'ref-material',
    name: row.name,
    dropboxPath: row.dropbox_path,
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

export function listRefMats(): ReferenceMaterial[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM ref_materials ORDER BY name ASC').all() as RefMatRow[];
  return rows.map((row) => rowToRefMat(row, getTagsForObject(row.id)));
}

export function getRefMat(id: string): ReferenceMaterial | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ref_materials WHERE id = ?').get(id) as RefMatRow | undefined;
  if (!row) return null;
  return rowToRefMat(row, getTagsForObject(id));
}

export interface CreateRefMatInput {
  id: string;
  name: string;
  dropboxPath: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createRefMat(input: CreateRefMatInput): ReferenceMaterial {
  const db = getDb();
  const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'ref-material', ?)`);

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO ref_materials (id, name, dropbox_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.dropboxPath, input.createdAt, input.updatedAt);
    for (const tagId of input.tags) {
      insertTag.run(input.id, tagId);
    }
  });
  run();
  return getRefMat(input.id)!;
}

export interface UpdateRefMatInput {
  name?: string;
  dropboxPath?: string;
  tags?: string[];
  updatedAt: string;
}

export function updateRefMat(id: string, input: UpdateRefMatInput): ReferenceMaterial | null {
  const db = getDb();
  if (!getRefMat(id)) return null;

  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [input.updatedAt];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.dropboxPath !== undefined) { fields.push('dropbox_path = ?'); values.push(input.dropboxPath); }

  values.push(id);

  const run = db.transaction(() => {
    db.prepare(`UPDATE ref_materials SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'ref-material', ?)`);
      for (const tagId of input.tags) {
        insertTag.run(id, tagId);
      }
    }
  });
  run();
  return getRefMat(id);
}

export function deleteRefMat(id: string): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM ref_materials WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return run() as boolean;
}
