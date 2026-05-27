export function createProjectRepository(deps) {
  const { collectDateLinkTargets, getIsoNow, getRelatedObjects, getTagDisplayNames, getTagDisplayNamesMap, syncNoteObjectLinks, syncObjectTags, withTransaction } = deps;

  function getProject(db, id) {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      type: 'project',
      name: row.name,
      syncPath: row.sync_path,
      startDate: row.start_date ?? '',
      endDate: row.end_date ?? '',
      links: getRelatedObjects(db, row.id, 'forward'),
      backlinks: getRelatedObjects(db, row.id, 'backward'),
      tags: getTagDisplayNames(db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listProjects(db) {
    const rows = db.prepare('SELECT * FROM projects ORDER BY name ASC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      syncPath: row.sync_path,
      startDate: row.start_date ?? '',
      endDate: row.end_date ?? '',
      tags: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  function createProjectRecord(db, input) {
    return withTransaction(db, () => {
      db.prepare(`
        INSERT INTO projects (id, name, sync_path, start_date, end_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.name, input.syncPath, input.startDate || null, input.endDate || null, input.createdAt, input.updatedAt);
      syncObjectTags(db, input.id, 'project', input.tags ?? []);
      syncNoteObjectLinks(db, input.id, 'project', collectDateLinkTargets(db, [input.startDate, input.endDate]));
      return getProject(db, input.id);
    });
  }

  function updateProjectRecord(db, id, input) {
    const existing = getProject(db, id);
    if (!existing) return null;
    const fields = ['updated_at = ?'];
    const values = [input.updatedAt ?? getIsoNow()];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.syncPath !== undefined) {
      fields.push('sync_path = ?');
      values.push(input.syncPath);
    }
    if (input.startDate !== undefined) {
      fields.push('start_date = ?');
      values.push(input.startDate || null);
    }
    if (input.endDate !== undefined) {
      fields.push('end_date = ?');
      values.push(input.endDate || null);
    }

    values.push(id);

    return withTransaction(db, () => {
      db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        syncObjectTags(db, id, 'project', input.tags);
      }
      const nextStartDate = input.startDate !== undefined ? input.startDate : existing.startDate;
      const nextEndDate = input.endDate !== undefined ? input.endDate : existing.endDate;
      const removedDailyNoteIds = syncNoteObjectLinks(db, id, 'project', collectDateLinkTargets(db, [nextStartDate, nextEndDate]));
      deps.cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
      return getProject(db, id);
    });
  }

  function deleteProjectRecord(db, id) {
    return withTransaction(db, () => {
      const linkedDailyNoteIds = db
        .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
        .all(id)
        .map((row) => row.target_id);
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
      deps.clearSyncState(db, 'project', id);
      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      deps.cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
      return result.changes > 0;
    });
  }

  function listProjectsForSync(db) {
    const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      syncPath: row.sync_path,
      startDate: row.start_date ?? '',
      endDate: row.end_date ?? '',
      tagNames: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  return {
    createProjectRecord,
    deleteProjectRecord,
    getProject,
    listProjects,
    listProjectsForSync,
    updateProjectRecord,
  };
}
