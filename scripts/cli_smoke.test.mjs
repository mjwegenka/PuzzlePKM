/* eslint-env node */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
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

function assertNoSerializedPathMetadata(content) {
  assert.doesNotMatch(content, /^syncPath\s*:/m);
  assert.doesNotMatch(content, /^sync_path\s*:/m);
  assert.doesNotMatch(content, /^dropboxPath\s*:/m);
  assert.doesNotMatch(content, /^dropbox_path\s*:/m);
}

function toPosixPath(path) {
  return path.replace(/\\/g, '/');
}

test('CLI smoke: create/get/list/update/delete and sync command paths', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-smoke-'));
  const dbPath = join(sandboxDir, 'smoke.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
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
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
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

    assertNoSerializedPathMetadata(sourceFileContent);

    assert.match(sourceFileContent, new RegExp(`\\[PathTarget\\]\\(${expectedRelativePathWithFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    assert.match(sourceFileContent, new RegExp(`\\[ScriptureTarget\\]\\(${scripture.passageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    assert.match(sourceFileContent, new RegExp(`\\[UnsafeTarget\\]\\(${unsafeTopic.id}\\)`));
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test('CLI sync derives project/ref-material sync paths from folder locations and scrubs serialized path keys', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-file-paths-'));
  const dbPath = join(sandboxDir, 'file-paths.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
  };

  try {
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });

    const project = parseLastJson(
      runCli(['write', 'project', JSON.stringify({ name: 'Alpha Project', startDate: '2026-05-01', endDate: '2026-05-31', tags: ['Planning'] })], { env }).stdout,
    );
    const refMaterial = parseLastJson(
      runCli(['write', 'ref-material', JSON.stringify({ name: 'Alpha Reference', author: 'Test Author', tags: ['Library'] })], { env }).stdout,
    );

    runCli(['sync'], { env });

    const syncedProject = parseLastJson(runCli(['get', 'project', project.id], { env }).stdout);
    const syncedRefMaterial = parseLastJson(runCli(['get', 'ref-material', refMaterial.id], { env }).stdout);

    const projectFolderPath = join(syncRoot, 'projects', 'alpha-project');
    const refMaterialFolderPath = join(syncRoot, 'ref-materials', 'alpha-reference');
    const projectMetaPath = join(projectFolderPath, 'meta.yaml');
    const refMaterialMetaPath = join(refMaterialFolderPath, 'meta.yaml');

    assert.equal(syncedProject.syncPath, toPosixPath(projectFolderPath));
    assert.equal(syncedRefMaterial.syncPath, toPosixPath(refMaterialFolderPath));
    assertNoSerializedPathMetadata(readFileSync(projectMetaPath, 'utf8'));
    assertNoSerializedPathMetadata(readFileSync(refMaterialMetaPath, 'utf8'));

    const movedProjectFolderPath = join(syncRoot, 'projects', 'manual-project-folder');
    const movedRefMaterialFolderPath = join(syncRoot, 'ref-materials', 'manual-reference-folder');
    renameSync(projectFolderPath, movedProjectFolderPath);
    renameSync(refMaterialFolderPath, movedRefMaterialFolderPath);

    writeFileSync(join(movedProjectFolderPath, 'meta.yaml'), [
      `id: ${project.id}`,
      'name: Alpha Project',
      'startDate: 2026-05-01',
      'endDate: 2026-05-31',
      'tags: ["Planning"]',
      `createdAt: ${project.createdAt}`,
      `updatedAt: ${project.updatedAt}`,
      'syncPath: /wrong/project/path',
      'dropboxPath: /wrong/project/dropbox-path',
    ].join('\n') + '\n');

    writeFileSync(join(movedRefMaterialFolderPath, 'meta.yaml'), [
      `id: ${refMaterial.id}`,
      'name: Alpha Reference',
      'author: Test Author',
      'tags: ["Library"]',
      `createdAt: ${refMaterial.createdAt}`,
      `updatedAt: ${refMaterial.updatedAt}`,
      'syncPath: /wrong/ref-material/path',
      'dropbox_path: /wrong/ref-material/dropbox-path',
    ].join('\n') + '\n');

    runCli(['sync'], { env });

    const rederivedProject = parseLastJson(runCli(['get', 'project', project.id], { env }).stdout);
    const rederivedRefMaterial = parseLastJson(runCli(['get', 'ref-material', refMaterial.id], { env }).stdout);
    assert.equal(rederivedProject.syncPath, toPosixPath(movedProjectFolderPath));
    assert.equal(rederivedRefMaterial.syncPath, toPosixPath(movedRefMaterialFolderPath));
    assert.equal(rederivedProject.startDate, '2026-05-01');
    assert.equal(rederivedProject.endDate, '2026-05-31');
    assert.equal(rederivedRefMaterial.author, 'Test Author');

    assertNoSerializedPathMetadata(readFileSync(join(movedProjectFolderPath, 'meta.yaml'), 'utf8'));
    assertNoSerializedPathMetadata(readFileSync(join(movedRefMaterialFolderPath, 'meta.yaml'), 'utf8'));
    assert.equal(existsSync(projectFolderPath), false, 'sync should not recreate the old canonical project folder after deriving the moved path');
    assert.equal(existsSync(refMaterialFolderPath), false, 'sync should not recreate the old canonical ref-material folder after deriving the moved path');
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test('CLI block-ID round-trip: block IDs survive write→get→write and explicit-blocks payload', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-blocks-'));
  const dbPath = join(sandboxDir, 'blocks.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
  };

  try {
    // 1. Write a note with plain markdown – CLI should auto-assign block IDs.
    const created = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Block Round-trip', contentMarkdown: 'First para\n\nSecond para' })], { env }).stdout,
    );
    assert.ok(Array.isArray(created.blocks) && created.blocks.length === 2, 'initial write should produce 2 blocks');
    const [blk0, blk1] = created.blocks;
    assert.match(blk0.blockId, /^blk-[a-f0-9]{12}$/, 'block ID should match blk-<12 hex> format');
    assert.match(blk1.blockId, /^blk-[a-f0-9]{12}$/, 'block ID should match blk-<12 hex> format');

    // 2. Fetch the note and verify block IDs match.
    const fetched = parseLastJson(runCli(['get', 'topic-note', created.id], { env }).stdout);
    assert.equal(fetched.blocks[0].blockId, blk0.blockId, 'block IDs should be stable after get');
    assert.equal(fetched.blocks[1].blockId, blk1.blockId, 'block IDs should be stable after get');

    // 3. Re-write with the embedded block-ID comments – IDs must not change.
    const rewritten = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ id: created.id, title: 'Block Round-trip', contentMarkdown: created.contentMarkdown })], { env }).stdout,
    );
    assert.equal(rewritten.blocks[0].blockId, blk0.blockId, 'block IDs must survive a re-write via contentMarkdown embedding');
    assert.equal(rewritten.blocks[1].blockId, blk1.blockId, 'block IDs must survive a re-write via contentMarkdown embedding');

    // 4. Write a fresh note with explicit block IDs in the payload.
    const explicitId0 = 'blk-aabbccddeeff';
    const explicitId1 = 'blk-112233445566';
    const explicit = parseLastJson(
      runCli([
        'write',
        'topic-note',
        JSON.stringify({
          title: 'Explicit Blocks',
          blocks: [
            { blockId: explicitId0, position: 0, contentMarkdown: 'Block A' },
            { blockId: explicitId1, position: 1, contentMarkdown: 'Block B' },
          ],
        }),
      ], { env }).stdout,
    );
    assert.equal(explicit.blocks[0].blockId, explicitId0, 'explicit block ID 0 should be preserved');
    assert.equal(explicit.blocks[1].blockId, explicitId1, 'explicit block ID 1 should be preserved');

    const explicitFetched = parseLastJson(runCli(['get', 'topic-note', explicit.id], { env }).stdout);
    assert.equal(explicitFetched.blocks[0].blockId, explicitId0, 'explicit block IDs should survive a get');
    assert.equal(explicitFetched.blocks[1].blockId, explicitId1, 'explicit block IDs should survive a get');
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test('CLI migrate-links dry-run/apply converts unambiguous legacy paths and reports unresolved links', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-migrate-links-'));
  const dbPath = join(sandboxDir, 'migrate-links.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
  };

  try {
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });

    const target = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Migration Target', contentMarkdown: 'Target body' })], { env }).stdout,
    );
    const targetFull = parseLastJson(runCli(['get', 'topic-note', target.id], { env }).stdout);
    const targetFileName = basename(targetFull.syncPath);

    const ambiguousA = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Ambiguous A', contentMarkdown: 'A' })], { env }).stdout,
    );
    const ambiguousB = parseLastJson(
      runCli(['write', 'topic-note', JSON.stringify({ title: 'Ambiguous B', contentMarkdown: 'B' })], { env }).stdout,
    );

    const source = parseLastJson(
      runCli([
        'write',
        'topic-note',
        JSON.stringify({
          title: 'Legacy Source',
          contentMarkdown: [
            `[Resolvable](./${targetFileName}#blk-abc123def456)`,
            '[Ambiguous](duplicate.md)',
            '[Missing](missing-link.md)',
            `[Canonical](${target.id})`,
            '[External](https://example.com)',
          ].join(' '),
        }),
      ], { env }).stdout,
    );

    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE topic_notes SET sync_path = ? WHERE id = ?').run(`${syncRoot}/topic-notes/a/duplicate.md`, ambiguousA.id);
    db.prepare('UPDATE topic_notes SET sync_path = ? WHERE id = ?').run(`${syncRoot}/topic-notes/b/duplicate.md`, ambiguousB.id);
    db.close();

    const dryRunReport = parseLastJson(runCli(['migrate-links', '--dry-run'], { env }).stdout);
    assert.equal(dryRunReport.mode, 'dry-run');
    assert.equal(dryRunReport.summary.converted, 1);
    assert.equal(dryRunReport.summary.unresolved, 2);
    assert.equal(dryRunReport.summary.notesChanged, 1);
    assert.ok(dryRunReport.converted.some((entry) => entry.noteId === source.id && entry.targetId === target.id));
    assert.ok(
      dryRunReport.unresolved.some(
        (entry) =>
          entry.noteId === source.id
          && String(entry.reason).startsWith('multiple-')
          && Array.isArray(entry.candidateIds)
          && entry.candidateIds.length === 2,
      ),
    );
    assert.ok(dryRunReport.unresolved.some((entry) => entry.noteId === source.id && entry.reason === 'no-matching-object'));

    const applyReport = parseLastJson(runCli(['migrate-links', '--apply'], { env }).stdout);
    assert.equal(applyReport.mode, 'apply');
    assert.equal(applyReport.summary.converted, 1);
    assert.equal(applyReport.summary.notesChanged, 1);

    const migratedSource = parseLastJson(runCli(['get', 'topic-note', source.id], { env }).stdout);
    assert.match(migratedSource.contentMarkdown, new RegExp(`\\[Resolvable\\]\\(${target.id}#blk-abc123def456\\)`));
    assert.match(migratedSource.contentMarkdown, /\[Ambiguous\]\(duplicate\.md\)/);
    assert.match(migratedSource.contentMarkdown, /\[Missing\]\(missing-link\.md\)/);

    const secondApplyReport = parseLastJson(runCli(['migrate-links', '--apply'], { env }).stdout);
    assert.equal(secondApplyReport.summary.converted, 0);
    assert.equal(secondApplyReport.summary.notesChanged, 0);
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
