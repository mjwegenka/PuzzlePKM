import { getDb } from '../db/db.js';
import type { Link, ObjectType } from '../../src/shared/types.js';

interface LinkRow {
  id: string;
  source_id: string;
  target_id: string;
  source_type: string;
  target_type: string;
  created_at: string;
}

function rowToLink(row: LinkRow): Link {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    sourceType: row.source_type as ObjectType,
    targetType: row.target_type as ObjectType,
    createdAt: row.created_at,
  };
}

export function getLinksForObject(objectId: string): Link[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM object_links WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC'
  ).all(objectId, objectId) as LinkRow[];
  return rows.map(rowToLink);
}

export interface CreateLinkInput {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType: ObjectType;
  targetType: ObjectType;
  createdAt: string;
}

export function createLink(input: CreateLinkInput): Link {
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM object_links WHERE source_id = ? AND target_id = ?'
  ).get(input.sourceId, input.targetId) as LinkRow | undefined;

  if (existing) return rowToLink(existing);

  db.prepare(`
    INSERT INTO object_links (id, source_id, target_id, source_type, target_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.sourceId, input.targetId, input.sourceType, input.targetType, input.createdAt);

  return rowToLink(db.prepare('SELECT * FROM object_links WHERE id = ?').get(input.id) as LinkRow);
}

export function deleteLink(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM object_links WHERE id = ?').run(id);
  return result.changes > 0;
}
