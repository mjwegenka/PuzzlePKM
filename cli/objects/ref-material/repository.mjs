export function createRefMaterialRepository(deps) {
  const { getIsoNow, getRelatedObjects, getTagDisplayNames, getTagDisplayNamesMap, syncObjectTags, withTransaction } = deps;

  function getRefMat(db, id) {
    const row = db.prepare('SELECT * FROM ref_materials WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      type: 'ref-material',
      name: row.name,
      author: typeof row.author === 'string' ? row.author : '',
      syncPath: row.sync_path,
      links: getRelatedObjects(db, row.id, 'forward'),
      backlinks: getRelatedObjects(db, row.id, 'backward'),
      tags: getTagDisplayNames(db, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function listRefMats(db) {
    const rows = db.prepare('SELECT * FROM ref_materials ORDER BY name ASC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      author: typeof row.author === 'string' ? row.author : '',
      syncPath: row.sync_path,
      tags: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  function createRefMatRecord(db, input) {
    return withTransaction(db, () => {
      db.prepare(`
        INSERT INTO ref_materials (id, name, author, sync_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.id, input.name, input.author ?? null, input.syncPath, input.createdAt, input.updatedAt);
      syncObjectTags(db, input.id, 'ref-material', input.tags ?? []);
      // Auto-register non-empty author in catalog (DEC-29)
      const authorName = typeof input.author === 'string' ? input.author.trim() : '';
      if (authorName) db.prepare('INSERT OR IGNORE INTO authors (name) VALUES (?)').run(authorName);
      return getRefMat(db, input.id);
    });
  }

  function updateRefMatRecord(db, id, input) {
    const existing = getRefMat(db, id);
    if (!existing) return null;
    const fields = ['updated_at = ?'];
    const values = [input.updatedAt ?? getIsoNow()];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.author !== undefined) {
      fields.push('author = ?');
      values.push(input.author || null);
    }
    if (input.syncPath !== undefined) {
      fields.push('sync_path = ?');
      values.push(input.syncPath);
    }

    values.push(id);

    return withTransaction(db, () => {
      db.prepare(`UPDATE ref_materials SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (input.tags !== undefined) {
        syncObjectTags(db, id, 'ref-material', input.tags);
      }
      // Auto-register non-empty author in catalog (DEC-29)
      if (input.author !== undefined) {
        const authorName = typeof input.author === 'string' ? input.author.trim() : '';
        if (authorName) db.prepare('INSERT OR IGNORE INTO authors (name) VALUES (?)').run(authorName);
      }
      return getRefMat(db, id);
    });
  }

  function deleteRefMatRecord(db, id) {
    return withTransaction(db, () => {
      db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
      db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
      deps.clearSyncState(db, 'ref-material', id);
      const result = db.prepare('DELETE FROM ref_materials WHERE id = ?').run(id);
      return result.changes > 0;
    });
  }

  function listRefMaterialsForSync(db) {
    const rows = db.prepare('SELECT * FROM ref_materials ORDER BY updated_at DESC').all();
    const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      author: typeof row.author === 'string' ? row.author : '',
      syncPath: row.sync_path,
      tagNames: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  return {
    createRefMatRecord,
    deleteRefMatRecord,
    getRefMat,
    listRefMaterialsForSync,
    listRefMats,
    updateRefMatRecord,
  };
}
