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

  function getScriptureChapters(db, scriptureId) {
    return db.prepare(`
      SELECT c.id, c.reference, c.book_name, c.book_order, c.chapter, c.passage_url,
        l.verse_start, l.verse_end
      FROM scripture_chapter_links l
      JOIN scripture_chapters c ON c.id = l.chapter_id
      WHERE l.scripture_id = ?
      ORDER BY c.book_order ASC, c.chapter ASC
    `).all(scriptureId).map(toChapterSummary);
  }

  function toChapterSummary(row) {
    return {
      id: row.id,
      type: 'scripture-chapter',
      reference: row.reference,
      bookName: row.book_name,
      bookOrder: row.book_order,
      chapter: row.chapter,
      passageUrl: row.passage_url,
      verseStart: row.verse_start ?? null,
      verseEnd: row.verse_end ?? null,
    };
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
      chapterId: row.chapter_id ?? null,
      chapter: row.chapter ?? null,
      endChapter: row.end_chapter ?? null,
      verseStart: row.verse_start ?? null,
      verseEnd: row.verse_end ?? null,
      chapters: getScriptureChapters(db, row.id),
      linkedNotes: getScriptureLinkedNotes(db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listScriptures(db) {
    return db.prepare(`
      SELECT s.id, s.reference, s.book_name, s.book_order, s.passage_url,
        s.chapter_id, s.chapter, s.end_chapter, s.verse_start, s.verse_end,
        s.created_at, s.updated_at,
        COALESCE(link_counts.note_count, 0) AS note_count
      FROM scriptures s
      LEFT JOIN (
        SELECT target_id, COUNT(*) AS note_count
        FROM object_links
        WHERE target_type = ?
          AND source_type IN ('topic-note', 'daily-note')
        GROUP BY target_id
      ) link_counts ON link_counts.target_id = s.id
      ORDER BY s.book_order ASC, s.chapter ASC, s.reference COLLATE NOCASE ASC
    `).all(SCRIPTURE_TYPE).map((row) => ({
      id: row.id,
      type: SCRIPTURE_TYPE,
      reference: row.reference,
      bookName: row.book_name,
      bookOrder: row.book_order,
      passageUrl: row.passage_url,
      chapterId: row.chapter_id ?? null,
      chapter: row.chapter ?? null,
      endChapter: row.end_chapter ?? null,
      verseStart: row.verse_start ?? null,
      verseEnd: row.verse_end ?? null,
      noteCount: row.note_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // DEC-75: The notes citing a chapter, collapsed across every verse-level
  // reference that lands in it — "where is Mark 10 referenced" in one query.
  function getScriptureChapterLinkedNotes(db, chapterId) {
    const rows = db.prepare(`
      SELECT DISTINCT ol.source_id AS note_id, ol.source_type AS note_type
      FROM scripture_chapter_links l
      JOIN object_links ol ON ol.target_id = l.scripture_id AND ol.target_type = ?
      WHERE l.chapter_id = ?
        AND ol.source_type IN ('topic-note', 'daily-note')
      ORDER BY ol.source_type ASC, ol.source_id ASC
    `).all(SCRIPTURE_TYPE, chapterId);
    const linkedNotes = [];
    for (const row of rows) {
      const summary = lookupObjectSummary(db, row.note_id, row.note_type);
      if (!summary) continue;
      linkedNotes.push(summary);
    }
    return sortRelatedObjectsStable(linkedNotes);
  }

  // The individual citations that roll up into a chapter, each with the notes
  // that used that exact reference, so a chapter view can group by verse span.
  function getScriptureChapterReferences(db, chapterId) {
    return db.prepare(`
      SELECT s.id, s.reference, s.passage_url, l.verse_start, l.verse_end,
        COALESCE(link_counts.note_count, 0) AS note_count
      FROM scripture_chapter_links l
      JOIN scriptures s ON s.id = l.scripture_id
      LEFT JOIN (
        SELECT target_id, COUNT(*) AS note_count
        FROM object_links
        WHERE target_type = ?
          AND source_type IN ('topic-note', 'daily-note')
        GROUP BY target_id
      ) link_counts ON link_counts.target_id = s.id
      WHERE l.chapter_id = ?
      ORDER BY
        CASE WHEN l.verse_start IS NULL THEN 0 ELSE 1 END ASC,
        l.verse_start ASC,
        l.verse_end ASC,
        s.reference COLLATE NOCASE ASC
    `).all(SCRIPTURE_TYPE, chapterId).map((row) => ({
      id: row.id,
      type: SCRIPTURE_TYPE,
      reference: row.reference,
      passageUrl: row.passage_url,
      verseStart: row.verse_start ?? null,
      verseEnd: row.verse_end ?? null,
      noteCount: row.note_count ?? 0,
      linkedNotes: getScriptureLinkedNotes(db, row.id),
    }));
  }

  // The chapters on either side of this one within the same book, so a chapter
  // view can be read in sequence rather than only jumped to.
  function getAdjacentScriptureChapters(db, bookName, chapter) {
    const neighbor = (comparison, direction) => {
      const row = db.prepare(`
        SELECT c.id, c.reference, c.book_name, c.book_order, c.chapter, c.passage_url,
          COUNT(DISTINCT ol.source_id) AS note_count
        FROM scripture_chapters c
        LEFT JOIN scripture_chapter_links l ON l.chapter_id = c.id
        LEFT JOIN object_links ol
          ON ol.target_id = l.scripture_id
          AND ol.target_type = ?
          AND ol.source_type IN ('topic-note', 'daily-note')
        WHERE c.book_name = ? AND c.chapter ${comparison} ?
        GROUP BY c.id
        ORDER BY c.chapter ${direction}
        LIMIT 1
      `).get(SCRIPTURE_TYPE, bookName, chapter);
      if (!row) return null;
      return { ...toChapterSummary(row), noteCount: row.note_count ?? 0 };
    };
    return {
      previous: neighbor('<', 'DESC'),
      next: neighbor('>', 'ASC'),
    };
  }

  function getScriptureChapter(db, reference) {
    const row = db.prepare('SELECT * FROM scripture_chapters WHERE id = ? OR reference = ?').get(reference, reference);
    if (!row) return null;
    return {
      ...toChapterSummary(row),
      references: getScriptureChapterReferences(db, row.id),
      linkedNotes: getScriptureChapterLinkedNotes(db, row.id),
      adjacentChapters: getAdjacentScriptureChapters(db, row.book_name, row.chapter),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listScriptureChapters(db) {
    return db.prepare(`
      SELECT c.id, c.reference, c.book_name, c.book_order, c.chapter, c.passage_url,
        c.created_at, c.updated_at,
        COUNT(DISTINCT l.scripture_id) AS reference_count,
        COUNT(DISTINCT ol.source_id) AS note_count
      FROM scripture_chapters c
      LEFT JOIN scripture_chapter_links l ON l.chapter_id = c.id
      LEFT JOIN object_links ol
        ON ol.target_id = l.scripture_id
        AND ol.target_type = ?
        AND ol.source_type IN ('topic-note', 'daily-note')
      GROUP BY c.id
      ORDER BY c.book_order ASC, c.chapter ASC
    `).all(SCRIPTURE_TYPE).map((row) => ({
      id: row.id,
      type: 'scripture-chapter',
      reference: row.reference,
      bookName: row.book_name,
      bookOrder: row.book_order,
      chapter: row.chapter,
      passageUrl: row.passage_url,
      referenceCount: row.reference_count ?? 0,
      noteCount: row.note_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  return {
    getAdjacentScriptureChapters,
    getScripture,
    getScriptureChapter,
    getScriptureChapterLinkedNotes,
    getScriptureChapterReferences,
    getScriptureChapters,
    getScriptureLinkedNotes,
    listScriptureChapters,
    listScriptures,
  };
}
