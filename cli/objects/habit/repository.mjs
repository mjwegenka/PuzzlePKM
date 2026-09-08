import { computeHabitStats, normalizeHabitCadenceMode, normalizeTargetIntervalDays, HABIT_CADENCE_TARGET } from './stats.mjs';

export function createHabitRepository(deps) {
  const {
    collectDateLinkTargets,
    getIsoNow,
    getTagDisplayNames,
    getTagDisplayNamesMap,
    localDateString,
    normalizeHabitState,
    randomUUID,
    syncNoteObjectLinks,
    syncObjectTags,
    withTransaction,
    HABIT_STATE_ACTIVE,
  } = deps;

  function listEntryRows(db, habitId) {
    return db
      .prepare('SELECT id, habit_id, date, note, created_at, updated_at FROM habit_entries WHERE habit_id = ? ORDER BY date ASC')
      .all(habitId);
  }

  function toEntry(row) {
    return {
      id: row.id,
      habitId: row.habit_id,
      date: row.date,
      note: row.note ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function toHabit(row, tags, entries, asOfDate) {
    const habit = {
      id: row.id,
      type: 'habit',
      name: row.name,
      cadenceMode: normalizeHabitCadenceMode(row.cadence_mode),
      targetIntervalDays: normalizeTargetIntervalDays(row.target_interval_days),
      state: normalizeHabitState(row.state, HABIT_STATE_ACTIVE),
      retiredOn: row.retired_on || null,
      syncPath: row.sync_path || '',
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return { ...habit, entries, stats: computeHabitStats(habit, entries, asOfDate ?? localDateString()) };
  }

  /** Accepts an id or, for convenience at the CLI, an exact (case-insensitive) name. */
  function resolveHabitRow(db, reference) {
    const value = String(reference ?? '').trim();
    if (!value) return null;
    return db.prepare('SELECT * FROM habits WHERE id = ?').get(value)
      ?? db.prepare('SELECT * FROM habits WHERE lower(name) = lower(?) ORDER BY created_at ASC').get(value)
      ?? null;
  }

  function getHabit(db, reference, asOfDate) {
    const row = resolveHabitRow(db, reference);
    if (!row) return null;
    const entries = listEntryRows(db, row.id).map(toEntry);
    return toHabit(row, getTagDisplayNames(db, row.id), entries, asOfDate);
  }

  function listHabits(db, options = {}) {
    const { includeRetired = true, asOfDate } = options;
    const rows = db.prepare('SELECT * FROM habits ORDER BY name COLLATE NOCASE ASC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    const entryRows = db
      .prepare('SELECT id, habit_id, date, note, created_at, updated_at FROM habit_entries ORDER BY date ASC')
      .all();
    const entriesByHabitId = new Map();
    for (const row of entryRows) {
      if (!entriesByHabitId.has(row.habit_id)) entriesByHabitId.set(row.habit_id, []);
      entriesByHabitId.get(row.habit_id).push(toEntry(row));
    }
    return rows
      .map((row) => {
        const habit = toHabit(
          row,
          tagNamesByObjectId.get(row.id) ?? [],
          entriesByHabitId.get(row.id) ?? [],
          asOfDate,
        );
        // Search indexes the name; there is no other free text on a practice.
        return { ...habit, contentSearch: habit.name };
      })
      .filter((habit) => includeRetired || habit.state === HABIT_STATE_ACTIVE);
  }

  /** Every date this habit has been practised links it to that day's daily note (DEC-43). */
  function syncHabitDateLinks(db, habitId) {
    const dates = listEntryRows(db, habitId).map((row) => row.date);
    const removedDailyNoteIds = syncNoteObjectLinks(db, habitId, 'habit', collectDateLinkTargets(db, dates));
    deps.cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
  }

  function createHabitRecord(db, input) {
    const name = deps.sanitizeHabitName(input.name);
    const state = normalizeHabitState(input.state, HABIT_STATE_ACTIVE);
    return withTransaction(db, () => {
      const cadenceMode = normalizeHabitCadenceMode(
        input.cadenceMode,
        // A caller that only supplies an interval means "target"; this keeps
        // `write habit '{"targetIntervalDays":30}'` doing the obvious thing.
        normalizeTargetIntervalDays(input.targetIntervalDays) === null ? undefined : HABIT_CADENCE_TARGET,
      );
      db.prepare(`
        INSERT INTO habits (id, name, cadence_mode, target_interval_days, state, retired_on, sync_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        name.text,
        cadenceMode,
        cadenceMode === HABIT_CADENCE_TARGET ? normalizeTargetIntervalDays(input.targetIntervalDays) : null,
        state,
        state === HABIT_STATE_ACTIVE ? null : (input.retiredOn || localDateString()),
        input.syncPath || '',
        input.createdAt,
        input.updatedAt,
      );
      syncObjectTags(db, input.id, 'habit', input.tags ?? []);
      for (const entry of input.entries ?? []) {
        addHabitEntryRow(db, input.id, entry.date, entry.note, entry.id);
      }
      syncHabitDateLinks(db, input.id);
      return { ...getHabit(db, input.id), truncated: name.truncated };
    });
  }

  function updateHabitRecord(db, reference, input) {
    const existing = getHabit(db, reference);
    if (!existing) return null;
    const fields = ['updated_at = ?'];
    const values = [input.updatedAt ?? getIsoNow()];
    let truncated = false;

    if (input.name !== undefined) {
      const name = deps.sanitizeHabitName(input.name);
      truncated = name.truncated;
      fields.push('name = ?');
      values.push(name.text);
    }
    if (input.cadenceMode !== undefined || input.targetIntervalDays !== undefined) {
      const interval = input.targetIntervalDays !== undefined
        ? normalizeTargetIntervalDays(input.targetIntervalDays)
        : existing.targetIntervalDays;
      const cadenceMode = normalizeHabitCadenceMode(
        input.cadenceMode,
        input.targetIntervalDays !== undefined && interval !== null ? HABIT_CADENCE_TARGET : existing.cadenceMode,
      );
      fields.push('cadence_mode = ?');
      values.push(cadenceMode);
      // An interval only means anything under `target`; clearing it elsewhere
      // keeps the row from carrying a number nothing reads.
      fields.push('target_interval_days = ?');
      values.push(cadenceMode === HABIT_CADENCE_TARGET ? interval : null);
    }
    if (input.state !== undefined) {
      const state = normalizeHabitState(input.state, existing.state);
      fields.push('state = ?');
      values.push(state);
      // Retiring stamps the date so history reads correctly later; reactivating clears it.
      fields.push('retired_on = ?');
      values.push(state === HABIT_STATE_ACTIVE ? null : (input.retiredOn || existing.retiredOn || localDateString()));
    }
    if (input.syncPath !== undefined) {
      fields.push('sync_path = ?');
      values.push(input.syncPath);
    }

    values.push(existing.id);

    return withTransaction(db, () => {
      db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        syncObjectTags(db, existing.id, 'habit', input.tags);
      }
      if (Array.isArray(input.entries)) {
        replaceHabitEntries(db, existing.id, input.entries);
      }
      syncHabitDateLinks(db, existing.id);
      return { ...getHabit(db, existing.id), truncated };
    });
  }

  function addHabitEntryRow(db, habitId, date, note, id) {
    const now = getIsoNow();
    db.prepare(`
      INSERT INTO habit_entries (id, habit_id, date, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(habit_id, date) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
    `).run(id || randomUUID(), habitId, date, deps.sanitizeHabitEntryNote(note), now, now);
  }

  /** Logging the same day twice is a no-op rather than an error — it already happened. */
  function addHabitEntry(db, reference, date, note) {
    const habit = resolveHabitRow(db, reference);
    if (!habit) return null;
    const day = String(date ?? '').trim() || localDateString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new Error(`Habit entry date must be YYYY-MM-DD, received "${day}".`);
    }
    return withTransaction(db, () => {
      addHabitEntryRow(db, habit.id, day, note);
      db.prepare('UPDATE habits SET updated_at = ? WHERE id = ?').run(getIsoNow(), habit.id);
      syncHabitDateLinks(db, habit.id);
      return getHabit(db, habit.id);
    });
  }

  function removeHabitEntry(db, reference, date) {
    const habit = resolveHabitRow(db, reference);
    if (!habit) return null;
    const day = String(date ?? '').trim();
    return withTransaction(db, () => {
      db.prepare('DELETE FROM habit_entries WHERE habit_id = ? AND date = ?').run(habit.id, day);
      db.prepare('UPDATE habits SET updated_at = ? WHERE id = ?').run(getIsoNow(), habit.id);
      syncHabitDateLinks(db, habit.id);
      return getHabit(db, habit.id);
    });
  }

  /** Used by sync, where the habit's file is authoritative for the whole log. */
  function replaceHabitEntries(db, habitId, entries) {
    const wanted = new Map();
    for (const entry of entries ?? []) {
      const date = String(entry?.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      wanted.set(date, entry);
    }
    for (const row of listEntryRows(db, habitId)) {
      if (!wanted.has(row.date)) {
        db.prepare('DELETE FROM habit_entries WHERE id = ?').run(row.id);
      }
    }
    for (const [date, entry] of wanted) {
      addHabitEntryRow(db, habitId, date, entry.note, entry.id);
    }
  }

  function deleteHabitRecord(db, reference) {
    const habit = resolveHabitRow(db, reference);
    if (!habit) return false;
    return withTransaction(db, () => {
      const linkedDailyNoteIds = db
        .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
        .all(habit.id)
        .map((row) => row.target_id);
      syncObjectTags(db, habit.id, 'habit', []);
      db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(habit.id, habit.id);
      db.prepare('DELETE FROM habit_entries WHERE habit_id = ?').run(habit.id);
      deps.clearSyncState(db, 'habit', habit.id);
      const result = db.prepare('DELETE FROM habits WHERE id = ?').run(habit.id);
      deps.cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
      return result.changes > 0;
    });
  }

  function listHabitsForSync(db) {
    const rows = db.prepare('SELECT * FROM habits ORDER BY updated_at DESC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cadenceMode: normalizeHabitCadenceMode(row.cadence_mode),
      targetIntervalDays: normalizeTargetIntervalDays(row.target_interval_days),
      state: normalizeHabitState(row.state, HABIT_STATE_ACTIVE),
      retiredOn: row.retired_on || null,
      syncPath: row.sync_path || '',
      tagNames: tagNamesByObjectId.get(row.id) ?? [],
      entries: listEntryRows(db, row.id).map(toEntry),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Every occurrence in a date range, for calendar markers and daily-note lookups. */
  function listHabitEntries(db, { from, to, habitId } = {}) {
    const clauses = [];
    const values = [];
    if (from) { clauses.push('e.date >= ?'); values.push(from); }
    if (to) { clauses.push('e.date <= ?'); values.push(to); }
    if (habitId) { clauses.push('e.habit_id = ?'); values.push(habitId); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
      SELECT e.id, e.habit_id, e.date, e.note, e.created_at, e.updated_at, h.name AS habit_name, h.state AS habit_state
      FROM habit_entries e
      JOIN habits h ON h.id = e.habit_id
      ${where}
      ORDER BY e.date DESC, h.name COLLATE NOCASE ASC
    `).all(...values).map((row) => ({
      ...toEntry(row),
      habitName: row.habit_name,
      habitState: normalizeHabitState(row.habit_state, HABIT_STATE_ACTIVE),
    }));
  }

  return {
    addHabitEntry,
    createHabitRecord,
    deleteHabitRecord,
    getHabit,
    listHabitEntries,
    listHabits,
    listHabitsForSync,
    removeHabitEntry,
    resolveHabitRow,
    updateHabitRecord,
  };
}
