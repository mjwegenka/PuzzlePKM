import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli.mjs');

function runCli(args, { env = {}, input, expectFailure = false } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
  });

  if (!expectFailure && result.status !== 0) {
    throw new Error(`CLI command failed: ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  if (expectFailure) {
    assert.notEqual(result.status, 0, `Expected failure for: ${args.join(' ')}`);
  }

  return result;
}

function parseLastJson(stdout) {
  const raw = String(stdout);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error(`Expected JSON output but could not find object payload:\n${stdout}`);
  }
  return JSON.parse(raw.slice(start, end + 1));
}

test('CLI smoke: create/get/list/update/delete and sync command paths', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-smoke-'));
  const dbPath = join(sandboxDir, 'smoke.sqlite');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
  };

  try {
    const createTagResult = runCli(['create', 'tag'], { env, input: 'SmokeTag\n' });
    const createdTag = parseLastJson(createTagResult.stdout);
    assert.ok(createdTag.id, 'create tag should return an id');

    const gotTag = parseLastJson(runCli(['get', 'tag', createdTag.id], { env }).stdout);
    assert.equal(gotTag.displayName, 'SmokeTag');

    const updateTagResult = runCli(['update', 'tag', createdTag.id], { env, input: 'SmokeTagUpdated\n' });
    const updatedTag = parseLastJson(updateTagResult.stdout);
    assert.equal(updatedTag.displayName, 'SmokeTagUpdated');

    const createdTopic = parseLastJson(runCli(['write', 'topic-note', '{"title":"Smoke Topic","contentMarkdown":"Body"}'], { env }).stdout);
    assert.ok(createdTopic.id, 'write topic-note should create an id');

    const listedTopics = runCli(['list', 'topic-note'], { env }).stdout;
    assert.match(listedTopics, new RegExp(createdTopic.id));

    const fetchedTopic = parseLastJson(runCli(['get', 'topic-note', createdTopic.id], { env }).stdout);
    assert.equal(fetchedTopic.title, 'Smoke Topic');

    const rewrittenTopic = parseLastJson(runCli(['write', 'topic-note', JSON.stringify({ id: createdTopic.id, title: 'Updated Topic', contentMarkdown: 'Updated body' })], { env }).stdout);
    assert.equal(rewrittenTopic.title, 'Updated Topic');

    runCli(['delete', 'topic-note', createdTopic.id], { env });
    runCli(['get', 'topic-note', createdTopic.id], { env, expectFailure: true });

    runCli(['delete', 'tag', createdTag.id], { env });
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });
    runCli(['add', 'sync smoke note'], { env });

    const syncResult = runCli(['sync'], { env });
    assert.match(syncResult.stdout, /Sync complete/);
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
