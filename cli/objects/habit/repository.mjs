export function createHabitRepository(deps) {
  const { collectDateLinkTargets, getIsoNow, getTagDisplayNames, getTagDisplayNamesMap, normalizeHabitStatus, normalizeHabitTagNames, syncNoteObjectLinks, syncObjectTags, withTransaction } = deps;

  function getHabit(db, id) {
    const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
    if (!row) return null;
    const tags = getTagDisplayNames(db, row.id);
    return {
      id: row.id,
      type: 'habit',
      text: row.text,
      date: row.date,
      status: normalizeHabitStatus(row.status, deps.HABIT_STATUS_PLANNED),
      syncPath: row.sync_path || '',
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listHabits(db) {
    const rows = db.prepare('SELECT * FROM habits ORDER BY date DESC, created_at ASC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      date: row.date,
      status: normalizeHabitStatus(row.status, deps.HABIT_STATUS_PLANNED),
      syncPath: row.sync_path || '',
      tags: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  function createHabitRecord(db, input) {
    const sanitized = deps.sanitizeHabitText(input.text);
    const tags = normalizeHabitTagNames(input.tags);
    const status = normalizeHabitStatus(input.status, deps.HABIT_STATUS_PLANNED);
    return withTransaction(db, () => {
      const syncPath = input.syncPath || '';
      db.prepare(`
        INSERT INTO habits (id, text, date, status, sync_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, sanitized.text, input.date, status, syncPath, input.createdAt, input.updatedAt);
      syncObjectTags(db, input.id, 'habit', tags);
      syncNoteObjectLinks(db, input.id, 'habit', collectDateLinkTargets(db, [input.date]));
      return { ...getHabit(db, input.id), truncated: sanitized.truncated };
    });
  }

  function updateHabitRecord(db, id, input) {
    const existing = getHabit(db, id);
    if (!existing) return null;
    const fields = ['updated_at = ?'];
    const values = [input.updatedAt ?? getIsoNow()];
    let truncated = false;

    if (input.text !== undefined) {
      const sanitized = deps.sanitizeHabitText(input.text);
      truncated = sanitized.truncated;
      fields.push('text = ?');
      values.push(sanitized.text);
    }
    if (input.date !== undefined) {
      fields.push('date = ?');
      values.push(input.date);
    }
    if (input.status !== undefined) {
      fields.push('status = ?');
      values.push(normalizeHabitStatus(input.status, existing.status));
    }
    if (input.syncPath !== undefined) {
      fields.push('sync_path = ?');
      values.push(input.syncPath);
    }

    values.push(id);

    return withTransaction(db, () => {
      db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        syncObjectTags(db, id, 'habit', normalizeHabitTagNames(input.tags));
      }
      const nextDate = input.date ?? existing.date;
      const removedDailyNoteIds = syncNoteObjectLinks(db, id, 'habit', collectDateLinkTargets(db, [nextDate]));
      deps.cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
      return { ...getHabit(db, id), truncated };
    });
  }

  function deleteHabitRecord(db, id) {
    return withTransaction(db, () => {
      const linkedDailyNoteIds = db
        .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
        .all(id)
        .map((row) => row.target_id);
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
      deps.clearSyncState(db, 'habit', id);
      const result = db.prepare('DELETE FROM habits WHERE id = ?').run(id);
      deps.cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
      return result.changes > 0;
    });
  }

  function listHabitsForSync(db) {
    const rows = db.prepare('SELECT * FROM habits ORDER BY updated_at DESC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => {
      const tags = tagNamesByObjectId.get(row.id) ?? [];
      return {
        id: row.id,
        text: row.text,
        date: row.date,
        status: normalizeHabitStatus(row.status, deps.HABIT_STATUS_PLANNED),
        syncPath: row.sync_path || '',
        tagNames: normalizeHabitTagNames(tags),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  return {
    createHabitRecord,
    deleteHabitRecord,
    getHabit,
    listHabits,
    listHabitsForSync,
    updateHabitRecord,
  };
}
