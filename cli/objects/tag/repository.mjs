export function createTagRepository(deps) {
  const { getIsoNow, normalize, withTransaction } = deps;
  const RESERVED_PINNED_TAG = 'pinned';

  /**
   * Enriches a list of { id, type } tagged-object stubs with the title-relevant
   * fields that the front-end objectTypeDefinitions title functions need so that
   * cards in the tag edit view display computed titles instead of generic fallbacks.
   */
  function enrichObjectTitleData(db, entries) {
    if (!entries.length) return [];

    // Group entry ids by type so we can batch-query each table once.
    const byType = {};
    for (const entry of entries) {
      if (!byType[entry.type]) byType[entry.type] = [];
      byType[entry.type].push(entry.id);
    }

    const enrichments = new Map();

    function placeholders(ids) {
      return ids.map(() => '?').join(',');
    }

    if (byType['topic-note']?.length) {
      const ids = byType['topic-note'];
      db.prepare(`SELECT id, title, date FROM topic_notes WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { title: r.title ?? '', date: r.date ?? '' }));
    }
    if (byType['daily-note']?.length) {
      const ids = byType['daily-note'];
      db.prepare(`SELECT id, date FROM daily_notes WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { date: r.date ?? '' }));
    }
    if (byType['habit']?.length) {
      const ids = byType['habit'];
      db.prepare(`SELECT id, text, date FROM habits WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { text: r.text ?? '', date: r.date ?? '', tags: [] }));
      // Fetch habit tags so habitTitle() can use the primary tag in the label.
      const habitTagRows = db.prepare(`
        SELECT ot.object_id, t.display_name
        FROM object_tags ot
        JOIN tags t ON t.id = ot.tag_id
        WHERE ot.object_id IN (${placeholders(ids)})
        ORDER BY ot.object_id ASC, t.name ASC
      `).all(...ids);
      for (const tagRow of habitTagRows) {
        const e = enrichments.get(tagRow.object_id);
        if (e) e.tags.push(tagRow.display_name);
      }
    }
    if (byType['project']?.length) {
      const ids = byType['project'];
      db.prepare(`SELECT id, name FROM projects WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { name: r.name ?? '' }));
    }
    if (byType['ref-material']?.length) {
      const ids = byType['ref-material'];
      db.prepare(`SELECT id, name FROM ref_materials WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { name: r.name ?? '' }));
    }
    if (byType['scripture']?.length) {
      const ids = byType['scripture'];
      db.prepare(`SELECT id, reference FROM scriptures WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { reference: r.reference ?? '' }));
    }
    if (byType['tag']?.length) {
      const ids = byType['tag'];
      db.prepare(`SELECT id, name, display_name FROM tags WHERE id IN (${placeholders(ids)})`).all(...ids)
        .forEach((r) => enrichments.set(r.id, { name: r.name ?? '', displayName: r.display_name ?? '' }));
    }

    return entries.map((entry) => {
      const extra = enrichments.get(entry.id);
      return extra ? { id: entry.id, type: entry.type, ...extra } : { id: entry.id, type: entry.type };
    });
  }

  function getTag(db, reference) {
    const row = db.prepare('SELECT * FROM tags WHERE id = ? OR name = ?').get(reference, reference.toLowerCase());
    if (!row) return null;
    const rawObjects = db.prepare(`
        SELECT object_id, object_type
        FROM object_tags
        WHERE tag_id = ?
        ORDER BY object_type ASC, object_id ASC
      `).all(row.id).map((entry) => ({ id: entry.object_id, type: entry.object_type }));
    return {
      id: row.id,
      type: 'tag',
      name: row.name,
      displayName: row.display_name,
      createdAt: row.created_at,
      objects: enrichObjectTitleData(db, rawObjects),
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
