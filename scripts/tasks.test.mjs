/* eslint-env node */

// Tasks are Markdown checkboxes in daily and topic notes (DEC-83). The parser is
// tested directly; the rest goes through the CLI so the write-back path — which
// re-saves the whole note through its repository — is exercised for real.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { applyTaskEditToBlock, extractDueDate, parseTasksFromBlocks } from '../cli/tasks/index.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli.mjs');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'puzzlepkm-tasks-'));
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

const block = (blockId, contentMarkdown) => ({ blockId, contentMarkdown });

test('parses checkbox lines and leaves everything else alone', () => {
  const tasks = parseTasksFromBlocks([
    block('blk-a', [
      '- [ ] Email the provincial due:2026-09-15',
      '* [x] Book flights',
      '  + [ ] Indented and a different bullet',
      '- not a task',
      'Plain prose that mentions [ ] brackets',
    ].join('\n')),
  ]);

  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((task) => task.text), [
    'Email the provincial',
    'Book flights',
    'Indented and a different bullet',
  ]);
  assert.deepEqual(tasks.map((task) => task.ordinal), [0, 1, 2]);
  assert.equal(tasks[0].dueDate, '2026-09-15');
  assert.equal(tasks[1].done, true);
  assert.equal(tasks[2].indent, '  ');
});

test('fenced code is prose, even when the fence spans blocks', () => {
  // Blocks are paragraphs (DEC-38), so a fence containing a blank line is split
  // across several of them — fence state has to survive the block boundary.
  const tasks = parseTasksFromBlocks([
    block('blk-a', '- [ ] A real task'),
    block('blk-b', '```\n- [ ] sample code'),
    block('blk-c', '- [ ] still inside the fence\n```'),
    block('blk-d', '- [ ] Another real task'),
  ]);
  assert.deepEqual(tasks.map((task) => task.text), ['A real task', 'Another real task']);
});

test('a due date is stripped from the text, and a malformed one is left visible', () => {
  assert.deepEqual(extractDueDate('Pack the alb due:2026-09-20'), { text: 'Pack the alb', dueDate: '2026-09-20' });
  assert.deepEqual(extractDueDate('due:2026-09-20 Pack the alb'), { text: 'Pack the alb', dueDate: '2026-09-20' });
  // A date-shaped string that is not a real day stays put rather than vanishing.
  assert.deepEqual(extractDueDate('Pack due:2026-02-31'), { text: 'Pack due:2026-02-31', dueDate: null });
  assert.deepEqual(extractDueDate('Read overdue:notes'), { text: 'Read overdue:notes', dueDate: null });
});

test('editing rewrites one line and leaves its neighbours untouched', () => {
  const source = [
    '- [x] First',
    '- [ ] Second due:2026-01-01',
    '- [ ] Third',
  ].join('\n');

  const edited = applyTaskEditToBlock(source, 1, { text: 'Second, revised', dueDate: '2026-02-02' });
  assert.equal(edited, [
    '- [x] First',
    '- [ ] Second, revised due:2026-02-02',
    '- [ ] Third',
  ].join('\n'));

  assert.equal(
    applyTaskEditToBlock(source, 1, { done: true }),
    ['- [x] First', '- [x] Second due:2026-01-01', '- [ ] Third'].join('\n'),
  );
  assert.equal(
    applyTaskEditToBlock(source, 1, { dueDate: null }),
    ['- [x] First', '- [ ] Second', '- [ ] Third'].join('\n'),
  );
  assert.equal(applyTaskEditToBlock(source, 9, { done: true }), null);
});

test('capture appends to a daily note, and the index orders the Inbox', () => {
  const { dir, env } = scratch();
  try {
    runCli(['tasks', 'add', 'Email the provincial', '--due', '2026-09-15'], env);
    runCli(['tasks', 'add', 'Book flights', '--due', '2026-08-01'], env);
    runCli(['tasks', 'add', 'Read Rahner chapter 3'], env);

    const tasks = runJson(['tasks', 'list'], env);
    // Due soonest (so overdue) first, then undated.
    assert.deepEqual(tasks.map((task) => task.text), [
      'Book flights',
      'Email the provincial',
      'Read Rahner chapter 3',
    ]);
    assert.equal(tasks[0].noteType, 'daily-note');
    assert.ok(tasks[0].noteDate, 'a task knows the day it was captured on');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a task already done when first seen never reaches the Inbox', () => {
  const { dir, env } = scratch();
  try {
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Retreat prep',
      contentMarkdown: '- [x] Done long before the app saw it\n- [ ] Pack the alb',
    })], env);

    const listed = runJson(['tasks', 'list'], env);
    assert.deepEqual(listed.map((task) => task.text), ['Pack the alb']);

    // It is still indexed — just not shown, because it carries no completion time.
    const db = new DatabaseSync(env.PUZZLEPKM_DB_PATH);
    const row = db.prepare("SELECT done, completed_at FROM tasks WHERE text LIKE 'Done long%'").get();
    db.close();
    assert.equal(row.done, 1);
    assert.equal(row.completed_at, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completing in the app stamps the time, unchecking clears it', () => {
  const { dir, env } = scratch();
  try {
    runCli(['tasks', 'add', 'Call the retreat house'], env);
    const [task] = runJson(['tasks', 'list'], env);

    const done = runJson(['tasks', 'set', task.id, '--done'], env);
    assert.equal(done.done, true);
    assert.ok(done.completedAt, 'an in-app completion is timed, so it can linger for three days');

    const undone = runJson(['tasks', 'set', task.id, '--undone'], env);
    assert.equal(undone.done, false);
    assert.equal(undone.completedAt, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a completion survives an unrelated edit to the same note', () => {
  const { dir, env } = scratch();
  try {
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Two tasks',
      contentMarkdown: '- [ ] First\n- [ ] Second',
    })], env);
    const before = runJson(['tasks', 'list'], env);
    const first = before.find((task) => task.text === 'First');
    const second = before.find((task) => task.text === 'Second');

    runCli(['tasks', 'set', first.id, '--done'], env);
    const stamped = runJson(['tasks', 'list'], env).find((task) => task.id === first.id);
    assert.ok(stamped.completedAt);

    // Editing the neighbour re-indexes the whole note; the completion must hold.
    runCli(['tasks', 'set', second.id, '--text', 'Second, revised'], env);
    const after = runJson(['tasks', 'list'], env).find((task) => task.id === first.id);
    assert.ok(after, 'the completed task is still within its visible window');
    assert.equal(after.completedAt, stamped.completedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an edit rewrites the source note rather than a copy of it', () => {
  const { dir, env } = scratch();
  try {
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Retreat prep',
      contentMarkdown: '- [ ] Alpha\n- [ ] Beta\n- [ ] Gamma',
    })], env);
    const beta = runJson(['tasks', 'list'], env).find((task) => task.text === 'Beta');

    runCli(['tasks', 'set', beta.id, '--text', 'Beta, revised', '--due', '2026-12-25'], env);

    const note = runJson(['get', 'topic-note', beta.noteId], env);
    const lines = note.contentMarkdown.split('\n').map((line) => line.replace(/\s*<!--.*?-->\s*$/, ''));
    assert.deepEqual(lines, [
      '- [ ] Alpha',
      '- [ ] Beta, revised due:2026-12-25',
      '- [ ] Gamma',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a task line drops it from the index', () => {
  const { dir, env } = scratch();
  try {
    const created = runJson(['write', 'topic-note', JSON.stringify({
      title: 'Shrinking list',
      contentMarkdown: '- [ ] Keep me\n- [ ] Remove me',
    })], env);
    assert.equal(runJson(['tasks', 'list'], env).length, 2);

    runCli(['write', 'topic-note', JSON.stringify({
      id: created.id,
      title: 'Shrinking list',
      contentMarkdown: '- [ ] Keep me',
    })], env);
    assert.deepEqual(runJson(['tasks', 'list'], env).map((task) => task.text), ['Keep me']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
