export function createScriptureRepository(deps) {
  const { SCRIPTURE_TYPE, lookupObjectSummary, sortRelatedObjectsStable } = deps;

  function getScriptureLinkedNotes(db, scriptureId) {
    const rows = db.prepare(`
      SELECT source_id AS note_id, source_type AS note_type
      FROM object_links
      WHERE target_id = ?
        AND target_type = ?
        AND source_type IN ('topic-note', 'daily-note')
      ORDER BY source_type ASC, source_id ASC
    `).all(scriptureId, SCRIPTURE_TYPE);
    const linkedNotes = [];
    for (const row of rows) {
      const summary = lookupObjectSummary(db, row.note_id, row.note_type);
      if (!summary) continue;
      linkedNotes.push(summary);
    }
    return sortRelatedObjectsStable(linkedNotes);
  }

  function getScripture(db, reference) {
    const row = db.prepare('SELECT * FROM scriptures WHERE id = ? OR reference = ?').get(reference, reference);
    if (!row) return null;
    return {
      id: row.id,
      type: SCRIPTURE_TYPE,
      reference: row.reference,
      bookName: row.book_name,
      bookOrder: row.book_order,
      passageUrl: row.passage_url,
      linkedNotes: getScriptureLinkedNotes(db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listScriptures(db) {
    return db.prepare(`
      SELECT s.id, s.reference, s.book_name, s.book_order, s.passage_url, s.created_at, s.updated_at,
        COALESCE(link_counts.note_count, 0) AS note_count
      FROM scriptures s
      LEFT JOIN (
        SELECT target_id, COUNT(*) AS note_count
        FROM object_links
        WHERE target_type = ?
          AND source_type IN ('topic-note', 'daily-note')
        GROUP BY target_id
      ) link_counts ON link_counts.target_id = s.id
      ORDER BY s.book_order ASC, s.reference COLLATE NOCASE ASC
    `).all(SCRIPTURE_TYPE).map((row) => ({
      id: row.id,
      type: SCRIPTURE_TYPE,
      reference: row.reference,
      bookName: row.book_name,
      bookOrder: row.book_order,
      passageUrl: row.passage_url,
      noteCount: row.note_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  return {
    getScripture,
    getScriptureLinkedNotes,
    listScriptures,
  };
}
