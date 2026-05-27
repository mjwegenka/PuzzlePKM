export function createTagRepository(deps) {
  const { getIsoNow, normalize, withTransaction } = deps;
  const RESERVED_PINNED_TAG = 'pinned';

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
    return db.prepare(`
      SELECT t.id, t.name, t.display_name, t.created_at, COALESCE(ot_counts.object_count, 0) AS object_count
      FROM tags t
      LEFT JOIN (
        SELECT tag_id, COUNT(*) AS object_count
        FROM object_tags
        GROUP BY tag_id
      ) ot_counts ON ot_counts.tag_id = t.id
      ORDER BY t.name ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      createdAt: row.created_at,
      objectCount: row.object_count ?? 0,
    }));
  }

  function createTagRecord(db, displayName) {
    const name = normalize(displayName).toLowerCase();
    if (!name) throw new Error('Tag display name is required');
    if (name === RESERVED_PINNED_TAG) {
      throw new Error('The "Pinned" tag is reserved and cannot be created manually.');
    }
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (existing?.id) return getTag(db, existing.id);
    const id = deps.randomUUID();
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
    if (nextDisplayName.toLowerCase() === RESERVED_PINNED_TAG) {
      throw new Error('The "Pinned" tag is reserved and cannot be set manually.');
    }
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

  return {
    createTagRecord,
    deleteTagRecord,
    getTag,
    listTags,
    updateTagRecord,
  };
}
