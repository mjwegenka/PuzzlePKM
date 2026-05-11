import { getDb } from '../db/db.js';
import type { Project } from '../../src/shared/types.js';

interface ProjectRow {
  id: string;
  name: string;
  dropbox_path: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow, tags: string[]): Project {
  return {
    id: row.id,
    type: 'project',
    name: row.name,
    dropboxPath: row.dropbox_path,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
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

export function listProjects(): Project[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM projects ORDER BY name ASC').all() as ProjectRow[];
  return rows.map((row) => rowToProject(row, getTagsForObject(row.id)));
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  if (!row) return null;
  return rowToProject(row, getTagsForObject(id));
}

export interface CreateProjectInput {
  id: string;
  name: string;
  dropboxPath: string;
  startDate?: string;
  endDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createProject(input: CreateProjectInput): Project {
  const db = getDb();
  const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'project', ?)`);

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO projects (id, name, dropbox_path, start_date, end_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.dropboxPath, input.startDate ?? null, input.endDate ?? null, input.createdAt, input.updatedAt);
    for (const tagId of input.tags) {
      insertTag.run(input.id, tagId);
    }
  });
  run();
  return getProject(input.id)!;
}

export interface UpdateProjectInput {
  name?: string;
  dropboxPath?: string;
  startDate?: string;
  endDate?: string;
  tags?: string[];
  updatedAt: string;
}

export function updateProject(id: string, input: UpdateProjectInput): Project | null {
  const db = getDb();
  if (!getProject(id)) return null;

  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [input.updatedAt];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.dropboxPath !== undefined) { fields.push('dropbox_path = ?'); values.push(input.dropboxPath); }
  if (input.startDate !== undefined) { fields.push('start_date = ?'); values.push(input.startDate); }
  if (input.endDate !== undefined) { fields.push('end_date = ?'); values.push(input.endDate); }

  values.push(id);

  const run = db.transaction(() => {
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'project', ?)`);
      for (const tagId of input.tags) {
        insertTag.run(id, tagId);
      }
    }
  });
  run();
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return run() as boolean;
}
