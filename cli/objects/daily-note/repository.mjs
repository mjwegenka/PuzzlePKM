export function createDailyNoteRepository(deps) {
  const {
    assembleMarkdownFromBlocks,
    collectScriptureLinkTargets,
    deriveNoteLinksFromContent,
    getCanonicalNoteContent,
    getCanonicalNoteContentMap,
    getIsoNow,
    getNoteBlocks,
    getRelatedObjects,
    getSyncRootFolder,
    getTagDisplayNames,
    getTagDisplayNamesMap,
    mergeLinkTargets,
    normalize,
    normalizeScriptureBlocks,
    normalizeSyncPath,
    parseBlocksFromMarkdown,
    persistNoteBlocks,
    safeJsonParse,
    syncNoteObjectLinks,
    syncObjectTags,
    dailyNoteSyncPath,
    withTransaction,
  } = deps;

  function findDailyNoteRow(db, reference) {
    return db.prepare('SELECT * FROM daily_notes WHERE id = ? OR date = ?').get(reference, reference) ?? null;
  }

  function stripEmbeddedBlockComments(markdown) {
    return String(markdown ?? '')
      .replace(/\s*<!--\s*blk-[a-f0-9]{12}\s*-->\s*$/gim, '')
      .trim();
  }

  function hasNonEmptyDailyNoteContent(db, row) {
    const blocks = getNoteBlocks(db, row.id);
    if (blocks.length > 0) {
      return blocks.some((block) => normalize(block.contentMarkdown));
    }
    return Boolean(stripEmbeddedBlockComments(row.content_markdown));
  }

  function mapDailyNote(db, row) {
    const { blocks, contentMarkdown } = getCanonicalNoteContent(db, row.id, row.content_markdown);
    return {
      id: row.id,
      type: 'daily-note',
      date: row.date,
      syncPath: row.sync_path || '',
      content: safeJsonParse(row.content, {}),
      contentMarkdown,
      blocks,
      linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
      links: getRelatedObjects(db, row.id, 'forward'),
      backlinks: getRelatedObjects(db, row.id, 'backward'),
      tags: getTagDisplayNames(db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function getDailyNote(db, reference) {
    const row = findDailyNoteRow(db, reference);
    return row ? mapDailyNote(db, row) : null;
  }

  function listDailyNotes(db) {
    const rows = db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all();
    const contentByNoteId = getCanonicalNoteContentMap(db, rows);
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => {
      const contentMarkdown = contentByNoteId.get(row.id)?.contentMarkdown ?? (row.content_markdown ?? '');
      return {
        id: row.id,
        date: row.date,
        syncPath: row.sync_path || '',
        preview: contentMarkdown.slice(0, 80),
        tags: tagNamesByObjectId.get(row.id) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  function createDailyNoteRecordInternal(db, input) {
    const now = input.createdAt ?? getIsoNow();
    const rootFolder = getSyncRootFolder();
    const syncPath = normalizeSyncPath(input.syncPath) || dailyNoteSyncPath(rootFolder, input.date);
    const blocks = Array.isArray(input.blocks) && input.blocks.length > 0
      ? input.blocks
      : parseBlocksFromMarkdown(input.contentMarkdown);
    const contentMarkdown = Array.isArray(blocks) && blocks.length > 0
      ? assembleMarkdownFromBlocks(blocks)
      : (input.contentMarkdown ?? '');
    const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
    const normalizedBlocks = normalizedScripture.blocks;
    const normalizedContentMarkdown = normalizedBlocks.length > 0 ? assembleMarkdownFromBlocks(normalizedBlocks) : '';
    const derivedLinks = deriveNoteLinksFromContent(db, input.id, syncPath, normalizedContentMarkdown);
    const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
    const mergedLinks = mergeLinkTargets(derivedLinks, scriptureLinks);
    db.prepare(`
        INSERT INTO daily_notes (id, date, content, linked_object_ids, sync_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
      input.id,
      input.date,
      JSON.stringify(input.content ?? {}),
      JSON.stringify(mergedLinks.map((target) => target.id)),
      syncPath,
      input.createdAt,
      input.updatedAt,
    );
    syncObjectTags(db, input.id, 'daily-note', input.tags ?? []);
    persistNoteBlocks(db, input.id, 'daily-note', normalizedBlocks, now);
    const removedDailyNoteIds = syncNoteObjectLinks(db, input.id, 'daily-note', mergedLinks);
    deps.cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
    return getDailyNote(db, input.id);
  }

  function createDailyNoteRecord(db, input) {
    const existing = db.prepare('SELECT id FROM daily_notes WHERE date = ?').get(input.date);
    if (existing?.id) {
      throw new Error(`A daily note already exists for ${input.date}`);
    }

    return withTransaction(db, () => createDailyNoteRecordInternal(db, input));
  }

  function updateDailyNoteRecord(db, reference, input) {
    const existing = findDailyNoteRow(db, reference);
    if (!existing) return null;
    const rootFolder = getSyncRootFolder();
    if (input.date !== undefined && input.date !== existing.date) {
      throw new Error(`Daily Note date is immutable (${existing.date}); create or edit the note for ${input.date} instead.`);
    }
    const nextDate = existing.date;

    const updatedAt = input.updatedAt ?? getIsoNow();
    const fields = ['updated_at = ?'];
    const values = [updatedAt];
    const nextSyncPath =
      normalizeSyncPath(input.syncPath !== undefined ? input.syncPath : existing.sync_path)
      || dailyNoteSyncPath(rootFolder, nextDate);
    let derivedLinks;

    if (input.content !== undefined) {
      fields.push('content = ?');
      values.push(JSON.stringify(input.content));
    }
    let updatedBlocks;
    if (Array.isArray(input.blocks) && input.blocks.length > 0) {
      updatedBlocks = input.blocks;
    } else if (input.contentMarkdown !== undefined) {
      updatedBlocks = parseBlocksFromMarkdown(input.contentMarkdown);
    } else if (Array.isArray(input.blocks) && input.blocks.length === 0) {
      updatedBlocks = [];
    }
    if (updatedBlocks !== undefined) {
      const contentMarkdown = Array.isArray(updatedBlocks) && updatedBlocks.length > 0
        ? assembleMarkdownFromBlocks(updatedBlocks)
        : (input.contentMarkdown ?? '');
      const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
      updatedBlocks = normalizedScripture.blocks;
      const normalizedContentMarkdown = updatedBlocks.length > 0 ? assembleMarkdownFromBlocks(updatedBlocks) : '';
      const contentLinks = deriveNoteLinksFromContent(db, existing.id, nextSyncPath, normalizedContentMarkdown);
      const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
      derivedLinks = mergeLinkTargets(contentLinks, scriptureLinks);
      fields.push('linked_object_ids = ?');
      values.push(JSON.stringify(derivedLinks.map((target) => target.id)));
    }
    if (derivedLinks === undefined && input.linkedObjectIds !== undefined) {
      fields.push('linked_object_ids = ?');
      values.push(JSON.stringify(input.linkedObjectIds));
    }
    if (input.syncPath !== undefined || !normalizeSyncPath(existing.sync_path)) {
      fields.push('sync_path = ?');
      values.push(nextSyncPath);
    }

    values.push(existing.id);

    return withTransaction(db, () => {
      db.prepare(`UPDATE daily_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        syncObjectTags(db, existing.id, 'daily-note', input.tags);
      }
      if (updatedBlocks !== undefined) {
        persistNoteBlocks(db, existing.id, 'daily-note', updatedBlocks, updatedAt);
      }
      if (derivedLinks !== undefined) {
        const removedDailyNoteIds = syncNoteObjectLinks(db, existing.id, 'daily-note', derivedLinks);
        deps.cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
      }
      return getDailyNote(db, existing.id);
    });
  }

  function listDailyNotesForSync(db) {
    const rows = db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all();
    const contentByNoteId = getCanonicalNoteContentMap(db, rows);
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => {
      const canonical = contentByNoteId.get(row.id) ?? { blocks: [], contentMarkdown: row.content_markdown ?? '' };
      return {
        id: row.id,
        date: row.date,
        syncPath: row.sync_path || '',
        contentMarkdown: canonical.contentMarkdown,
        blocks: canonical.blocks,
        linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
        tagNames: tagNamesByObjectId.get(row.id) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  return {
    createDailyNoteRecord,
    createDailyNoteRecordInternal,
    findDailyNoteRow,
    getDailyNote,
    hasNonEmptyDailyNoteContent,
    listDailyNotes,
    listDailyNotesForSync,
    mapDailyNote,
    stripEmbeddedBlockComments,
    updateDailyNoteRecord,
  };
}
