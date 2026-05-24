import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const options = {
    topicNotes: 2000,
    dailyNotes: 1200,
    habits: 800,
    projects: 400,
    refMaterials: 400,
    scriptures: 900,
    tags: 60,
    linksPerTopic: 2,
    runs: 5,
    skipSync: false,
    keepArtifacts: false,
    out: null,
    workspace: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--topic-notes' && next) { options.topicNotes = Number(next); index++; continue; }
    if (token === '--daily-notes' && next) { options.dailyNotes = Number(next); index++; continue; }
    if (token === '--habits' && next) { options.habits = Number(next); index++; continue; }
    if (token === '--projects' && next) { options.projects = Number(next); index++; continue; }
    if (token === '--ref-materials' && next) { options.refMaterials = Number(next); index++; continue; }
    if (token === '--scriptures' && next) { options.scriptures = Number(next); index++; continue; }
    if (token === '--tags' && next) { options.tags = Number(next); index++; continue; }
    if (token === '--links-per-topic' && next) { options.linksPerTopic = Number(next); index++; continue; }
    if (token === '--runs' && next) { options.runs = Number(next); index++; continue; }
    if (token === '--out' && next) { options.out = resolve(next); index++; continue; }
    if (token === '--workspace' && next) { options.workspace = resolve(next); index++; continue; }
    if (token === '--skip-sync') { options.skipSync = true; continue; }
    if (token === '--keep-artifacts') { options.keepArtifacts = true; continue; }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (![options.topicNotes, options.dailyNotes, options.habits, options.projects, options.refMaterials, options.scriptures, options.tags, options.linksPerTopic, options.runs].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('Numeric benchmark arguments must be non-negative numbers.');
  }

  return options;
}

function dateOffset(days) {
  const date = new Date(Date.UTC(2020, 0, 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoOffset(minutes) {
  return new Date(Date.now() - (minutes * 60_000)).toISOString();
}

function toBlockId(seed) {
  return `blk-${seed.toString(16).padStart(12, '0').slice(-12)}`;
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspace = options.workspace ?? mkdtempSync(join(os.tmpdir(), 'puzzlepkm-sqlite-bench-'));
  const homeDir = join(workspace, 'home');
  const syncRoot = join(workspace, 'sync-root');
  const dbPath = join(workspace, 'puzzlepkm-benchmark.sqlite');
  const outputPath = options.out ?? join(workspace, 'sqlite-benchmark-results.json');

  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(syncRoot, { recursive: true });

  process.env.HOME = homeDir;
  process.env.PUZZLEPKM_DB_PATH = dbPath;

  const { __testing } = await import('../cli.mjs');
  __testing.saveSyncRootFolder(syncRoot);

  const db = __testing.openDb();

  const counters = {
    saveRuns: 0,
    backlinkRuns: 0,
  };

  const dataset = {
    topicIds: [],
    dailyIds: [],
    habitIds: [],
    projectIds: [],
    refIds: [],
    scriptureIds: [],
    tagIds: [],
  };

  const statements = {
    insertTopic: db.prepare('INSERT INTO topic_notes (id, title, date, content, linked_object_ids, sync_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    insertDaily: db.prepare('INSERT INTO daily_notes (id, date, content, linked_object_ids, sync_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertHabit: db.prepare('INSERT INTO habits (id, text, date, status, sync_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertProject: db.prepare('INSERT INTO projects (id, name, sync_path, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertRef: db.prepare('INSERT INTO ref_materials (id, name, author, sync_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    insertTag: db.prepare('INSERT INTO tags (id, name, display_name, created_at) VALUES (?, ?, ?, ?)'),
    insertObjectTag: db.prepare('INSERT INTO object_tags (object_id, object_type, tag_id) VALUES (?, ?, ?)'),
    insertScripture: db.prepare('INSERT INTO scriptures (id, reference, book_name, book_order, passage_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insertLink: db.prepare('INSERT INTO object_links (id, source_id, target_id, source_type, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    insertBlock: db.prepare('INSERT INTO note_blocks (note_id, block_id, note_type, position, content_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  };

  db.exec('BEGIN');
  try {
    for (let i = 0; i < options.tags; i++) {
      const id = `tag-${i.toString().padStart(4, '0')}`;
      dataset.tagIds.push(id);
      statements.insertTag.run(id, `tag-${i}`, `Tag ${i}`, isoOffset(i));
    }

    for (let i = 0; i < options.dailyNotes; i++) {
      const id = `daily-${i.toString().padStart(5, '0')}`;
      const date = dateOffset(i);
      dataset.dailyIds.push(id);
      statements.insertDaily.run(id, date, '{}', '[]', `/PuzzlePKM/daily-notes/${date}.md`, isoOffset(i), isoOffset(i));
      statements.insertBlock.run(id, toBlockId(i + 1), 'daily-note', 0, `Daily note ${i}`, isoOffset(i), isoOffset(i));
      const tagA = dataset.tagIds[i % dataset.tagIds.length];
      const tagB = dataset.tagIds[(i + 1) % dataset.tagIds.length];
      statements.insertObjectTag.run(id, 'daily-note', tagA);
      statements.insertObjectTag.run(id, 'daily-note', tagB);
    }

    for (let i = 0; i < options.topicNotes; i++) {
      const id = `topic-${i.toString().padStart(5, '0')}`;
      dataset.topicIds.push(id);
      statements.insertTopic.run(
        id,
        `Topic ${i}`,
        '',
        '{}',
        '[]',
        `/PuzzlePKM/topic-notes/topic-${i}-${id.slice(-8)}.md`,
        isoOffset(i),
        isoOffset(i),
      );
      statements.insertBlock.run(id, toBlockId(i + 50_000), 'topic-note', 0, `Topic note body ${i}`, isoOffset(i), isoOffset(i));
      for (let t = 0; t < 3; t++) {
        const tagId = dataset.tagIds[(i + t) % dataset.tagIds.length];
        statements.insertObjectTag.run(id, 'topic-note', tagId);
      }
    }

    for (let i = 0; i < options.habits; i++) {
      const id = `habit-${i.toString().padStart(5, '0')}`;
      dataset.habitIds.push(id);
      statements.insertHabit.run(id, `Habit ${i}`, dateOffset(i), 'planned', `/PuzzlePKM/habits/${dateOffset(i)}-habit-${i}.md`, isoOffset(i), isoOffset(i));
      statements.insertObjectTag.run(id, 'habit', dataset.tagIds[i % dataset.tagIds.length]);
    }

    for (let i = 0; i < options.projects; i++) {
      const id = `project-${i.toString().padStart(5, '0')}`;
      dataset.projectIds.push(id);
      statements.insertProject.run(id, `Project ${i}`, `/PuzzlePKM/projects/project-${i}`, '', '', isoOffset(i), isoOffset(i));
      statements.insertObjectTag.run(id, 'project', dataset.tagIds[i % dataset.tagIds.length]);
    }

    for (let i = 0; i < options.refMaterials; i++) {
      const id = `ref-${i.toString().padStart(5, '0')}`;
      dataset.refIds.push(id);
      statements.insertRef.run(id, `Reference ${i}`, `Author ${i}`, `/PuzzlePKM/ref-materials/reference-${i}`, isoOffset(i), isoOffset(i));
      statements.insertObjectTag.run(id, 'ref-material', dataset.tagIds[i % dataset.tagIds.length]);
    }

    for (let i = 0; i < options.scriptures; i++) {
      const id = `scripture-${i.toString().padStart(5, '0')}`;
      dataset.scriptureIds.push(id);
      statements.insertScripture.run(id, `John ${i + 1}:1`, 'John', 43, `https://www.biblegateway.com/passage/?search=John+${i + 1}%3A1&version=RSVCE&interface=print`, isoOffset(i), isoOffset(i));
    }

    let linkIndex = 0;
    for (let i = 0; i < dataset.topicIds.length; i++) {
      const sourceId = dataset.topicIds[i];
      const scriptureTarget = dataset.scriptureIds[i % dataset.scriptureIds.length];
      statements.insertLink.run(`link-${linkIndex++}`, sourceId, scriptureTarget, 'topic-note', 'scripture', isoOffset(i));
      if (i < dataset.dailyIds.length) {
        statements.insertLink.run(`link-${linkIndex++}`, sourceId, dataset.dailyIds[i], 'topic-note', 'daily-note', isoOffset(i));
      }
      for (let j = 1; j <= options.linksPerTopic; j++) {
        const targetTopic = dataset.topicIds[(i + j) % dataset.topicIds.length];
        if (targetTopic === sourceId) continue;
        statements.insertLink.run(`link-${linkIndex++}`, sourceId, targetTopic, 'topic-note', 'topic-note', isoOffset(i));
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const rowsForBacklinkTargets = db.prepare('SELECT id, sync_path FROM topic_notes ORDER BY id ASC LIMIT 4').all();
  const backlinkSourceId = rowsForBacklinkTargets[0]?.id;
  const backlinkTargetAPath = rowsForBacklinkTargets[1]?.sync_path;
  const backlinkTargetBPath = rowsForBacklinkTargets[2]?.sync_path;

  function cleanupSavedTopic(id) {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    db.prepare('DELETE FROM note_blocks WHERE note_id = ?').run(id);
    db.prepare('DELETE FROM topic_notes WHERE id = ?').run(id);
    db.prepare('DELETE FROM sync_state WHERE object_id = ? AND object_type = ?').run(id, 'topic-note');
  }

  function measure(name, runCount, fn) {
    const timings = [];
    for (let i = 0; i < runCount; i++) {
      const start = performance.now();
      fn(i);
      timings.push(performance.now() - start);
    }
    return {
      name,
      runs: runCount,
      avgMs: Number(average(timings).toFixed(2)),
      p95Ms: Number(percentile(timings, 95).toFixed(2)),
      minMs: Number(Math.min(...timings).toFixed(2)),
      maxMs: Number(Math.max(...timings).toFixed(2)),
      samplesMs: timings.map((value) => Number(value.toFixed(2))),
    };
  }

  async function measureAsync(name, fn) {
    const start = performance.now();
    const value = await fn();
    const elapsed = performance.now() - start;
    return {
      name,
      runs: 1,
      avgMs: Number(elapsed.toFixed(2)),
      p95Ms: Number(elapsed.toFixed(2)),
      minMs: Number(elapsed.toFixed(2)),
      maxMs: Number(elapsed.toFixed(2)),
      samplesMs: [Number(elapsed.toFixed(2))],
      meta: value,
    };
  }

  const operations = [];

  function listTopicNotesLegacySimulation() {
    const rows = db.prepare('SELECT id, title, date, content_markdown, sync_path, created_at, updated_at FROM topic_notes ORDER BY updated_at DESC').all();
    const getBlocks = db.prepare('SELECT block_id, position, content_markdown FROM note_blocks WHERE note_id = ? ORDER BY position ASC');
    const getTags = db.prepare(`
      SELECT t.display_name
      FROM object_tags ot
      JOIN tags t ON t.id = ot.tag_id
      WHERE ot.object_id = ?
      ORDER BY t.display_name ASC
    `);
    return rows.map((row) => {
      const blocks = getBlocks.all(row.id);
      const contentMarkdown = blocks.length > 0
        ? blocks.map((block) => `${block.content_markdown} <!-- ${block.block_id} -->`).join('\\n\\n')
        : (row.content_markdown ?? '');
      const tags = getTags.all(row.id).map((tagRow) => tagRow.display_name);
      return {
        id: row.id,
        title: row.title,
        date: row.date || '',
        syncPath: row.sync_path || '',
        preview: contentMarkdown.slice(0, 80),
        tags,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  operations.push(measure('list.topic-notes.legacy-simulation', options.runs, () => {
    listTopicNotesLegacySimulation();
  }));

  operations.push(measure('list.topic-notes', options.runs, () => {
    __testing.listTopicNotes(db);
  }));

  operations.push(measure('list.daily-notes', options.runs, () => {
    __testing.listDailyNotes(db);
  }));

  operations.push(measure('list.scriptures', options.runs, () => {
    __testing.listScriptures(db);
  }));

  const getReferenceTopicId = dataset.topicIds[Math.floor(dataset.topicIds.length / 2)];
  operations.push(measure('get.topic-note', options.runs, () => {
    __testing.getTopicNote(db, getReferenceTopicId);
  }));

  operations.push(measure('search.notes-filter', options.runs, () => {
    const term = 'topic 12';
    const matches = __testing
      .listTopicNotes(db)
      .filter((row) => row.title.toLowerCase().includes(term) || row.preview.toLowerCase().includes(term));
    return matches.slice(0, 50);
  }));

  operations.push(measure('save.topic-note', options.runs, () => {
    const id = `benchmark-save-${counters.saveRuns.toString().padStart(4, '0')}`;
    counters.saveRuns++;
    __testing.createTopicNoteRecord(db, {
      id,
      title: `Benchmark Save ${id}`,
      date: '',
      content: {},
      contentMarkdown: `Benchmark content for ${id}`,
      linkedObjectIds: [],
      tags: ['Benchmark', 'Save'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    cleanupSavedTopic(id);
  }));

  if (backlinkSourceId && backlinkTargetAPath && backlinkTargetBPath) {
    operations.push(measure('backlink.refresh.topic-note', options.runs, () => {
      const useSecondTarget = counters.backlinkRuns % 2 === 0;
      counters.backlinkRuns++;
      const targetPath = useSecondTarget ? backlinkTargetBPath : backlinkTargetAPath;
      __testing.updateTopicNoteRecord(db, backlinkSourceId, {
        contentMarkdown: `Backlink refresh run ${counters.backlinkRuns}\n\n[@Target](${targetPath})`,
        updatedAt: new Date().toISOString(),
      });
    }));
  }

  if (!options.skipSync) {
    operations.push(await measureAsync('sync.reconcile', async () => {
      const syncResult = await __testing.runSync();
      return {
        imported: syncResult.imported,
        updated: syncResult.updated,
        uploaded: syncResult.uploaded,
        deleted: syncResult.deleted,
        warnings: syncResult.warnings.length,
        errors: syncResult.errors.length,
      };
    }));
  }

  const queryPlans = {
    listTopicNotes: db.prepare('EXPLAIN QUERY PLAN SELECT id, title, date, content_markdown, sync_path, created_at, updated_at FROM topic_notes ORDER BY updated_at DESC').all(),
    linksBySourceAndType: db.prepare('EXPLAIN QUERY PLAN SELECT source_id, target_id, target_type FROM object_links WHERE source_id = ? AND source_type = ?').all(dataset.topicIds[0], 'topic-note'),
    listScriptures: db.prepare(`EXPLAIN QUERY PLAN
      SELECT s.id, s.reference, s.book_name, s.book_order, s.passage_url, s.created_at, s.updated_at,
        COALESCE(link_counts.note_count, 0) AS note_count
      FROM scriptures s
      LEFT JOIN (
        SELECT target_id, COUNT(*) AS note_count
        FROM object_links
        WHERE target_type = ?
          AND source_type IN ('topic-note', 'daily-note')
        GROUP BY target_id
      ) link_counts ON link_counts.target_id = s.id
      ORDER BY s.book_order ASC, s.reference COLLATE NOCASE ASC
    `).all('scripture'),
  };

  const ordered = [...operations].sort((a, b) => b.avgMs - a.avgMs);
  const results = {
    generatedAt: new Date().toISOString(),
    dataset: {
      topicNotes: dataset.topicIds.length,
      dailyNotes: dataset.dailyIds.length,
      habits: dataset.habitIds.length,
      projects: dataset.projectIds.length,
      refMaterials: dataset.refIds.length,
      scriptures: dataset.scriptureIds.length,
      tags: dataset.tagIds.length,
      linksPerTopic: options.linksPerTopic,
      totalObjects: dataset.topicIds.length + dataset.dailyIds.length + dataset.habitIds.length + dataset.projectIds.length + dataset.refIds.length + dataset.scriptureIds.length + dataset.tagIds.length,
    },
    runs: options.runs,
    operations: ordered,
    topSlowOperations: ordered.slice(0, 3),
    queryPlans,
    artifacts: {
      workspace,
      dbPath,
      syncRoot,
      outputPath,
    },
  };

  writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');

  console.log(`SQLite benchmark complete.`);
  console.log(`- Dataset total objects: ${results.dataset.totalObjects}`);
  console.log(`- Results file: ${outputPath}`);
  console.log(`- Slowest operations:`);
  for (const operation of results.topSlowOperations) {
    console.log(`  • ${operation.name}: avg ${operation.avgMs}ms, p95 ${operation.p95Ms}ms`);
  }

  db.close();

  if (!options.keepArtifacts) {
    rmSync(workspace, { recursive: true, force: true });
  } else {
    console.log(`- Artifacts retained in: ${workspace}`);
  }
}

await main();
