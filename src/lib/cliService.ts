import { invoke } from '@tauri-apps/api/core';
import type { DailyNote, Habit, NoteBlock, Project, ReferenceMaterial, Scripture, TopicNote } from '../shared/types';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MentionSearchResult {
  id: string;
  type: string;
  title: string;
  author?: string;
  date?: string;
  syncPath?: string;
  dropboxPath?: string;
}

export interface ResolvedObjectRef {
  id: string;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit';
  syncPath: string;
  dropboxPath?: string;
}

type CliObjectType = 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit' | 'scripture';

type CliObjectByType = {
  'topic-note': TopicNote;
  'daily-note': DailyNote;
  project: Project;
  'ref-material': ReferenceMaterial;
  habit: Habit;
  scripture: Scripture;
};

function normalizeDropboxPath(path: string): string {
  const value = path.replace(/\\/g, '/').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

function withLegacyPathAlias<T extends { syncPath: string }>(item: T): T & { dropboxPath: string } {
  return {
    ...item,
    dropboxPath: item.syncPath,
  };
}

function normalizePathForLookup(path: string): string {
  return normalizeDropboxPath(path)
    .replace(/[?#].*$/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function decodeHref(rawHref: string): string {
  try {
    return decodeURIComponent(rawHref);
  } catch {
    return rawHref;
  }
}

function toPathLikeHref(href: string): string {
  const value = href.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    return parsed.pathname || value;
  } catch {
    return value;
  }
}

function normalizeRelativeSegments(path: string): string {
  return path
    .replace(/^[./]+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function dirname(path: string): string {
  const parts = splitPath(path);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

function resolveRelativePath(baseFilePath: string, href: string): string {
  const normalizedHref = href.replace(/\\/g, '/').trim();
  if (!normalizedHref) return '';
  if (normalizedHref.startsWith('/')) return normalizeDropboxPath(normalizedHref);

  const baseDirParts = splitPath(dirname(baseFilePath));
  const hrefParts = splitPath(normalizedHref);
  const resolved = [...baseDirParts];

  for (const part of hrefParts) {
    if (part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  return `/${resolved.join('/')}`;
}

async function listObjectPathIndex(): Promise<ResolvedObjectRef[]> {
  const rows: ResolvedObjectRef[] = [];
  const types = ['daily-note', 'topic-note', 'project', 'ref-material', 'habit'] as const;

  for (const type of types) {
    try {
      const stdout = await listObjects(type);
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        const id = parts[0] ?? '';
        const rawPath =
          type === 'project'
            ? (parts[2] ?? '')
            : type === 'ref-material'
              ? (parts[3] ?? '')
            : (parts[3] ?? '');
        const path = rawPath.trim();
        if (!id || !path || path === '(no path)') continue;
        rows.push(withLegacyPathAlias({
          id,
          type,
          syncPath: normalizeDropboxPath(path),
        }));
      }
    } catch {
      // Ignore per-type lookup failures and continue.
    }
  }

  return rows;
}

/**
 * Resolve a markdown link href (absolute sync path or relative path) to a local object.
 */
export async function resolveObjectFromLinkPath(
  href: string,
  currentObjectSyncPath?: string,
): Promise<ResolvedObjectRef | null> {
  const hrefPath = toPathLikeHref(decodeHref(href));
  const cleanedHref = hrefPath.trim().replace(/[?#].*$/, '');
  if (!cleanedHref) return null;

  const index = await listObjectPathIndex();

  // Legacy fallback: some older links store just the object id in href.
  const idLikeHref = cleanedHref.replace(/^#/, '').trim();
  const directIdMatch = index.find((item) => item.id === idLikeHref);
  if (directIdMatch) return directIdMatch;

  const hrefLooksLikeRootRelative = /^dropith\//i.test(cleanedHref);
  const normalizedRootRelativeHref = hrefLooksLikeRootRelative ? `/${cleanedHref}` : cleanedHref;

  const targetPath = normalizedRootRelativeHref.startsWith('/')
    ? normalizeDropboxPath(normalizedRootRelativeHref)
    : currentObjectSyncPath
      ? resolveRelativePath(normalizeDropboxPath(currentObjectSyncPath), normalizedRootRelativeHref)
      : null;

  if (!targetPath) return null;

  const normalizedTargetPath = normalizePathForLookup(targetPath);
  const exactMatch = index.find((item) => normalizePathForLookup(item.syncPath) === normalizedTargetPath);
  if (exactMatch) return exactMatch;

  // Fallback: when links are stored without a stable base path, compare relative/suffix paths.
  const targetRelative = normalizeRelativeSegments(normalizedRootRelativeHref);
  const targetBaseName = splitPath(targetRelative).at(-1) ?? '';
  if (!targetRelative) return null;

  const suffixMatch = index.find((item) => {
    const candidate = normalizePathForLookup(item.syncPath);
    return candidate.endsWith(`/${targetRelative}`) || candidate.endsWith(targetRelative);
  });
  if (suffixMatch) return suffixMatch;

  if (!targetBaseName) return null;
  return index.find((item) => {
    const candidateParts = splitPath(normalizePathForLookup(item.syncPath));
    return candidateParts.at(-1) === targetBaseName;
  }) ?? null;
}

export async function runDropithCli(args: string[]): Promise<CliRunResult> {
  // When running in plain browser mode (not Tauri), avoid hard runtime crashes.
  const tauriInvoke =
    typeof window !== 'undefined' &&
    typeof (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke ===
      'function';

  if (!tauriInvoke) {
    return {
      exitCode: 1,
      stdout: '',
      stderr:
        'Tauri runtime is not available. Launch with `npm run tauri:dev` to enable CLI bridge.',
    };
  }

  return invoke<CliRunResult>('run_dropith_cli', { args });
}

export async function listObjects(type: string): Promise<string> {
  const result = await runDropithCli(['list', type]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `list ${type} failed`);
  return result.stdout;
}

function fallbackBlockId(index: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(16)}${index.toString(16).padStart(2, '0')}`;
  return `blk-${random.slice(0, 12).padEnd(12, '0')}`;
}

function parseLegacyBlocksFromMarkdown(contentMarkdown: string): NoteBlock[] {
  const raw = contentMarkdown.trimEnd();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/).map((p) => p.trimEnd()).filter(Boolean);
  return paragraphs.map((paragraph, index) => {
    const match = /\s*<!--\s*(blk-[a-f0-9]{12})\s*-->\s*$/.exec(paragraph);
    return {
      blockId: match?.[1] ?? fallbackBlockId(index),
      position: index,
      contentMarkdown: match ? paragraph.slice(0, match.index).trimEnd() : paragraph,
    };
  });
}

function normalizeBlocks(rawBlocks: unknown, contentMarkdown: string): NoteBlock[] {
  if (Array.isArray(rawBlocks)) {
    const parsed = rawBlocks
      .map((rawBlock, index) => {
        if (!rawBlock || typeof rawBlock !== 'object') return null;
        const block = rawBlock as Record<string, unknown>;
        const blockId = typeof block.blockId === 'string' && block.blockId
          ? block.blockId
          : fallbackBlockId(index);
        const position = typeof block.position === 'number' ? block.position : index;
        const blockContent = typeof block.contentMarkdown === 'string' ? block.contentMarkdown : '';
        return { blockId, position, contentMarkdown: blockContent };
      })
      .filter((block): block is NoteBlock => Boolean(block));
    if (parsed.length > 0) {
      return parsed.map((block, index) => ({ ...block, position: index }));
    }
  }
  return parseLegacyBlocksFromMarkdown(contentMarkdown);
}

function normalizeNotePayload<T extends TopicNote | DailyNote>(value: T): T {
  const contentMarkdown = typeof value.contentMarkdown === 'string' ? value.contentMarkdown : '';
  const blocks = normalizeBlocks((value as { blocks?: unknown }).blocks, contentMarkdown);
  return { ...value, contentMarkdown, blocks };
}

export async function getObject<T extends CliObjectType>(type: T, id: string): Promise<CliObjectByType[T]> {
  const result = await runDropithCli(['get', type, id]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `get ${type} ${id} failed`);
  const parsed = JSON.parse(result.stdout) as CliObjectByType[T];
  if (type === 'topic-note' || type === 'daily-note') {
    return normalizeNotePayload(parsed as TopicNote | DailyNote) as CliObjectByType[T];
  }
  return parsed;
}

/** DEC-18: Non-interactive create/update for desktop UI. */
export async function writeObject(
  type: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await runDropithCli(['write', type, JSON.stringify(data)]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `write ${type} failed`);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  if (type === 'topic-note' || type === 'daily-note') {
    return normalizeNotePayload(parsed as unknown as TopicNote | DailyNote) as unknown as Record<string, unknown>;
  }
  return parsed;
}

export async function deleteObject(type: string, id: string): Promise<boolean> {
  const result = await runDropithCli(['delete', type, id]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `delete ${type} ${id} failed`);
  }
  return true;
}

/** DEC-19: One-shot local-folder sync triggered from the desktop UI. */
export async function runSync(): Promise<void> {
  const result = await runDropithCli(['sync']);
  if (result.exitCode !== 0) throw new Error(result.stderr || 'sync failed');
}

/**
 * Parse tab-separated list output from the CLI into structured objects.
 * Formats:
 *   daily-note  : id \t date \t preview \t syncPath [\t #tag1, #tag2]
 *   topic-note  : id \t updatedAt \t title \t syncPath \t date \t preview [\t #tag1, #tag2]
 *   project     : id \t name \t syncPath \t startDate [\t #tag1, #tag2]
 *   ref-material: id \t name \t author \t syncPath [\t #tag1, #tag2]
 *   habit       : id \t date \t status \t text \t syncPath [\t #tag1, #tag2]
 */
function parseListOutput(
  type: string,
  stdout: string,
): MentionSearchResult[] {
  const normalizePath = (value: string | undefined): string | undefined => {
    const v = (value ?? '').trim();
    return v && v !== '(no path)' ? v : undefined;
  };

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const id = parts[0] ?? '';
      const path3 = normalizePath(parts[3]);
      const path2 = normalizePath(parts[2]);
      switch (type) {
        case 'daily-note':
          return withLegacyPathAlias({ id, type, title: parts[2] ?? '', date: parts[1], syncPath: path3 ?? '' });
        case 'topic-note':
          return withLegacyPathAlias({ id, type, title: parts[2] ?? '', date: parts[4] ?? '', syncPath: path3 ?? '' });
        case 'project':
          return withLegacyPathAlias({ id, type, title: parts[1] ?? '', syncPath: path2 ?? '', date: parts[3] });
        case 'ref-material':
          return withLegacyPathAlias({ id, type, title: parts[1] ?? '', author: parts[2] ?? '', syncPath: normalizePath(parts[3]) ?? '' });
        case 'habit':
          return withLegacyPathAlias({ id, type, title: parts[3] ?? '', syncPath: normalizePath(parts[4]) ?? '', date: parts[1] });
        default:
          return { id, type, title: parts[1] ?? '' };
      }
    })
    .filter((r) => r.id);
}

/**
 * Search all objects (daily-note, topic-note, project, ref-material, habit)
 * by title or date. Returns up to `limit` results.
 */
export async function searchObjects(
  query: string,
  limit = 10,
): Promise<MentionSearchResult[]> {
  const types = ['daily-note', 'topic-note', 'project', 'ref-material', 'habit'] as const;
  const results: MentionSearchResult[] = [];
  const q = query.toLowerCase();

  await Promise.allSettled(
    types.map(async (type) => {
      try {
        const stdout = await listObjects(type);
        const parsed = parseListOutput(type, stdout);
        for (const item of parsed) {
          if (
            !q ||
            item.title.toLowerCase().includes(q) ||
            (item.author ?? '').toLowerCase().includes(q) ||
            (item.date ?? '').includes(q)
          ) {
            results.push(item);
          }
        }
      } catch {
        // silently skip unavailable types
      }
    }),
  );

  return results.slice(0, limit);
}

/**
 * List daily notes for calendar/list views (returns parsed metadata, not full content).
 */
export async function listDailyNoteMeta(): Promise<
  Array<{ id: string; date: string; preview: string; tags: string[]; type: 'daily-note' }>
> {
  try {
    const stdout = await listObjects('daily-note');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        const rawTags = parts[4] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        return {
          id: parts[0] ?? '',
          date: parts[1] ?? '',
          preview: parts[2] ?? '',
          tags,
          type: 'daily-note' as const,
        };
      })
      .filter((n) => n.id);
  } catch {
    return [];
  }
}

/**
 * List topic notes for list views (metadata only).
 */
export async function listTopicNoteMeta(): Promise<
  Array<{ id: string; title: string; updatedAt: string; date?: string; preview: string; tags: string[]; type: 'topic-note' }>
> {
  try {
    const stdout = await listObjects('topic-note');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        const rawTags = parts[6] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        return {
          id: parts[0] ?? '',
          updatedAt: parts[1] ?? '',
          title: parts[2] ?? '',
          date: (parts[4] ?? '').trim() || undefined,
          preview: parts[5] ?? '',
          tags,
          type: 'topic-note' as const,
        };
      })
      .filter((n) => n.id);
  } catch {
    return [];
  }
}

/**
 * List habits for list/calendar views (metadata only).
 * CLI format: id \t date \t status \t text \t syncPath [\t #tag1, #tag2]
 */
export async function listHabitMeta(): Promise<
  Array<{ id: string; date: string; status: 'planned' | 'accomplished'; text: string; syncPath: string; dropboxPath: string; tags: string[]; type: 'habit' }>
> {
  try {
    const stdout = await listObjects('habit');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        const rawTags = parts[5] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        const status: 'planned' | 'accomplished' = parts[2] === 'accomplished' ? 'accomplished' : 'planned';
        return {
          id: parts[0] ?? '',
          date: parts[1] ?? '',
          status,
          text: parts[3] ?? '',
          ...withLegacyPathAlias({ syncPath: parts[4] ?? '' }),
          tags,
          type: 'habit' as const,
        };
      })
      .filter((n) => n.id);
  } catch {
    return [];
  }
}

/**
 * List projects and ref-materials for file browser (metadata only).
 * Project CLI format: id \t name \t syncPath \t startDate
 */
export async function listFileMeta(): Promise<
  Array<{ id: string; name: string; author?: string; syncPath: string; dropboxPath: string; startDate?: string; tags: string[]; type: 'project' | 'ref-material' }>
> {
  const results: Array<{ id: string; name: string; author?: string; syncPath: string; dropboxPath: string; startDate?: string; tags: string[]; type: 'project' | 'ref-material' }> = [];
  for (const type of ['project', 'ref-material'] as const) {
    try {
      const stdout = await listObjects(type);
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        const rawTags = parts[4] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        if (parts[0]) {
          results.push({
            id: parts[0],
            name: parts[1] ?? '',
            author: type === 'ref-material' ? (parts[2] ?? '') : undefined,
            ...withLegacyPathAlias({ syncPath: type === 'ref-material' ? (parts[3] ?? '') : (parts[2] ?? '') }),
            startDate: type === 'project' ? (parts[3] ?? '') : undefined,
            tags,
            type,
          });
        }
      }
    } catch {
      // silently skip
    }
  }
  return results;
}

export async function listScriptureMeta(): Promise<
  Array<{ id: string; reference: string; passageUrl: string; noteCount: number; type: 'scripture' }>
> {
  try {
    const stdout = await listObjects('scripture');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return {
          id: parts[0] ?? '',
          reference: parts[1] ?? '',
          passageUrl: parts[2] ?? '',
          noteCount: Number.parseInt(parts[3] ?? '0', 10) || 0,
          type: 'scripture' as const,
        };
      })
      .filter((entry) => entry.id);
  } catch {
    return [];
  }
}

export async function getScriptureById(id: string): Promise<Scripture | null> {
  try {
    return await getObject('scripture', id);
  } catch {
    return null;
  }
}

/**
 * Browse directory contents for a project or ref-material.
 * Returns list of files and folders (excluding meta.yaml).
 * CLI format: kind \t name (where kind is 'dir' or 'file')
 */
export async function browseDirectory(
  path: string,
): Promise<Array<{ kind: 'dir' | 'file'; name: string }>> {
  try {
    const result = await runDropithCli(['browse', path]);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'browse failed');

    const lines = result.stdout.split('\n').filter(Boolean);
    // First line is the path itself, skip it
    return lines
      .slice(1)
      .map((line) => {
        const parts = line.split('\t');
        return {
          kind: (parts[0] === 'dir' ? 'dir' : 'file') as 'dir' | 'file',
          name: parts[1] ?? '',
        };
      })
      .filter((e) => e.name && e.name !== 'meta.yaml'); // Exclude meta.yaml
  } catch {
    return [];
  }
}
