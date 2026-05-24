export function createLinkRepository() {
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

  return {
    createLinkRecord,
    deleteLinkRecord,
    getLinks,
  };
}
