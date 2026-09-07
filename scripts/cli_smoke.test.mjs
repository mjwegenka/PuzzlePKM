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

    const projectFolderPath = join(syncRoot, 'projects', `alpha-project-${project.id.slice(0, 8)}`);
    const refMaterialFolderPath = join(syncRoot, 'ref-materials', `alpha-reference-${refMaterial.id.slice(0, 8)}`);
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

    const metaBundle = parseLastJson(runCli(['list-meta'], { env }).stdout);
    const indexedBlocks = Array.isArray(metaBundle.noteBlocks) ? metaBundle.noteBlocks : [];
    const indexedForCreated = indexedBlocks
      .filter((row) => row.noteId === created.id)
      .map((row) => row.blockId);
    assert.deepEqual(
      indexedForCreated.slice(0, 2),
      [blk0.blockId, blk1.blockId],
      'list-meta should expose ordered block metadata for mention indexing',
    );

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

test('CLI scripture references roll up into chapters, spanning chapter boundaries and ranges', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-scripture-chapters-'));
  const dbPath = join(sandboxDir, 'chapters.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
  };

  try {
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });

    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Chapter Rollup',
      contentMarkdown: [
        'Mark 10:17-22 then Mark 10:46-52 then Mark 10',
        '1 Corinthians 12:31-13:13',
        'Nehemiah 8-9',
        'Matthew 3:2,4:17',
      ].join('\n\n'),
    })], { env });

    const db = new DatabaseSync(dbPath);
    try {
      const chapterOf = (reference) => db.prepare(`
        SELECT c.reference AS chapter, l.verse_start, l.verse_end
        FROM scriptures s
        JOIN scripture_chapter_links l ON l.scripture_id = s.id
        JOIN scripture_chapters c ON c.id = l.chapter_id
        WHERE s.reference = ?
        ORDER BY c.book_order, c.chapter
      `).all(reference).map((row) => ({
        chapter: row.chapter,
        verse_start: row.verse_start,
        verse_end: row.verse_end,
      }));

      // Three distinct references in one chapter collapse to a single chapter row.
      const markChapter = db.prepare("SELECT id FROM scripture_chapters WHERE reference = 'Mark 10'").all();
      assert.equal(markChapter.length, 1, 'Mark 10 should exist exactly once');
      const markReferences = db.prepare(`
        SELECT COUNT(DISTINCT l.scripture_id) AS count
        FROM scripture_chapter_links l
        JOIN scripture_chapters c ON c.id = l.chapter_id
        WHERE c.reference = 'Mark 10'
      `).get();
      assert.equal(markReferences.count, 3, 'all three Mark 10 references should roll up to one chapter');

      // A span crossing a chapter boundary lands in both chapters.
      assert.deepEqual(
        chapterOf('1 Corinthians 12:31-13:13'),
        [
          { chapter: '1 Corinthians 12', verse_start: 31, verse_end: null },
          { chapter: '1 Corinthians 13', verse_start: 1, verse_end: 13 },
        ],
      );

      // A bare chapter range expands to every chapter it covers.
      assert.deepEqual(
        chapterOf('Nehemiah 8-9').map((row) => row.chapter),
        ['Nehemiah 8', 'Nehemiah 9'],
      );

      // Comma-separated citations are independent chapters, not one span.
      assert.deepEqual(
        chapterOf('Matthew 3:2,4:17').map((row) => row.chapter),
        ['Matthew 3', 'Matthew 4'],
      );

      // Every scripture row carries its denormalized primary chapter.
      const unresolved = db.prepare('SELECT COUNT(*) AS count FROM scriptures WHERE chapter IS NULL').get();
      assert.equal(unresolved.count, 0, 'every scripture should resolve to a chapter');
    } finally {
      db.close();
    }
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test('CLI scripture-chapter view groups citations by verse span and links adjacent chapters', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-chapter-view-'));
  const dbPath = join(sandboxDir, 'chapter-view.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
  };

  try {
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });

    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Rich Young Man',
      contentMarkdown: 'Mark 10:17-22 and Mark 10:46-52',
    })], { env });
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Discipleship',
      contentMarkdown: 'Mark 10:17-22 again, plus the whole of Mark 10 and Mark 11:11',
    })], { env });

    const chapter = parseLastJson(runCli(['get', 'scripture-chapter', 'Mark 10'], { env }).stdout);

    assert.equal(chapter.type, 'scripture-chapter');
    assert.equal(chapter.reference, 'Mark 10');
    // Two notes cite this chapter, across three distinct references.
    assert.equal(chapter.linkedNotes.length, 2);
    assert.equal(chapter.references.length, 3);

    // Whole-chapter citations sort ahead of verse spans, which sort by start verse.
    assert.deepEqual(
      chapter.references.map((entry) => [entry.reference, entry.verseStart, entry.verseEnd]),
      [
        ['Mark 10', null, null],
        ['Mark 10:17-22', 17, 22],
        ['Mark 10:46-52', 46, 52],
      ],
    );

    // Each citation carries the notes that used that exact reference.
    const richYoungMan = chapter.references.find((entry) => entry.reference === 'Mark 10:17-22');
    assert.equal(richYoungMan.noteCount, 2);
    assert.deepEqual(
      richYoungMan.linkedNotes.map((note) => note.title).sort(),
      ['Discipleship', 'Rich Young Man'],
    );

    // Adjacent chapters are the neighbours that exist within the same book.
    assert.equal(chapter.adjacentChapters.previous, null, 'no Mark 9 was cited');
    assert.equal(chapter.adjacentChapters.next?.reference, 'Mark 11');

    // The chapter is addressable by id as well as by reference.
    const byId = parseLastJson(runCli(['get', 'scripture-chapter', chapter.id], { env }).stdout);
    assert.equal(byId.reference, 'Mark 10');
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test('CLI scripture detection rejects prose that only looks like a reference', () => {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-cli-scripture-prose-'));
  const dbPath = join(sandboxDir, 'prose.sqlite');
  const secretsPath = join(sandboxDir, 'secrets.json');
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: dbPath,
    PUZZLEPKM_SECRETS_PATH: secretsPath,
  };

  const referencesIn = (db) => db
    .prepare('SELECT reference FROM scriptures ORDER BY book_order, chapter, reference')
    .all()
    .map((row) => row.reference);

  try {
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });

    // Ambiguous abbreviations that are ordinary English words ("the", "is",
    // "am", "pt", "col", "est", "Sam", "Dan") must not become citations.
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Prose',
      contentMarkdown: [
        'Feeding of the 5,000 was the sign.',
        'The 3 Questions of Every Human Heart, and The 4 D s.',
        'The program is 12 weeks long and I am 3 years in.',
        'See part pt 3 and col 2 of the table, est 1990.',
        'My friends Sam 17 and Dan 5 were there.',
        'There is no 3 Maccabees 2 in this canon.',
      ].join('\n\n'),
    })], { env });

    const db = new DatabaseSync(dbPath);
    try {
      assert.deepEqual(referencesIn(db), [], 'prose should produce no scripture references');
    } finally {
      db.close();
    }

    // Genuine citations, including abbreviations that are not ordinary words,
    // abbreviations with a period, and volume-prefixed ambiguous ones.
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Citations',
      contentMarkdown: [
        'Mt 5:3 and Jn 3:16 and Rom 8:28 and Ps 23.',
        'Is. 40:31 and 1 Thess. 5:16 are cited with periods.',
        '1 Sam 17:32 and 2 Tim 4:6-8 carry a volume.',
        'Cf. 4 Kings 13:17 and 3 Kings 2:1 in Douay numbering.',
        'Jude 20 and Jude 1:10 and Philemon 6 and Obadiah 3 and 3 John 4.',
      ].join('\n\n'),
    })], { env });

    const db2 = new DatabaseSync(dbPath);
    try {
      const references = referencesIn(db2);

      // Douay 3/4 Kings map onto the modern books.
      assert.ok(references.includes('1 Kings 2:1'), '3 Kings → 1 Kings');
      assert.ok(references.includes('2 Kings 13:17'), '4 Kings → 2 Kings');

      // Ambiguous abbreviations are accepted with a period or a volume.
      for (const expected of ['Isaiah 40:31', '1 Thessalonians 5:16', '1 Samuel 17:32', '2 Timothy 4:6-8']) {
        assert.ok(references.includes(expected), `expected ${expected}`);
      }

      // Unambiguous abbreviations still work bare.
      for (const expected of ['Matthew 5:3', 'John 3:16', 'Romans 8:28', 'Psalm 23']) {
        assert.ok(references.includes(expected), `expected ${expected}`);
      }

      // Single-chapter books: a bare number is a verse, an explicit 1:N is not.
      const singleChapter = db2.prepare(`
        SELECT s.reference, c.reference AS chapter, l.verse_start, l.verse_end
        FROM scriptures s
        JOIN scripture_chapter_links l ON l.scripture_id = s.id
        JOIN scripture_chapters c ON c.id = l.chapter_id
        WHERE s.book_name IN ('Jude', 'Philemon', 'Obadiah', '3 John')
        ORDER BY s.reference
      `).all().map((row) => [row.reference, row.chapter, row.verse_start, row.verse_end]);

      assert.deepEqual(singleChapter, [
        ['3 John 4', '3 John 1', 4, 4],
        ['Jude 1:10', 'Jude 1', 10, 10],
        ['Jude 20', 'Jude 1', 20, 20],
        ['Obadiah 3', 'Obadiah 1', 3, 3],
        ['Philemon 6', 'Philemon 1', 6, 6],
      ]);

      // No record may fall back to a sentinel canonical position.
      const sentinel = db2.prepare('SELECT COUNT(*) AS count FROM scriptures WHERE book_order > 100').get();
      assert.equal(sentinel.count, 0, 'no scripture should use a sentinel book order');
    } finally {
      db2.close();
    }

    // A verse list must not swallow the volume of the citation that follows it.
    runCli(['write', 'topic-note', JSON.stringify({
      title: 'Adjacent citations',
      contentMarkdown: 'John 17:9-16; 1 John 2:15-17 and Genesis 2:7,25 and John 18,19',
    })], { env });

    const db3 = new DatabaseSync(dbPath);
    try {
      const references = referencesIn(db3);
      assert.ok(references.includes('John 17:9-16'), 'first citation ends at its own verses');
      assert.ok(references.includes('1 John 2:15-17'), 'the following volume stays with its book');
      assert.ok(!references.includes('John 17:9-16;1'), 'the volume must not be absorbed');
      // Real multi-verse and multi-chapter lists are still one reference.
      assert.ok(references.includes('Genesis 2:7,25'));
      assert.ok(references.includes('John 18,19'));
    } finally {
      db3.close();
    }
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
});
