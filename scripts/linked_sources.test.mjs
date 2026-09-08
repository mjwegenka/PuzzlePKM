/* eslint-env node */

// DEC-80: linked directories stay where they are on disk, are scanned on every
// sync alongside the managed root, and are never written to or deleted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli.mjs');

function runCli(args, { env = {}, expectFailure = false } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
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

function withSandbox(run) {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-linked-sources-'));
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: join(sandboxDir, 'linked.sqlite'),
    PUZZLEPKM_SECRETS_PATH: join(sandboxDir, 'secrets.json'),
  };
  try {
    mkdirSync(syncRoot, { recursive: true });
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });
    run({ sandboxDir, syncRoot, env });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
}

function makeExternalDir(sandboxDir, name) {
  const externalDir = join(sandboxDir, 'external', name);
  mkdirSync(externalDir, { recursive: true });
  writeFileSync(join(externalDir, 'notes.md'), '# Existing content\n', 'utf8');
  return externalDir;
}

test('linked directory is registered without writing into it and survives sync', () => {
  withSandbox(({ sandboxDir, env }) => {
    const externalDir = makeExternalDir(sandboxDir, 'field-research');

    const addResult = runCli(['sources', 'add', externalDir], { env });
    assert.match(addResult.stdout, /Linked project/);

    const listed = runCli(['sources', 'list'], { env }).stdout;
    assert.match(listed, new RegExp('project\\tok'));
    assert.match(listed, new RegExp(externalDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    // Nothing is written into the linked directory — no meta.yaml sidecar.
    assert.deepEqual(readdirSync(externalDir).sort(), ['notes.md']);

    const projects = runCli(['list', 'project'], { env }).stdout;
    assert.match(projects, /Field Research/);

    runCli(['sync'], { env });

    // Still exactly as the user left it, and still linked after a full sync.
    assert.deepEqual(readdirSync(externalDir).sort(), ['notes.md']);
    assert.match(runCli(['sources', 'list'], { env }).stdout, new RegExp('project\\tok'));
    assert.match(runCli(['list', 'project'], { env }).stdout, /Field Research/);

    // The managed root never grows a copy of the linked project.
    const managedProjects = join(sandboxDir, 'sync-root', 'projects');
    assert.deepEqual(existsSync(managedProjects) ? readdirSync(managedProjects) : [], []);
  });
});

test('an unavailable linked directory warns instead of deleting the record', () => {
  withSandbox(({ sandboxDir, env }) => {
    const externalDir = makeExternalDir(sandboxDir, 'archive-volume');
    runCli(['sources', 'add', externalDir, '--type', 'ref-material', '--name', 'Archive Volume'], { env });

    const movedAside = join(sandboxDir, 'external', 'archive-volume-unmounted');
    renameSync(externalDir, movedAside);

    const syncResult = runCli(['sync'], { env });
    assert.match(syncResult.stderr + syncResult.stdout, /Linked directory unavailable/);

    // Record survives two syncs while the directory is away.
    runCli(['sync'], { env });
    assert.match(runCli(['list', 'ref-material'], { env }).stdout, /Archive Volume/);
    assert.match(runCli(['sources', 'list'], { env }).stdout, /unavailable/);

    // It recovers cleanly once the directory is back.
    renameSync(movedAside, externalDir);
    runCli(['sync'], { env });
    assert.match(runCli(['sources', 'list'], { env }).stdout, new RegExp('ref-material\\tok'));
  });
});

test('deleting or unlinking a linked object leaves the directory on disk', () => {
  withSandbox(({ sandboxDir, env }) => {
    const deletedDir = makeExternalDir(sandboxDir, 'delete-me');
    const projectId = parseLastJson(runCli(['sources', 'add', deletedDir], { env }).stdout).id;
    assert.ok(projectId, 'expected a project id for the linked directory');

    runCli(['delete', 'project', projectId], { env });
    assert.ok(existsSync(deletedDir), 'delete must not remove the linked directory');
    assert.deepEqual(readdirSync(deletedDir).sort(), ['notes.md']);
    assert.doesNotMatch(runCli(['sources', 'list'], { env }).stdout, new RegExp('project\\t'));

    const unlinkedDir = makeExternalDir(sandboxDir, 'unlink-me');
    runCli(['sources', 'add', unlinkedDir], { env });
    runCli(['sources', 'remove', unlinkedDir], { env });
    assert.ok(existsSync(unlinkedDir), 'unlink must not remove the linked directory');
    assert.deepEqual(readdirSync(unlinkedDir).sort(), ['notes.md']);
    assert.doesNotMatch(runCli(['list', 'project'], { env }).stdout, /Unlink Me/);
  });
});

test('renaming a linked object keeps its path and never renames the directory', () => {
  withSandbox(({ sandboxDir, env }) => {
    const externalDir = makeExternalDir(sandboxDir, 'rename-me');
    const created = parseLastJson(runCli(['sources', 'add', externalDir], { env }).stdout);

    const renamed = parseLastJson(runCli(['write', 'project', JSON.stringify({ id: created.id, name: 'Renamed Project' })], { env }).stdout);
    assert.equal(renamed.name, 'Renamed Project');
    assert.equal(renamed.syncPath, externalDir);

    runCli(['sync'], { env });
    assert.equal(parseLastJson(runCli(['get', 'project', created.id], { env }).stdout).syncPath, externalDir);
    assert.ok(existsSync(externalDir), 'the linked directory keeps its original name on disk');
    assert.deepEqual(readdirSync(externalDir).sort(), ['notes.md']);
  });
});

test('rejects directories inside the sync root, overlaps, and non-directories', () => {
  withSandbox(({ sandboxDir, syncRoot, env }) => {
    const insideRoot = join(syncRoot, 'projects', 'inside');
    mkdirSync(insideRoot, { recursive: true });
    const insideResult = runCli(['sources', 'add', insideRoot], { env, expectFailure: true });
    assert.match(insideResult.stderr, /inside the sync root/);

    const parentDir = join(sandboxDir, 'external', 'nested');
    const childDir = join(parentDir, 'child');
    mkdirSync(childDir, { recursive: true });
    runCli(['sources', 'add', parentDir], { env });
    const overlapResult = runCli(['sources', 'add', childDir], { env, expectFailure: true });
    assert.match(overlapResult.stderr, /overlaps the linked directory/);

    const filePath = join(sandboxDir, 'external', 'not-a-dir.txt');
    writeFileSync(filePath, 'x', 'utf8');
    assert.match(runCli(['sources', 'add', filePath], { env, expectFailure: true }).stderr, /Not a directory/);
    assert.match(runCli(['sources', 'add', join(sandboxDir, 'missing')], { env, expectFailure: true }).stderr, /Directory not found/);
  });
});
