import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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

test('CLI sync resolves canonical UUID links to BibleGateway URLs and safe relative paths', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-link-resolver-'));
  const dbPath = join(sandboxDir, 'links.sqlite');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
  };

  try {
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });

    const linkedTopic = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Linked Topic', contentMarkdown: 'Target' })], { env }).stdout,
    );

    const scriptureSeed = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Scripture Seed', contentMarkdown: 'John 3:16' })], { env }).stdout,
    );
    const scriptureSeedFull = parseLastJson(runCli(['get', 'topic-note', scriptureSeed.id], { env }).stdout);
    const scriptureLink = (scriptureSeedFull.links ?? []).find((link) => link?.type === 'scripture');
    assert.ok(scriptureLink?.id, 'scripture seed note should create a linked scripture object');
    const scripture = parseLastJson(runCli(['get', 'scripture', scriptureLink.id], { env }).stdout);
    assert.match(scripture.passageUrl ?? '', /biblegateway\.com\/passage/i);

    const unsafeTopic = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Unsafe Topic', contentMarkdown: 'Unsafe target' })], { env }).stdout,
    );
    const unsafeSyncPath = `${syncRoot}/../outside.md`;
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE topic_notes SET sync_path = ? WHERE id = ?').run(unsafeSyncPath, unsafeTopic.id);
    db.close();

    const blockFragment = 'blk-abc123def456';
    const sourceTopic = parseLastJson(
      runCli([
        'write',
        'topic-note',
        JSON.stringify({
          title: 'Resolver Source',
          contentMarkdown: [
            `[PathTarget](${linkedTopic.id}#${blockFragment})`,
            `[ScriptureTarget](${scripture.id})`,
            `[UnsafeTarget](${unsafeTopic.id})`,
          ].join(' '),
        }),
      ], { env }).stdout,
    );

    runCli(['sync'], { env });

    const syncedSource = parseLastJson(runCli(['get', 'topic-note', sourceTopic.id], { env }).stdout);
    const syncedTarget = parseLastJson(runCli(['get', 'topic-note', linkedTopic.id], { env }).stdout);
    const sourceFileContent = readFileSync(syncedSource.syncPath, 'utf8');
    const expectedRelativePath = relative(dirname(syncedSource.syncPath), syncedTarget.syncPath).replace(/\\/g, '/');
    const expectedRelativePathWithFragment = `${expectedRelativePath}#${blockFragment}`;

    assert.match(sourceFileContent, new RegExp(`\\[PathTarget\\]\\(${expectedRelativePathWithFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    assert.match(sourceFileContent, new RegExp(`\\[ScriptureTarget\\]\\(${scripture.passageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    assert.match(sourceFileContent, new RegExp(`\\[UnsafeTarget\\]\\(${unsafeTopic.id}\\)`));
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
