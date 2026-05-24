export function createDailyNoteService(deps) {
  const {
    createDailyNoteRecord,
    createDailyNoteRecordInternal,
    findDailyNoteRow,
    getDailyNote,
    getIsoNow,
    hasNonEmptyDailyNoteContent,
    isLocalDateString,
    localDateString,
    normalize,
    prompt,
    promptList,
    promptMultiline,
    randomUUID,
    updateDailyNoteRecord,
    withTransaction,
  } = deps;

  function ensureDailyNoteForDate(db, date) {
    const normalizedDate = normalize(date);
    if (!isLocalDateString(normalizedDate)) return null;
    const existing = getDailyNote(db, normalizedDate);
    if (existing) return existing;
    const now = getIsoNow();
    return createDailyNoteRecordInternal(db, {
      id: randomUUID(),
      date: normalizedDate,
      content: {},
      contentMarkdown: '',
      blocks: [],
      linkedObjectIds: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  function isDailyNoteDeleteEligible(db, dailyNoteId) {
    const row = findDailyNoteRow(db, dailyNoteId);
    if (!row) return false;
    if (hasNonEmptyDailyNoteContent(db, row)) return false;
    if (db.prepare('SELECT 1 FROM object_tags WHERE object_id = ? LIMIT 1').get(row.id)) return false;
    if (db.prepare('SELECT 1 FROM object_links WHERE source_id = ? OR target_id = ? LIMIT 1').get(row.id, row.id)) return false;
    return true;
  }

  function forceDeleteDailyNoteRecord(db, dailyNoteId) {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(dailyNoteId);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(dailyNoteId, dailyNoteId);
    db.prepare('DELETE FROM note_blocks WHERE note_id = ?').run(dailyNoteId);
    deps.clearSyncState(db, 'daily-note', dailyNoteId);
    const result = db.prepare('DELETE FROM daily_notes WHERE id = ?').run(dailyNoteId);
    return result.changes > 0;
  }

  function autoDeleteDailyNoteIfEligible(db, dailyNoteId) {
    const row = findDailyNoteRow(db, dailyNoteId);
    if (!row?.id || !isDailyNoteDeleteEligible(db, row.id)) return false;
    return forceDeleteDailyNoteRecord(db, row.id);
  }

  function cleanupDailyNotesIfEligible(db, dailyNoteIds) {
    const seen = new Set();
    for (const dailyNoteId of dailyNoteIds ?? []) {
      const id = normalize(dailyNoteId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      autoDeleteDailyNoteIfEligible(db, id);
    }
  }

  function deleteDailyNoteRecord(db, reference) {
    const existing = findDailyNoteRow(db, reference);
    if (!existing) return false;
    if (!isDailyNoteDeleteEligible(db, existing.id)) {
      throw new Error(`Cannot delete daily note ${existing.date}: clear content/tags and remove links/backlinks first.`);
    }
    return withTransaction(db, () => {
      const linkedScriptureIds = db
        .prepare('SELECT target_id FROM object_links WHERE source_id = ? AND target_type = ?')
        .all(existing.id, deps.SCRIPTURE_TYPE)
        .map((row) => row.target_id);
      const deleted = forceDeleteDailyNoteRecord(db, existing.id);
      deps.cleanupScripturesIfEligible(db, linkedScriptureIds);
      return deleted;
    });
  }

  async function createDailyNoteInteractive(db, rl) {
    const createdAt = getIsoNow();
    const updatedAt = createdAt;
    const date = await prompt(rl, 'Date', { defaultValue: localDateString(), showDefault: true, required: true });
    const contentMarkdown = await promptMultiline(rl, 'Content');
    const linkedObjectIds = parseCsv(await prompt(rl, 'Linked object IDs (comma separated)'));
    const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
    return createDailyNoteRecord(db, {
      id: randomUUID(),
      date,
      content: {},
      contentMarkdown,
      linkedObjectIds,
      tags,
      createdAt,
      updatedAt,
    });
  }

  async function updateDailyNoteInteractive(db, reference, rl) {
    const existing = getDailyNote(db, reference);
    if (!existing) return null;
    const date = await prompt(rl, 'Date', { defaultValue: existing.date, showDefault: true });
    const contentMarkdown = await promptMultiline(rl, 'Content', existing.contentMarkdown);
    const linkedObjectIds = await promptList(rl, 'Linked object IDs (comma separated)', existing.linkedObjectIds);
    const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
    return updateDailyNoteRecord(db, existing.id, {
      date,
      content: existing.content,
      contentMarkdown,
      linkedObjectIds,
      tags,
      updatedAt: getIsoNow(),
    });
  }

  return {
    autoDeleteDailyNoteIfEligible,
    cleanupDailyNotesIfEligible,
    createDailyNoteInteractive,
    deleteDailyNoteRecord,
    ensureDailyNoteForDate,
    forceDeleteDailyNoteRecord,
    isDailyNoteDeleteEligible,
    updateDailyNoteInteractive,
  };
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
