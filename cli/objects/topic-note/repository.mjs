export function createTopicNoteRepository(deps) {
  const {
    assembleMarkdownFromBlocks,
    collectDateLinkTargets,
    collectScriptureLinkTargets,
    deriveNoteLinksFromContent,
    getCanonicalNoteContent,
    getCanonicalNoteContentMap,
    getIsoNow,
    getRelatedObjects,
    getSyncRootFolder,
    getTagDisplayNames,
    getTagDisplayNamesMap,
    mergeLinkTargets,
    normalizeScriptureBlocks,
    normalizeSyncPath,
    parseBlocksFromMarkdown,
    persistNoteBlocks,
    safeJsonParse,
    syncNoteObjectLinks,
    syncObjectTags,
    topicNoteSyncPath,
    withTransaction,
    cleanupDailyNotesIfEligible,
    cleanupScripturesIfEligible,
  } = deps;

  function getTopicNote(db, id) {
    const row = db.prepare('SELECT * FROM topic_notes WHERE id = ?').get(id);
    if (!row) return null;
    const { blocks, contentMarkdown } = getCanonicalNoteContent(db, row.id, row.content_markdown);
    return {
      id: row.id,
      type: 'topic-note',
      title: row.title,
      date: row.date || '',
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

  function listTopicNotes(db) {
    const rows = db.prepare('SELECT id, title, date, content_markdown, sync_path, created_at, updated_at FROM topic_notes ORDER BY updated_at DESC').all();
    const contentByNoteId = getCanonicalNoteContentMap(db, rows);
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => {
      const contentMarkdown = contentByNoteId.get(row.id)?.contentMarkdown ?? (row.content_markdown ?? '');
      return {
        id: row.id,
        title: row.title,
        date: row.date || '',
        syncPath: row.sync_path || '',
        preview: contentMarkdown.slice(0, 80),
        tags: tagNamesByObjectId.get(row.id) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  function createTopicNoteRecord(db, input) {
    return withTransaction(db, () => {
      const now = input.createdAt ?? getIsoNow();
      const rootFolder = getSyncRootFolder();
      const syncPath = normalizeSyncPath(input.syncPath) || topicNoteSyncPath(rootFolder, input.title, input.id);
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
      const dateLinks = collectDateLinkTargets(db, [input.date]);
      const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
      const mergedLinks = mergeLinkTargets(derivedLinks, dateLinks, scriptureLinks);
      db.prepare(`
        INSERT INTO topic_notes (id, title, date, content, linked_object_ids, sync_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.title,
        input.date || '',
        JSON.stringify(input.content ?? {}),
        JSON.stringify(mergedLinks.map((target) => target.id)),
        syncPath,
        input.createdAt,
        input.updatedAt,
      );
      syncObjectTags(db, input.id, 'topic-note', input.tags ?? []);
      persistNoteBlocks(db, input.id, 'topic-note', normalizedBlocks, now);
      syncNoteObjectLinks(db, input.id, 'topic-note', mergedLinks);
      return getTopicNote(db, input.id);
    });
  }

  function updateTopicNoteRecord(db, id, input) {
    const existing = getTopicNote(db, id);
    if (!existing) return null;
    const rootFolder = getSyncRootFolder();
    const updatedAt = input.updatedAt ?? getIsoNow();
    const fields = ['updated_at = ?'];
    const values = [updatedAt];
    const nextTitle = input.title ?? existing.title;
    const nextSyncPath =
      normalizeSyncPath(input.syncPath !== undefined ? input.syncPath : existing.syncPath)
      || topicNoteSyncPath(rootFolder, nextTitle, id);
    const nextDate = input.date !== undefined ? (input.date || '') : (existing.date || '');
    let derivedLinks;

    if (input.title !== undefined) {
      fields.push('title = ?');
      values.push(input.title);
    }
    if (input.date !== undefined) {
      fields.push('date = ?');
      values.push(input.date || '');
    }
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
    if (updatedBlocks !== undefined || input.date !== undefined) {
      const contentMarkdown = updatedBlocks !== undefined
        ? (
          Array.isArray(updatedBlocks) && updatedBlocks.length > 0
            ? assembleMarkdownFromBlocks(updatedBlocks)
            : (input.contentMarkdown ?? '')
        )
        : existing.contentMarkdown;
      const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
      updatedBlocks = normalizedScripture.blocks;
      const normalizedContentMarkdown = updatedBlocks.length > 0 ? assembleMarkdownFromBlocks(updatedBlocks) : '';
      const contentLinks = deriveNoteLinksFromContent(db, id, nextSyncPath, normalizedContentMarkdown);
      const dateLinks = collectDateLinkTargets(db, [nextDate]);
      const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
      derivedLinks = mergeLinkTargets(contentLinks, dateLinks, scriptureLinks);
      fields.push('linked_object_ids = ?');
      values.push(JSON.stringify(derivedLinks.map((target) => target.id)));
    }
    if (derivedLinks === undefined && input.linkedObjectIds !== undefined) {
      fields.push('linked_object_ids = ?');
      values.push(JSON.stringify(input.linkedObjectIds));
    }
    if (input.syncPath !== undefined || !normalizeSyncPath(existing.syncPath)) {
      fields.push('sync_path = ?');
      values.push(nextSyncPath);
    }

    values.push(id);

    return withTransaction(db, () => {
      db.prepare(`UPDATE topic_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        syncObjectTags(db, id, 'topic-note', input.tags);
      }
      if (updatedBlocks !== undefined) {
        persistNoteBlocks(db, id, 'topic-note', updatedBlocks, updatedAt);
      }
      if (derivedLinks !== undefined) {
        const removedDailyNoteIds = syncNoteObjectLinks(db, id, 'topic-note', derivedLinks);
        cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
      }
      return getTopicNote(db, id);
    });
  }

  function deleteTopicNoteRecord(db, id) {
    return withTransaction(db, () => {
      const linkedDailyNoteIds = db
        .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
        .all(id)
        .map((row) => row.target_id);
      const linkedScriptureIds = db
        .prepare('SELECT target_id FROM object_links WHERE source_id = ? AND target_type = ?')
        .all(id, deps.SCRIPTURE_TYPE)
        .map((row) => row.target_id);
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
      db.prepare('DELETE FROM note_blocks WHERE note_id = ?').run(id);
      deps.clearSyncState(db, 'topic-note', id);
      const result = db.prepare('DELETE FROM topic_notes WHERE id = ?').run(id);
      cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
      cleanupScripturesIfEligible(db, linkedScriptureIds);
      return result.changes > 0;
    });
  }

  function listTopicNotesForSync(db) {
    const rows = db.prepare('SELECT * FROM topic_notes ORDER BY updated_at DESC').all();
    const contentByNoteId = getCanonicalNoteContentMap(db, rows);
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => {
      const canonical = contentByNoteId.get(row.id) ?? { blocks: [], contentMarkdown: row.content_markdown ?? '' };
      return {
        id: row.id,
        title: row.title,
        date: row.date || '',
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
    createTopicNoteRecord,
    deleteTopicNoteRecord,
    getTopicNote,
    listTopicNotes,
    listTopicNotesForSync,
    updateTopicNoteRecord,
  };
}
