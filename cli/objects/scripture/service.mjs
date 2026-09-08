export function createScriptureService(deps) {
  const { SCRIPTURE_TYPE, getIsoNow, buildScripturePassageUrl, parseScriptureChapterSegments } = deps;

  // DEC-75: A chapter is the unit readers browse by, so every referenced chapter
  // gets its own row that many verse-level references can point at.
  function ensureScriptureChapterRecord(db, bookName, bookOrder, chapter) {
    const reference = `${bookName} ${chapter}`;
    const existing = db.prepare('SELECT id FROM scripture_chapters WHERE reference = ?').get(reference);
    if (existing?.id) return existing.id;

    const id = deps.randomUUID();
    const now = getIsoNow();
    db.prepare(`
      INSERT INTO scripture_chapters (id, reference, book_name, book_order, chapter, passage_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, reference, bookName, bookOrder, chapter, buildScripturePassageUrl(reference), now, now);
    return id;
  }

  // Rewrites the chapter rollup for one scripture record: the chapters it spans,
  // the verse span within each, and the denormalized primary chapter on the
  // scripture row itself.
  function syncScriptureChapters(db, scriptureId, scriptureRef) {
    const segments = scriptureRef.chapters
      ?? parseScriptureChapterSegments(scriptureRef.bookName, scriptureRef.reference.slice(scriptureRef.bookName.length + 1));

    db.prepare('DELETE FROM scripture_chapter_links WHERE scripture_id = ?').run(scriptureId);

    if (!segments || segments.length === 0) {
      db.prepare(`
        UPDATE scriptures
        SET chapter_id = NULL, chapter = NULL, end_chapter = NULL, verse_start = NULL, verse_end = NULL
        WHERE id = ?
      `).run(scriptureId);
      return;
    }

    const insertLink = db.prepare(`
      INSERT OR REPLACE INTO scripture_chapter_links (scripture_id, chapter_id, verse_start, verse_end)
      VALUES (?, ?, ?, ?)
    `);

    let primaryChapterId = null;
    for (const segment of segments) {
      const chapterId = ensureScriptureChapterRecord(db, scriptureRef.bookName, scriptureRef.bookOrder, segment.chapter);
      insertLink.run(scriptureId, chapterId, segment.verseStart, segment.verseEnd);
      if (primaryChapterId === null) primaryChapterId = chapterId;
    }

    const first = segments[0];
    const last = segments[segments.length - 1];
    db.prepare(`
      UPDATE scriptures
      SET chapter_id = ?, chapter = ?, end_chapter = ?, verse_start = ?, verse_end = ?
      WHERE id = ?
    `).run(primaryChapterId, first.chapter, last.chapter, first.verseStart, first.verseEnd, scriptureId);
  }

  function ensureScriptureRecord(db, scriptureRef) {
    const existing = db.prepare('SELECT id FROM scriptures WHERE reference = ?').get(scriptureRef.reference);
    if (existing?.id) {
      db.prepare(`
        UPDATE scriptures
        SET book_name = ?, book_order = ?, passage_url = ?, updated_at = ?
        WHERE id = ?
      `).run(scriptureRef.bookName, scriptureRef.bookOrder, scriptureRef.passageUrl, getIsoNow(), existing.id);
      syncScriptureChapters(db, existing.id, scriptureRef);
      return existing.id;
    }

    const id = deps.randomUUID();
    const now = getIsoNow();
    db.prepare(`
      INSERT INTO scriptures (id, reference, book_name, book_order, passage_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, scriptureRef.reference, scriptureRef.bookName, scriptureRef.bookOrder, scriptureRef.passageUrl, now, now);
    syncScriptureChapters(db, id, scriptureRef);
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
    ensureScriptureChapterRecord,
    ensureScriptureRecord,
    syncScriptureChapters,
  };
}
