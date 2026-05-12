import { invoke } from '@tauri-apps/api/core';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface MentionSearchResult {
  id: string;
  type: string;
  title: string;
  date?: string;
  dropboxPath?: string;
}

export interface ResolvedObjectRef {
  id: string;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit';
  dropboxPath: string;
}

function normalizeDropboxPath(path: string): string {
  const value = path.replace(/\\/g, '/').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
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
          type === 'project' || type === 'ref-material'
            ? (parts[2] ?? '')
            : (parts[3] ?? '');
        const path = rawPath.trim();
        if (!id || !path || path === '(no path)') continue;
        rows.push({
          id,
          type,
          dropboxPath: normalizeDropboxPath(path),
        });
      }
    } catch {
      // Ignore per-type lookup failures and continue.
    }
  }

  return rows;
}

/**
 * Resolve a markdown link href (absolute Dropbox path or relative path) to a local object.
 */
export async function resolveObjectFromLinkPath(
  href: string,
  currentObjectDropboxPath?: string,
): Promise<ResolvedObjectRef | null> {
  const cleanedHref = href.trim();
  if (!cleanedHref) return null;

  const targetPath = cleanedHref.startsWith('/')
    ? normalizeDropboxPath(cleanedHref)
    : currentObjectDropboxPath
      ? resolveRelativePath(normalizeDropboxPath(currentObjectDropboxPath), cleanedHref)
      : null;

  if (!targetPath) return null;

  const index = await listObjectPathIndex();
  return index.find((item) => normalizeDropboxPath(item.dropboxPath) === targetPath) ?? null;
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

export async function getObject(type: string, id: string): Promise<Record<string, unknown>> {
  const result = await runDropithCli(['get', type, id]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `get ${type} ${id} failed`);
  return JSON.parse(result.stdout);
}

/** DEC-18: Non-interactive create/update for desktop UI. */
export async function writeObject(
  type: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await runDropithCli(['write', type, JSON.stringify(data)]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `write ${type} failed`);
  return JSON.parse(result.stdout);
}

export async function deleteObject(type: string, id: string): Promise<boolean> {
  const result = await runDropithCli(['delete', type, id]);
  return result.exitCode === 0;
}

/** DEC-19: One-shot Dropbox sync triggered from the desktop UI. */
export async function runSync(): Promise<void> {
  const result = await runDropithCli(['sync']);
  if (result.exitCode !== 0) throw new Error(result.stderr || 'sync failed');
}

/**
 * Parse tab-separated list output from the CLI into structured objects.
 * Formats:
 *   daily-note  : id \t date \t preview \t dropboxPath [\t #tag1, #tag2]
 *   topic-note  : id \t updatedAt \t title \t dropboxPath [\t #tag1, #tag2]
 *   project     : id \t name \t dropboxPath \t startDate [\t #tag1, #tag2]
 *   ref-material: id \t name \t dropboxPath [\t #tag1, #tag2]
 *   habit       : id \t date \t text \t dropboxPath [\t #tag1, #tag2]
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
      switch (type) {
        case 'daily-note':
          return { id, type, title: parts[2] ?? '', date: parts[1], dropboxPath: normalizePath(parts[3]) };
        case 'topic-note':
          return { id, type, title: parts[2] ?? '', date: parts[1], dropboxPath: normalizePath(parts[3]) };
        case 'project':
          return { id, type, title: parts[1] ?? '', dropboxPath: normalizePath(parts[2]), date: parts[3] };
        case 'ref-material':
          return { id, type, title: parts[1] ?? '', dropboxPath: normalizePath(parts[2]) };
        case 'habit':
          return { id, type, title: parts[2] ?? '', dropboxPath: normalizePath(parts[3]), date: parts[1] };
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
  Array<{ id: string; title: string; updatedAt: string; tags: string[]; type: 'topic-note' }>
> {
  try {
    const stdout = await listObjects('topic-note');
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
          updatedAt: parts[1] ?? '',
          title: parts[2] ?? '',
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
 * CLI format: id \t date \t text \t dropboxPath [\t #tag1, #tag2]
 */
export async function listHabitMeta(): Promise<
  Array<{ id: string; date: string; text: string; dropboxPath: string; tags: string[]; type: 'habit' }>
> {
  try {
    const stdout = await listObjects('habit');
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
          text: parts[2] ?? '',
          dropboxPath: parts[3] ?? '',
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
 * Project CLI format: id \t name \t dropboxPath \t startDate
 */
export async function listFileMeta(): Promise<
  Array<{ id: string; name: string; dropboxPath: string; startDate?: string; type: 'project' | 'ref-material' }>
> {
  const results: Array<{ id: string; name: string; dropboxPath: string; startDate?: string; type: 'project' | 'ref-material' }> = [];
  for (const type of ['project', 'ref-material'] as const) {
    try {
      const stdout = await listObjects(type);
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        if (parts[0]) {
          results.push({
            id: parts[0],
            name: parts[1] ?? '',
            dropboxPath: parts[2] ?? '',
            startDate: type === 'project' ? (parts[3] ?? '') : undefined,
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
