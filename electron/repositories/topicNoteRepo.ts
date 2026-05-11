import { getDb } from '../db/db.js';
import type { TopicNote } from '../../src/shared/types.js';

interface TopicNoteRow {
  id: string;
  title: string;
  content: string;
  content_markdown: string;
  linked_object_ids: string;
  created_at: string;
  updated_at: string;
}

function rowToTopicNote(row: TopicNoteRow, tags: string[]): TopicNote {
  return {
    id: row.id,
    type: 'topic-note',
    title: row.title,
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

export function listTopicNotes(): TopicNote[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM topic_notes ORDER BY updated_at DESC').all() as TopicNoteRow[];
  return rows.map((row) => rowToTopicNote(row, getTagsForObject(row.id)));
}

export function getTopicNote(id: string): TopicNote | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM topic_notes WHERE id = ?').get(id) as TopicNoteRow | undefined;
  if (!row) return null;
  return rowToTopicNote(row, getTagsForObject(id));
}

export interface CreateTopicNoteInput {
  id: string;
  title: string;
  content: object;
  contentMarkdown: string;
  linkedObjectIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createTopicNote(input: CreateTopicNoteInput): TopicNote {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO topic_notes (id, title, content, content_markdown, linked_object_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'topic-note', ?)
  `);

  const run = db.transaction(() => {
    insert.run(
      input.id,
      input.title,
      JSON.stringify(input.content),
      input.contentMarkdown,
      JSON.stringify(input.linkedObjectIds),
      input.createdAt,
      input.updatedAt
    );
    for (const tagId of input.tags) {
      insertTag.run(input.id, tagId);
    }
  });

  run();
  return getTopicNote(input.id)!;
}

export interface UpdateTopicNoteInput {
  title?: string;
  content?: object;
  contentMarkdown?: string;
  linkedObjectIds?: string[];
  tags?: string[];
  updatedAt: string;
}

export function updateTopicNote(id: string, input: UpdateTopicNoteInput): TopicNote | null {
  const db = getDb();

  const existing = getTopicNote(id);
  if (!existing) return null;

  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [input.updatedAt];

  if (input.title !== undefined) { fields.push('title = ?'); values.push(input.title); }
  if (input.content !== undefined) { fields.push('content = ?'); values.push(JSON.stringify(input.content)); }
  if (input.contentMarkdown !== undefined) { fields.push('content_markdown = ?'); values.push(input.contentMarkdown); }
  if (input.linkedObjectIds !== undefined) { fields.push('linked_object_ids = ?'); values.push(JSON.stringify(input.linkedObjectIds)); }

  values.push(id);

  const update = db.prepare(`UPDATE topic_notes SET ${fields.join(', ')} WHERE id = ?`);
  const deleteTags = db.prepare('DELETE FROM object_tags WHERE object_id = ?');
  const insertTag = db.prepare(`INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'topic-note', ?)`);

  const run = db.transaction(() => {
    update.run(...values);
    if (input.tags !== undefined) {
      deleteTags.run(id);
      for (const tagId of input.tags) {
        insertTag.run(id, tagId);
      }
    }
  });

  run();
  return getTopicNote(id);
}

export function deleteTopicNote(id: string): boolean {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    const result = db.prepare('DELETE FROM topic_notes WHERE id = ?').run(id);
    return result.changes > 0;
  });
  return run() as boolean;
}
