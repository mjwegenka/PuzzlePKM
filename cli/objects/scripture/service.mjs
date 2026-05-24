export function createScriptureService(deps) {
  const { SCRIPTURE_TYPE, getIsoNow } = deps;

  function ensureScriptureRecord(db, scriptureRef) {
    const existing = db.prepare('SELECT id FROM scriptures WHERE reference = ?').get(scriptureRef.reference);
    if (existing?.id) {
      db.prepare(`
        UPDATE scriptures
        SET book_name = ?, book_order = ?, passage_url = ?, updated_at = ?
        WHERE id = ?
      `).run(scriptureRef.bookName, scriptureRef.bookOrder, scriptureRef.passageUrl, getIsoNow(), existing.id);
      return existing.id;
    }

    const id = deps.randomUUID();
    const now = getIsoNow();
    db.prepare(`
      INSERT INTO scriptures (id, reference, book_name, book_order, passage_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, scriptureRef.reference, scriptureRef.bookName, scriptureRef.bookOrder, scriptureRef.passageUrl, now, now);
    return id;
  }

  function collectScriptureLinkTargets(db, scriptureRefs) {
    const targets = [];
    for (const scriptureRef of scriptureRefs ?? []) {
      const id = ensureScriptureRecord(db, scriptureRef);
      targets.push({ id, type: SCRIPTURE_TYPE });
    }
    return targets;
  }

  return {
    collectScriptureLinkTargets,
    ensureScriptureRecord,
  };
}
