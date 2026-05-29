/* eslint-env node */

import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../cli/app.mjs';

const {
  parseProjectMetaYaml,
  parseProjectSyncFolderEntry,
  parseRefMaterialMetaYaml,
  parseRefMaterialSyncFolderEntry,
} = __testing;

test('sync parser ignores serialized project path metadata and derives syncPath from scanned folder', () => {
  const content = [
    'id: project-123',
    'name: Alpha Project',
    'startDate: 2026-05-01',
    'endDate: 2026-05-31',
    'tags: ["Planning"]',
    'createdAt: 2026-05-01T12:00:00.000Z',
    'updatedAt: 2026-05-02T12:00:00.000Z',
    'syncPath: /wrong/project/path',
    'sync_path: /wrong/project/path-2',
    'dropboxPath: /wrong/project/dropbox-path',
    'dropbox_path: /wrong/project/dropbox-path-2',
  ].join('\n') + '\n';

  const rawParsed = parseProjectMetaYaml(content);
  assert.ok(rawParsed, 'project meta parser should accept valid meta.yaml content');
  assert.equal(rawParsed.name, 'Alpha Project');
  assert.equal(rawParsed.startDate, '2026-05-01');
  assert.equal(rawParsed.endDate, '2026-05-31');
  assert.deepEqual(rawParsed.tagNames, ['Planning']);
  assert.equal(Object.hasOwn(rawParsed, 'syncPath'), false, 'raw parser should not trust serialized syncPath metadata');
  assert.equal(Object.hasOwn(rawParsed, 'dropboxPath'), false, 'raw parser should ignore legacy dropbox path metadata');

  const folder = {
    name: 'manual-project-folder',
    path: '/tmp/puzzlepkm-sync/projects/manual-project-folder',
  };
  const folderParsed = parseProjectSyncFolderEntry(content, folder);
  assert.ok(folderParsed, 'folder-backed project parser should produce a sync entry');
  assert.equal(folderParsed.syncPath, folder.path);
  assert.equal(folderParsed.folderPath, folder.path);
  assert.equal(folderParsed.slug, folder.name);
  assert.equal(folderParsed.syncPath, '/tmp/puzzlepkm-sync/projects/manual-project-folder');
  assert.notEqual(folderParsed.syncPath, '/wrong/project/path');
});

test('sync parser ignores serialized ref-material path metadata and derives syncPath from scanned folder', () => {
  const content = [
    'id: ref-123',
    'name: Alpha Reference',
    'author: Test Author',
    'tags: ["Library"]',
    'createdAt: 2026-05-01T12:00:00.000Z',
    'updatedAt: 2026-05-02T12:00:00.000Z',
    'syncPath: /wrong/ref-material/path',
    'sync_path: /wrong/ref-material/path-2',
    'dropboxPath: /wrong/ref-material/dropbox-path',
    'dropbox_path: /wrong/ref-material/dropbox-path-2',
  ].join('\n') + '\n';

  const rawParsed = parseRefMaterialMetaYaml(content);
  assert.ok(rawParsed, 'ref-material meta parser should accept valid meta.yaml content');
  assert.equal(rawParsed.name, 'Alpha Reference');
  assert.equal(rawParsed.author, 'Test Author');
  assert.deepEqual(rawParsed.tagNames, ['Library']);
  assert.equal(Object.hasOwn(rawParsed, 'syncPath'), false, 'raw parser should not trust serialized syncPath metadata');
  assert.equal(Object.hasOwn(rawParsed, 'dropboxPath'), false, 'raw parser should ignore legacy dropbox path metadata');

  const folder = {
    name: 'manual-reference-folder',
    path: '/tmp/puzzlepkm-sync/ref-materials/manual-reference-folder',
  };
  const folderParsed = parseRefMaterialSyncFolderEntry(content, folder);
  assert.ok(folderParsed, 'folder-backed ref-material parser should produce a sync entry');
  assert.equal(folderParsed.syncPath, folder.path);
  assert.equal(folderParsed.folderPath, folder.path);
  assert.equal(folderParsed.slug, folder.name);
  assert.equal(folderParsed.syncPath, '/tmp/puzzlepkm-sync/ref-materials/manual-reference-folder');
  assert.notEqual(folderParsed.syncPath, '/wrong/ref-material/path');
});

