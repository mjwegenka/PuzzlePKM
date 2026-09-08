/* eslint-env node */

// Habits are practices with a log of dated occurrences. These cover the four
// things that model has to get right: migrating the old dated-checkbox rows,
// the cadence math, the occurrence log, and the Markdown round trip (including
// absorbing the legacy one-file-per-occurrence layout).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { computeHabitStats } from '../cli/objects/habit/stats.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli.mjs');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'puzzlepkm-habits-'));
  return {
    dir,
    env: {
      PUZZLEPKM_DB_PATH: join(dir, 'puzzlepkm.sqlite'),
      PUZZLEPKM_SECRETS_PATH: join(dir, 'secrets.json'),
    },
  };
}

function runCli(args, env) {
  const result = spawnSync(process.execPath, ['--no-warnings', cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`CLI failed: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function runJson(args, env) {
  const raw = runCli(args, env);
  const start = raw.search(/[[{]/);
  if (start < 0) throw new Error(`Expected JSON output:\n${raw}`);
  return JSON.parse(raw.slice(start));
}

/** Builds a database in the pre-practice shape so the migration has real input. */
function seedLegacyDatabase(dbPath, rows) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE habits (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      sync_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE object_tags (
      object_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (object_id, tag_id)
    );
  `);
  const now = '2026-01-01T00:00:00.000Z';
  const insertHabit = db.prepare('INSERT INTO habits (id, text, date, status, sync_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (id, name, display_name, created_at) VALUES (?, ?, ?, ?)');
  const linkTag = db.prepare("INSERT INTO object_tags (object_id, object_type, tag_id) VALUES (?, 'habit', ?)");
  for (const row of rows) {
    insertHabit.run(row.id, row.text ?? '', row.date, row.status ?? 'accomplished', '', now, now);
    if (row.tag) {
      const tagId = `tag-${row.tag.toLowerCase()}`;
      insertTag.run(tagId, row.tag.toLowerCase(), row.tag, now);
      linkTag.run(row.id, tagId);
    }
  }
  db.close();
}

test('legacy dated habit rows migrate into practices grouped by their tag', () => {
  const { dir, env } = scratch();
  try {
    seedLegacyDatabase(env.PUZZLEPKM_DB_PATH, [
      { id: 'a1', date: '2025-01-11', tag: 'Confession' },
      { id: 'a2', date: '2025-02-13', tag: 'Confession' },
      { id: 'a3', date: '2025-04-03', tag: 'Confession' },
      { id: 'b1', date: '2025-03-01', tag: 'Examen' },
      // No tag: the free text carries the identity instead.
      { id: 'c1', date: '2025-05-01', text: 'Spiritual direction' },
      // Planned but never done — an intention, not an occurrence.
      { id: 'd1', date: '2025-06-01', tag: 'Confession', status: 'planned' },
    ]);

    const habits = runJson(['habit', 'list'], env);
    const byName = new Map(habits.map((habit) => [habit.name, habit]));

    assert.deepEqual([...byName.keys()].sort(), ['Confession', 'Examen', 'Spiritual direction']);
    assert.equal(byName.get('Confession').stats.entryCount, 3, 'planned rows are not occurrences');
    assert.deepEqual(
      byName.get('Confession').entries.map((entry) => entry.date),
      ['2025-01-11', '2025-02-13', '2025-04-03'],
    );
    assert.deepEqual(byName.get('Confession').tags, ['Confession']);
    assert.equal(byName.get('Spiritual direction').stats.entryCount, 1);
    // Every migrated practice starts without a target so its own rhythm is used.
    assert.equal(byName.get('Confession').targetIntervalDays, null);

    // Re-opening the database must not migrate a second time.
    const again = runJson(['habit', 'list'], env);
    assert.equal(again.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cadence comes from the target when set and from the median gap otherwise', () => {
  // Gaps of 10, 30 and 20 days: median 20.
  const entries = [
    { date: '2026-01-01' },
    { date: '2026-01-11' },
    { date: '2026-02-10' },
    { date: '2026-03-02' },
  ];

  const observed = computeHabitStats({ targetIntervalDays: null }, entries, '2026-03-10');
  assert.equal(observed.medianGapDays, 20);
  assert.equal(observed.intervalDays, 20);
  assert.equal(observed.intervalSource, 'observed');
  assert.equal(observed.dueOn, '2026-03-22');
  assert.equal(observed.state, 'on-track');
  assert.equal(observed.daysUntilDue, 12);

  // An interval with no mode is shorthand for the target mode.
  const targeted = computeHabitStats({ targetIntervalDays: 5 }, entries, '2026-03-10');
  assert.equal(targeted.cadenceMode, 'target');
  assert.equal(targeted.intervalDays, 5);
  assert.equal(targeted.intervalSource, 'target');
  assert.equal(targeted.dueOn, '2026-03-07');
  assert.equal(targeted.state, 'overdue');
  assert.equal(targeted.daysOverdue, 3);

  assert.equal(computeHabitStats({}, entries, '2026-03-22').state, 'due');
  assert.equal(computeHabitStats({}, entries, '2026-03-02').state, 'logged');

  // Too little history to claim a rhythm, and nothing logged at all.
  assert.equal(computeHabitStats({}, [{ date: '2026-01-01' }], '2026-06-01').state, 'untracked');
  assert.equal(computeHabitStats({}, [], '2026-06-01').state, 'untracked');
  assert.equal(computeHabitStats({}, [], '2026-06-01').lastDate, null);
});

test('stats as of a past date ignore what happened after it', () => {
  const entries = [{ date: '2026-01-01' }, { date: '2026-01-11' }, { date: '2026-01-21' }, { date: '2026-06-01' }];
  const past = computeHabitStats({ targetIntervalDays: 10 }, entries, '2026-02-05');
  assert.equal(past.entryCount, 3);
  assert.equal(past.lastDate, '2026-01-21');
  assert.equal(past.state, 'overdue');
  assert.equal(past.daysOverdue, 5);
  // The full history is still reported, so a caller can tell entries were trimmed.
  assert.equal(past.totalEntryCount, 4);
});

test('logging an occurrence is idempotent per day and reversible', () => {
  const { dir, env } = scratch();
  try {
    const created = runJson(['write', 'habit', JSON.stringify({ name: 'Examen', targetIntervalDays: 1 })], env);
    assert.equal(created.name, 'Examen');
    assert.equal(created.state, 'active');

    runCli(['habit', 'log', 'Examen', '2026-03-01'], env);
    const twice = runJson(['habit', 'log', 'Examen', '2026-03-01', 'again'], env);
    assert.equal(twice.stats.entryCount, 1, 'the same day cannot be logged twice');
    assert.equal(twice.entries[0].note, 'again', 'but a note can be attached after the fact');

    // Resolving by name is a convenience the CLI and MCP both rely on.
    const byName = runJson(['habit', 'log', 'examen', '2026-03-02'], env);
    assert.equal(byName.stats.entryCount, 2);

    const removed = runJson(['habit', 'unlog', 'Examen', '2026-03-02'], env);
    assert.equal(removed.stats.entryCount, 1);

    const retired = runJson(['write', 'habit', JSON.stringify({ id: created.id, state: 'retired' })], env);
    assert.equal(retired.state, 'retired');
    assert.ok(retired.retiredOn, 'retiring records when it happened');
    assert.equal(runJson(['habit', 'list'], env).length, 0, 'retired habits are hidden by default');
    assert.equal(runJson(['habit', 'list', '--include-retired'], env).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a habit round-trips through one Markdown file per practice', () => {
  const { dir, env } = scratch();
  const root = join(dir, 'syncroot');
  try {
    mkdirSync(join(root, 'habits'), { recursive: true });
    runCli(['settings', 'set', 'root-folder', root], env);

    const created = runJson(['write', 'habit', JSON.stringify({ name: 'Confession', targetIntervalDays: 30 })], env);
    runCli(['habit', 'log', created.id, '2026-01-11'], env);
    runCli(['habit', 'log', created.id, '2026-02-13', 'at St. Ignatius'], env);
    runCli(['sync'], env);

    const files = readdirSync(join(root, 'habits'));
    assert.equal(files.length, 1, 'one file per practice, not per occurrence');
    assert.match(files[0], /^confession-[0-9a-f]{8}\.md$/);

    const content = readFileSync(join(root, 'habits', files[0]), 'utf8');
    assert.match(content, /^name: "Confession"$/m);
    assert.match(content, /^targetIntervalDays: 30$/m, 'numbers are written unquoted');
    assert.match(content, /^state: "active"$/m);
    assert.match(content, /^- 2026-02-13 — at St\. Ignatius$/m);
    assert.match(content, /^- 2026-01-11$/m);
    // DEC-69: sync locations are derived from the filesystem, never serialized.
    assert.doesNotMatch(content, /^syncPath\s*:/m);

    // Importing the same folder into an empty database reproduces the habit.
    const second = scratch();
    try {
      runCli(['settings', 'set', 'root-folder', root], second.env);
      runCli(['sync'], second.env);
      const [imported] = runJson(['habit', 'list'], second.env);
      assert.equal(imported.name, 'Confession');
      assert.equal(imported.targetIntervalDays, 30);
      assert.deepEqual(imported.entries.map((entry) => entry.date), ['2026-01-11', '2026-02-13']);
      assert.equal(imported.entries[1].note, 'at St. Ignatius');
    } finally {
      rmSync(second.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy per-occurrence sync files are absorbed and removed', () => {
  const { dir, env } = scratch();
  const root = join(dir, 'syncroot');
  try {
    const habitsDir = join(root, 'habits');
    mkdirSync(habitsDir, { recursive: true });
    const legacy = (id, date) => [
      '---',
      `id: "${id}"`,
      'type: "habit"',
      'text: ""',
      `date: "${date}"`,
      'status: "accomplished"',
      'tags: ["Confession"]',
      `createdAt: "${date}T10:00:00.000Z"`,
      `updatedAt: "${date}T10:00:00.000Z"`,
      '---',
      '',
    ].join('\n');
    writeFileSync(join(habitsDir, `${'2025-01-11'}-Confession-aaaaaa.md`), legacy('legacy-a', '2025-01-11'));
    writeFileSync(join(habitsDir, `${'2025-02-13'}-Confession-bbbbbb.md`), legacy('legacy-b', '2025-02-13'));

    runCli(['settings', 'set', 'root-folder', root], env);
    runCli(['sync'], env);

    const files = readdirSync(habitsDir);
    assert.equal(files.length, 1, 'the legacy files are consumed, not left beside the new one');
    assert.match(files[0], /^confession-/);
    assert.ok(!existsSync(join(habitsDir, '2025-01-11-Confession-aaaaaa.md')));

    const [habit] = runJson(['habit', 'list'], env);
    assert.equal(habit.name, 'Confession');
    assert.deepEqual(habit.entries.map((entry) => entry.date), ['2025-01-11', '2025-02-13']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a "record only" habit never becomes due, however long the gap', () => {
  const entries = [{ date: '2024-01-01' }, { date: '2024-01-11' }, { date: '2024-01-21' }];

  // The same history under the default mode is long overdue.
  const observed = computeHabitStats({ cadenceMode: 'observed' }, entries, '2026-06-01');
  assert.equal(observed.state, 'overdue');

  const recordOnly = computeHabitStats({ cadenceMode: 'none' }, entries, '2026-06-01');
  assert.equal(recordOnly.state, 'untracked');
  assert.equal(recordOnly.dueOn, null);
  assert.equal(recordOnly.intervalDays, null);
  // The history itself is still fully reported — that is the point of keeping it.
  assert.equal(recordOnly.entryCount, 3);
  assert.equal(recordOnly.medianGapDays, 10);
  assert.equal(recordOnly.daysSinceLast, 862);

  // An explicit target still wins where one is set.
  const targeted = computeHabitStats({ cadenceMode: 'target', targetIntervalDays: 30 }, entries, '2024-03-01');
  assert.equal(targeted.intervalSource, 'target');
  assert.equal(targeted.state, 'overdue');
});

test('cadence mode round-trips through the habit file', () => {
  const { dir, env } = scratch();
  const root = join(dir, 'syncroot');
  try {
    mkdirSync(join(root, 'habits'), { recursive: true });
    runCli(['settings', 'set', 'root-folder', root], env);

    runJson(['write', 'habit', JSON.stringify({ name: 'Rosary walk', cadenceMode: 'none' })], env);
    runJson(['write', 'habit', JSON.stringify({ name: 'Confession', targetIntervalDays: 30 })], env);
    runCli(['sync'], env);

    const files = readdirSync(join(root, 'habits'));
    const rosary = readFileSync(join(root, 'habits', files.find((file) => file.startsWith('rosary'))), 'utf8');
    assert.match(rosary, /^cadenceMode: "none"$/m);
    assert.doesNotMatch(rosary, /^targetIntervalDays:/m, 'an interval means nothing without the target mode');

    const confession = readFileSync(join(root, 'habits', files.find((file) => file.startsWith('confession'))), 'utf8');
    assert.match(confession, /^cadenceMode: "target"$/m);
    assert.match(confession, /^targetIntervalDays: 30$/m);

    const second = scratch();
    try {
      runCli(['settings', 'set', 'root-folder', root], second.env);
      runCli(['sync'], second.env);
      const byName = new Map(runJson(['habit', 'list'], second.env).map((habit) => [habit.name, habit]));
      assert.equal(byName.get('Rosary walk').cadenceMode, 'none');
      assert.equal(byName.get('Confession').cadenceMode, 'target');
      assert.equal(byName.get('Confession').targetIntervalDays, 30);
    } finally {
      rmSync(second.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a habit removes its entries, tags, links, and file', () => {
  const { dir, env } = scratch();
  const root = join(dir, 'syncroot');
  try {
    mkdirSync(join(root, 'habits'), { recursive: true });
    runCli(['settings', 'set', 'root-folder', root], env);

    const created = runJson(['write', 'habit', JSON.stringify({ name: 'Confession', tags: ['Sacraments'] })], env);
    runCli(['habit', 'log', created.id, '2026-01-11'], env);
    runCli(['habit', 'log', created.id, '2026-02-13'], env);
    runCli(['sync'], env);
    assert.equal(readdirSync(join(root, 'habits')).length, 1);

    runCli(['delete', 'habit', created.id], env);

    assert.equal(runJson(['habit', 'list', '--include-retired'], env).length, 0);
    assert.equal(readdirSync(join(root, 'habits')).length, 0, 'the Markdown file goes too');

    const db = new DatabaseSync(env.PUZZLEPKM_DB_PATH);
    const remaining = {
      entries: db.prepare('SELECT COUNT(*) AS n FROM habit_entries WHERE habit_id = ?').get(created.id).n,
      tags: db.prepare("SELECT COUNT(*) AS n FROM object_tags WHERE object_id = ?").get(created.id).n,
      links: db.prepare('SELECT COUNT(*) AS n FROM object_links WHERE source_id = ? OR target_id = ?').get(created.id, created.id).n,
    };
    db.close();
    assert.deepEqual(remaining, { entries: 0, tags: 0, links: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
