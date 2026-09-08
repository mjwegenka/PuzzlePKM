import { invoke } from '@tauri-apps/api/core';
import type { DailyNote, Habit, Project, ReferenceMaterial, Scripture, ScriptureChapter, TopicNote } from '../shared/types';
import { getObjectDisplayTitle } from './objectTypeDefinitions';
import { normalizeNoteBlocks } from './noteBlocks';
import { formatDatePretty, parseDateQueryToISO } from './dateUtils';

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BackgroundSyncStatus {
  syncing: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastSucceededAt: number | null;
  lastError: string | null;
}

interface BackgroundSyncStartResult {
  started: boolean;
  status: BackgroundSyncStatus;
}

function stripNodeWarnings(stderr: string): string {
  const lines = String(stderr ?? '').split('\n');
  const filtered: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes('ExperimentalWarning: SQLite is an experimental feature')) continue;
    if (/^\(node:\d+\)\s*ExperimentalWarning:/.test(trimmed)) continue;
    if (trimmed.startsWith('(Use `node --trace-warnings')) continue;
    filtered.push(line);
  }
  return filtered.join('\n').trim();
}

export interface MentionSearchResult {
  id: string;
  type: string;
  title: string;
  author?: string;
  date?: string;
  syncPath?: string;
  blockId?: string;
  matchType?: 'object' | 'block';
  blockPreview?: string;
  /** True for synthetic "create new" options that don't yet exist in the DB. */
  isNew?: boolean;
}

export interface TopicNoteMeta {
  id: string;
  title: string;
  updatedAt: string;
  date?: string;
  preview: string;
  contentSearch?: string;
  firstBlockId?: string;
  tags: string[];
  displayTitle: string;
  type: 'topic-note';
}

export interface DailyNoteMeta {
  id: string;
  date: string;
  preview: string;
  contentSearch?: string;
  firstBlockId?: string;
  tags: string[];
  displayTitle: string;
  type: 'daily-note';
}

export interface HabitMeta {
  id: string;
  date: string;
  status: 'planned' | 'accomplished';
  text: string;
  contentSearch?: string;
  syncPath: string;
  tags: string[];
  displayTitle: string;
  type: 'habit';
}

export interface FileMeta {
  id: string;
  name: string;
  author?: string;
  syncPath: string;
  startDate?: string;
  tags: string[];
  displayTitle: string;
  type: 'project' | 'ref-material';
}

export interface ScriptureMeta {
  id: string;
  reference: string;
  passageUrl: string;
  noteCount: number;
  displayTitle: string;
  type: 'scripture';
}

export interface ScriptureChapterMeta {
  id: string;
  reference: string;
  bookName: string;
  bookOrder: number;
  chapter: number;
  passageUrl: string;
  /** Distinct verse-level references that roll up into this chapter. */
  referenceCount: number;
  /** Distinct notes citing this chapter through any of those references. */
  noteCount: number;
  displayTitle: string;
  type: 'scripture-chapter';
}

export interface NoteBlockMeta {
  noteId: string;
  noteType: 'topic-note' | 'daily-note';
  blockId: string;
  position: number;
  preview: string;
}

export interface MetaBundle {
  topicNotes: TopicNoteMeta[];
  dailyNotes: DailyNoteMeta[];
  habits: HabitMeta[];
  files: FileMeta[];
  scriptures: ScriptureMeta[];
  scriptureChapters: ScriptureChapterMeta[];
  scriptureChapterLinks: Array<{ scriptureId: string; chapterId: string }>;
  tags: TagSummary[];
  objectLinks: Array<{ sourceId: string; targetId: string }>;
  noteBlocks: NoteBlockMeta[];
}

interface MentionIndexEntry {
  id: string;
  type: MentionSearchResult['type'];
  title: string;
  titleSearch: string;
  author?: string;
  authorSearch?: string;
  date?: string;
  dateSearch?: string;
  syncPath?: string;
  blockId?: string;
  matchType: 'object' | 'block';
  blockPreview?: string;
  blockPreviewSearch?: string;
  tags: string[];
  tagsSearch: string[];
  searchableText: string;
  prettyDateSearch?: string;
  sourceOrder: number;
  typeOrder: number;
}

interface RankedMentionMatch {
  entry: MentionIndexEntry;
  rank: MentionRank;
}

interface SearchObjectsOptions {
  signal?: AbortSignal;
}

export interface SearchRankingCandidate {
  id: string;
  type: string;
  title: string;
  author?: string;
  date?: string;
  metadata?: string;
  snippet?: string;
  contentSearch?: string;
  syncPath?: string;
  blockId?: string;
  matchType?: 'object' | 'block';
  blockPreview?: string;
  tags?: string[];
  sourceOrder?: number;
  typeOrder?: number;
}

export interface RankedSearchCandidate<T extends SearchRankingCandidate> {
  item: T;
  rank: MentionRank;
}

let metaBundleInFlight: Promise<MetaBundle> | null = null;
let metaBundleCache: MetaBundle | null = null;
let mentionIndexInFlight: Promise<MentionIndexEntry[]> | null = null;
let mentionIndexCache: MentionIndexEntry[] | null = null;
let mentionIndexKnownTagsCache: Set<string> | null = null;
let mentionSearchCache = new Map<string, MentionSearchResult[]>();

function invalidateMetaCaches(): void {
  metaBundleCache = null;
  metaBundleInFlight = null;
  mentionIndexCache = null;
  mentionIndexInFlight = null;
  mentionIndexKnownTagsCache = null;
  mentionSearchCache = new Map<string, MentionSearchResult[]>();
}

if (typeof window !== 'undefined') {
  const flag = '__puzzlepkmMentionIndexInvalidationBound__';
  const runtimeWindow = window as unknown as Record<string, unknown>;
  if (runtimeWindow[flag] !== true) {
    window.addEventListener('puzzlepkm:objects-updated', () => {
      invalidateMetaCaches();
    });
    runtimeWindow[flag] = true;
  }
}

export interface ResolvedObjectRef {
  id: string;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit' | 'scripture' | 'scripture-chapter' | 'tag';
  syncPath: string;
  /** Block fragment extracted from a `objectId#blockId` link, if present. */
  blockId?: string;
}

export interface TagSummary {
  id: string;
  name: string;
  displayName: string;
  objectCount: number;
}

type CliObjectType = 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit' | 'scripture' | 'scripture-chapter' | 'tag';

type CliObjectByType = {
  'topic-note': TopicNote;
  'daily-note': DailyNote;
  project: Project;
  'ref-material': ReferenceMaterial;
  habit: Habit;
  scripture: Scripture;
  'scripture-chapter': ScriptureChapter;
  tag: Record<string, unknown>;
};

function normalizeSyncPath(path: string): string {
  const value = path.replace(/\\/g, '/').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizePathForLookup(path: string): string {
  return normalizeSyncPath(path)
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
  if (normalizedHref.startsWith('/')) return normalizeSyncPath(normalizedHref);

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
        rows.push({
          id,
          type,
          syncPath: normalizeSyncPath(path),
        });
      }
    } catch {
      // Ignore per-type lookup failures and continue.
    }
  }

  return rows;
}

/**
 * Resolve a markdown link href (UUID, absolute sync path, or relative path) to a local object.
 * Fragment (`#blockId`) is extracted and returned as `blockId` on the resolved ref.
 */
export async function resolveObjectFromLinkPath(
  href: string,
  currentObjectSyncPath?: string,
): Promise<ResolvedObjectRef | null> {
  const hrefPath = toPathLikeHref(decodeHref(href));
  const hrefWithoutQuery = hrefPath.trim().replace(/\?.*$/, '');
  const hashIndex = hrefWithoutQuery.indexOf('#');
  const cleanedHref = (hashIndex >= 0 ? hrefWithoutQuery.slice(0, hashIndex) : hrefWithoutQuery).trim();
  const fragment = (hashIndex >= 0 ? hrefWithoutQuery.slice(hashIndex + 1) : '').trim();
  const blockId = /^blk-[a-f0-9]{12}$/.test(fragment) ? fragment : undefined;

  if (!cleanedHref) return null;

  const index = await listObjectPathIndex();

  // Legacy fallback: some older links store just the object id in href.
  const idLikeHref = cleanedHref.replace(/^#/, '').trim();
  const directIdMatch = index.find((item) => item.id === idLikeHref);
  if (directIdMatch) return blockId ? { ...directIdMatch, blockId } : directIdMatch;

  const hrefLooksLikeRootRelative = /^puzzlepkm\//i.test(cleanedHref);
  const normalizedRootRelativeHref = hrefLooksLikeRootRelative ? `/${cleanedHref}` : cleanedHref;

  const targetPath = normalizedRootRelativeHref.startsWith('/')
    ? normalizeSyncPath(normalizedRootRelativeHref)
    : currentObjectSyncPath
      ? resolveRelativePath(normalizeSyncPath(currentObjectSyncPath), normalizedRootRelativeHref)
      : null;

  if (!targetPath) return null;

  const normalizedTargetPath = normalizePathForLookup(targetPath);
  const exactMatch = index.find((item) => normalizePathForLookup(item.syncPath) === normalizedTargetPath);
  if (exactMatch) return blockId ? { ...exactMatch, blockId } : exactMatch;

  // Fallback: when links are stored without a stable base path, compare relative/suffix paths.
  const targetRelative = normalizeRelativeSegments(normalizedRootRelativeHref);
  const targetBaseName = splitPath(targetRelative).at(-1) ?? '';
  if (!targetRelative) return null;

  const suffixMatch = index.find((item) => {
    const candidate = normalizePathForLookup(item.syncPath);
    return candidate.endsWith(`/${targetRelative}`) || candidate.endsWith(targetRelative);
  });
  if (suffixMatch) return blockId ? { ...suffixMatch, blockId } : suffixMatch;

  if (!targetBaseName) return null;
  const baseNameMatch = index.find((item) => {
    const candidateParts = splitPath(normalizePathForLookup(item.syncPath));
    return candidateParts.at(-1) === targetBaseName;
  }) ?? null;
  return baseNameMatch && blockId ? { ...baseNameMatch, blockId } : baseNameMatch;
}

export async function runPuzzlePKMCli(args: string[]): Promise<CliRunResult> {
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

  const result = await invoke<CliRunResult>('run_puzzlepkm_cli', { args });
  return {
    ...result,
    stderr: stripNodeWarnings(result.stderr),
  };
}

export function isTauriRuntimeAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function';
}

export async function getBackgroundSyncStatus(): Promise<BackgroundSyncStatus> {
  if (!isTauriRuntimeAvailable()) {
    return {
      syncing: false,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      lastError: 'Tauri runtime is not available. Launch with `npm run tauri:dev` to enable sync.',
    };
  }
  return invoke<BackgroundSyncStatus>('get_background_sync_status');
}

export async function startBackgroundSync(): Promise<BackgroundSyncStartResult> {
  if (!isTauriRuntimeAvailable()) {
    throw new Error('Tauri runtime is not available. Launch with `npm run tauri:dev` to enable sync.');
  }
  return invoke<BackgroundSyncStartResult>('start_background_sync');
}

export async function listObjects(type: string): Promise<string> {
  const result = await runPuzzlePKMCli(['list', type]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `list ${type} failed`);
  return result.stdout;
}

function normalizeNotePayload<T extends TopicNote | DailyNote>(value: T): T {
  const contentMarkdown = typeof value.contentMarkdown === 'string' ? value.contentMarkdown : '';
  const blocks = normalizeNoteBlocks((value as { blocks?: unknown }).blocks, contentMarkdown);
  return { ...value, contentMarkdown, blocks };
}

export async function getObject<T extends CliObjectType>(type: T, id: string): Promise<CliObjectByType[T]> {
  const result = await runPuzzlePKMCli(['get', type, id]);
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
  const result = await runPuzzlePKMCli(['write', type, JSON.stringify(data)]);
  if (result.exitCode !== 0) throw new Error(result.stderr || `write ${type} failed`);
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  invalidateMetaCaches();
  if (type === 'topic-note' || type === 'daily-note') {
    return normalizeNotePayload(parsed as unknown as TopicNote | DailyNote) as unknown as Record<string, unknown>;
  }
  return parsed;
}

export async function deleteObject(type: string, id: string): Promise<boolean> {
  const result = await runPuzzlePKMCli(['delete', type, id]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `delete ${type} ${id} failed`);
  }
  invalidateMetaCaches();
  return true;
}

/**
 * DEC-80: Directories outside the sync root, linked in place as a single project
 * or reference material. Nothing is ever written into a linked directory.
 */
export type LinkedSourceType = 'project' | 'ref-material';

export interface LinkedSource {
  objectType: LinkedSourceType;
  objectId: string;
  name: string;
  path: string;
  readOnly: boolean;
  available: boolean;
}

export async function listLinkedSources(): Promise<LinkedSource[]> {
  const result = await runPuzzlePKMCli(['settings', 'show']);
  if (result.exitCode !== 0) throw new Error(result.stderr || 'settings show failed');
  const parsed = JSON.parse(result.stdout) as { sync?: { linkedSources?: LinkedSource[] } };
  return parsed.sync?.linkedSources ?? [];
}

export async function addLinkedSource(
  path: string,
  objectType: LinkedSourceType,
  name?: string,
): Promise<{ id: string; name: string; syncPath: string }> {
  const args = ['sources', 'add', path, '--type', objectType];
  const trimmedName = String(name ?? '').trim();
  if (trimmedName) args.push('--name', trimmedName);
  const result = await runPuzzlePKMCli(args);
  if (result.exitCode !== 0) throw new Error(cleanCliError(result.stderr) || 'Could not link that directory');
  invalidateMetaCaches();
  // `sources add` prints a confirmation line followed by the created record.
  const start = result.stdout.indexOf('{');
  const end = result.stdout.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Linked the folder but could not read back the new record.');
  return JSON.parse(result.stdout.slice(start, end + 1)) as { id: string; name: string; syncPath: string };
}

export type LinkCandidateStatus = 'eligible' | 'linked' | 'inside-root' | 'overlaps';

export interface LinkCandidate {
  name: string;
  path: string;
  status: LinkCandidateStatus;
  reason: string;
}

export interface BulkLinkResult {
  added: Array<{ path: string; id: string; name: string }>;
  failed: Array<{ path: string; error: string }>;
}

/** Lists a parent folder's immediate subdirectories as bulk-link candidates. Creates nothing. */
export async function scanLinkCandidates(parentPath: string): Promise<{ parent: string; candidates: LinkCandidate[] }> {
  const result = await runPuzzlePKMCli(['sources', 'scan', parentPath]);
  if (result.exitCode !== 0) throw new Error(cleanCliError(result.stderr) || 'Could not read that folder');
  return JSON.parse(result.stdout) as { parent: string; candidates: LinkCandidate[] };
}

/** Links several directories in one CLI pass; partial failures come back per path. */
export async function addLinkedSources(
  paths: string[],
  objectType: LinkedSourceType,
): Promise<BulkLinkResult> {
  if (paths.length === 0) return { added: [], failed: [] };
  if (paths.length === 1) {
    try {
      const record = await addLinkedSource(paths[0], objectType);
      return { added: [{ path: paths[0], id: record.id, name: record.name }], failed: [] };
    } catch (e) {
      return { added: [], failed: [{ path: paths[0], error: e instanceof Error ? e.message : String(e) }] };
    }
  }
  const result = await runPuzzlePKMCli(['sources', 'add', ...paths, '--type', objectType]);
  if (result.exitCode !== 0) throw new Error(cleanCliError(result.stderr) || 'Could not link those directories');
  invalidateMetaCaches();
  const start = result.stdout.indexOf('{');
  const end = result.stdout.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Linked the folders but could not read back the result.');
  return JSON.parse(result.stdout.slice(start, end + 1)) as BulkLinkResult;
}

/**
 * DEC-79: one match inside a file held by a project or reference material.
 * `id` addresses the indexed document, not an object in the knowledge base.
 */
export interface DocumentSearchResult {
  id: string;
  objectType: LinkedSourceType;
  objectId: string;
  objectName: string;
  fileName: string;
  relativePath: string;
  filePath: string;
  extension: string;
  characterCount: number;
  indexedAt: string;
  snippet: string;
}

/**
 * Full-text search across the PDFs, Word documents and Markdown files indexed
 * from project and reference-material folders. Returns [] rather than throwing:
 * document hits widen the Library board, so a failure here should never take
 * the rest of the search results down with it.
 */
export async function searchDocuments(query: string, limit = 30): Promise<DocumentSearchResult[]> {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return [];

  try {
    const result = await runPuzzlePKMCli(['documents', 'search', trimmed, '--limit', String(limit), '--json']);
    if (result.exitCode !== 0) return [];
    const start = result.stdout.indexOf('[');
    const end = result.stdout.lastIndexOf(']');
    if (start < 0 || end < start) return [];
    const parsed = JSON.parse(result.stdout.slice(start, end + 1)) as DocumentSearchResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Opens the native folder picker and returns the chosen directory, or null if dismissed. */
export async function pickDirectory(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Opens the native folder picker and links the chosen directory as one project or
 * reference material. Resolves to null when the picker is dismissed.
 */
export async function linkDirectoryViaPicker(
  objectType: LinkedSourceType,
  label: string,
): Promise<{ id: string; name: string; syncPath: string } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: `Choose a folder to add as a ${label}`,
  });
  if (typeof selected !== 'string') return null;
  return addLinkedSource(selected, objectType);
}

export async function removeLinkedSource(pathOrId: string): Promise<void> {
  const result = await runPuzzlePKMCli(['sources', 'remove', pathOrId]);
  if (result.exitCode !== 0) throw new Error(cleanCliError(result.stderr) || 'Could not unlink that directory');
  invalidateMetaCaches();
}

/** CLI errors arrive as "Error: <message>" across one or more lines; show just the message. */
function cleanCliError(stderr: string): string {
  return String(stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^Error:\s*/i, ''))
    .join(' ')
    .trim();
}

export async function convertTopicNoteToProject(id: string): Promise<Record<string, unknown>> {
  const result = await runPuzzlePKMCli(['convert-to-project', id]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `convert-to-project ${id} failed`);
  }
  invalidateMetaCaches();
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

/** DEC-19: One-shot local-folder sync triggered from the desktop UI. */
export async function runSync(): Promise<void> {
  const result = await startBackgroundSync();
  if (result.status.lastError) throw new Error(result.status.lastError);
}

const MENTION_TYPE_ORDER: Record<string, number> = {
  'topic-note': 0,
  'daily-note': 1,
  habit: 2,
  project: 3,
  'ref-material': 4,
};

const MENTION_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'without', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'this', 'that', 'these', 'those',
]);

const MENTION_TIER_BASE = {
  projectTitle: 700,
  refTitle: 620,
  refAuthor: 560,
  otherTitle: 500,
  date: 380,
  tag: 320,
  block: 120,
} as const;

function normalizeForSearch(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function tokenizeForSearch(value: string): string[] {
  return normalizeForSearch(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

function uniqueTokens(value: string[]): string[] {
  return Array.from(new Set(value));
}

function parseMentionQuery(query: string, knownTags: Set<string>) {
  const normalized = normalizeForSearch(query);
  const queryTokens = tokenizeForSearch(query);
  const hashtagTokens = uniqueTokens(
    queryTokens
      .filter((token) => token.startsWith('#'))
      .map((token) => token.slice(1))
      .filter(Boolean),
  );
  const plainTokens = queryTokens
    .map((token) => token.replace(/^#/, ''))
    .filter(Boolean);
  const nonStopTokens = plainTokens.filter((token) => !MENTION_STOP_WORDS.has(token));
  const effectiveTokens = nonStopTokens.length >= 2 ? nonStopTokens : plainTokens;
  const inferredTagTokens = hashtagTokens.length > 0
    ? []
    : effectiveTokens.filter((token) => knownTags.has(token));
  const dateIntent = parseDateQueryToISO(normalized);
  return {
    normalized,
    phrase: normalized,
    tokens: uniqueTokens(effectiveTokens),
    hashtagTokens,
    inferredTagTokens: uniqueTokens(inferredTagTokens),
    dateIntent,
  };
}

interface TokenFieldScore {
  matched: boolean;
  score: number;
  textQuality: number;
}

function scoreFieldMatch(
  haystack: string,
  phrase: string,
  tokens: string[],
): TokenFieldScore {
  const text = normalizeForSearch(haystack);
  if (!text) return { matched: false, score: 0, textQuality: 0 };

  if (!tokens.length && !phrase) return { matched: true, score: 1, textQuality: 0 };

  const phraseMatch = Boolean(phrase) && text.includes(phrase);
  const startsMatch = Boolean(phrase) && text.startsWith(phrase);
  const tokenPositions: number[] = [];
  let matchedTokens = 0;

  for (const token of tokens) {
    const idx = text.indexOf(token);
    if (idx >= 0) {
      matchedTokens += 1;
      tokenPositions.push(idx);
    }
  }

  const coverage = tokens.length > 0 ? matchedTokens / tokens.length : (phraseMatch ? 1 : 0);
  const allTokensPresent = tokens.length > 0 && matchedTokens === tokens.length;

  let orderedTokens = 0;
  if (tokens.length > 0) {
    let cursor = -1;
    for (const token of tokens) {
      const idx = text.indexOf(token, cursor + 1);
      if (idx < 0) break;
      orderedTokens += 1;
      cursor = idx;
    }
  }
  const orderedTokenBonus = tokens.length > 1 && orderedTokens === tokens.length ? 15 : 0;

  let proximityBonus = 0;
  if (allTokensPresent && tokenPositions.length > 1) {
    const span = Math.max(...tokenPositions) - Math.min(...tokenPositions);
    proximityBonus = Math.max(0, 20 - Math.floor(span / 12));
  }

  const extraNoisePenalty = allTokensPresent
    ? Math.max(0, Math.floor(text.split(/\s+/).length - tokens.length * 3))
    : 0;

  const score = (phraseMatch ? 100 : 0)
    + (startsMatch ? 70 : 0)
    + (allTokensPresent ? 50 : 0)
    + Math.round(30 * coverage)
    + orderedTokenBonus
    + proximityBonus
    - Math.min(20, extraNoisePenalty);

  const matched = phraseMatch || matchedTokens > 0;
  const textQuality = Math.round(coverage * 100) + orderedTokenBonus + proximityBonus;
  return { matched, score, textQuality };
}

interface MentionRank {
  tier: number;
  tierBase: number;
  fieldScore: number;
  intentScore: number;
  textQuality: number;
  recencyScore: number;
  totalScore: number;
}

function rankMentionEntry(
  entry: MentionIndexEntry,
  query: ReturnType<typeof parseMentionQuery>,
): MentionRank {
  if (!query.normalized) {
    const defaultTier = entry.matchType === 'block' ? 1 : 4;
    const defaultTierBase = entry.matchType === 'block' ? MENTION_TIER_BASE.block : MENTION_TIER_BASE.otherTitle;
    const recencyScore = Math.max(0, 240 - entry.sourceOrder);
    const totalScore = defaultTierBase + recencyScore - Math.round(entry.typeOrder * 5);
    return {
      tier: defaultTier,
      tierBase: defaultTierBase,
      fieldScore: 0,
      intentScore: 0,
      textQuality: 0,
      recencyScore,
      totalScore,
    };
  }

  const titleSignal = scoreFieldMatch(entry.titleSearch, query.phrase, query.tokens);
  const authorSignal = entry.authorSearch
    ? scoreFieldMatch(entry.authorSearch, query.phrase, query.tokens)
    : { matched: false, score: 0, textQuality: 0 };
  const blockSignal = entry.blockPreviewSearch
    ? scoreFieldMatch(entry.blockPreviewSearch, query.phrase, query.tokens)
    : { matched: false, score: 0, textQuality: 0 };
  const dateSignal = entry.dateSearch
    ? scoreFieldMatch(`${entry.dateSearch} ${entry.prettyDateSearch ?? ''}`, query.phrase, query.tokens)
    : { matched: false, score: 0, textQuality: 0 };

  const exactTagHits = query.hashtagTokens.filter((tag) => entry.tagsSearch.includes(tag)).length;
  const inferredTagHits = query.inferredTagTokens.filter((tag) => entry.tagsSearch.includes(tag)).length;
  const tagHitCount = exactTagHits + inferredTagHits;
  const tagScore = tagHitCount > 0
    ? exactTagHits * 90 + inferredTagHits * 50 + Math.max(0, tagHitCount - 1) * 15
    : 0;

  let dateIntentScore = dateSignal.score;
  if (query.dateIntent && entry.dateSearch) {
    if (entry.dateSearch === query.dateIntent) {
      dateIntentScore += 120;
    } else if (entry.dateSearch.startsWith(query.dateIntent.slice(0, 7))) {
      dateIntentScore += 40;
    }
  }

  let tier = 0;
  let tierBase = 0;
  let fieldScore = 0;
  if (entry.type === 'project' && titleSignal.matched) {
    tier = 7;
    tierBase = MENTION_TIER_BASE.projectTitle;
    fieldScore = titleSignal.score;
  } else if (entry.type === 'ref-material' && titleSignal.matched) {
    tier = 6;
    tierBase = MENTION_TIER_BASE.refTitle;
    fieldScore = titleSignal.score;
  } else if (entry.type === 'ref-material' && authorSignal.matched) {
    tier = 5;
    tierBase = MENTION_TIER_BASE.refAuthor;
    fieldScore = authorSignal.score;
  } else if (titleSignal.matched && entry.matchType === 'object') {
    tier = 4;
    tierBase = MENTION_TIER_BASE.otherTitle;
    fieldScore = titleSignal.score;
  } else if (dateIntentScore > 0) {
    tier = 3;
    tierBase = MENTION_TIER_BASE.date;
    fieldScore = dateIntentScore;
  } else if (tagScore > 0) {
    tier = 2;
    tierBase = MENTION_TIER_BASE.tag;
    fieldScore = tagScore;
  } else if (entry.matchType === 'block' && blockSignal.matched) {
    tier = 1;
    tierBase = MENTION_TIER_BASE.block;
    fieldScore = blockSignal.score;
  }

  if (tier === 0) {
    return {
      tier,
      tierBase,
      fieldScore: 0,
      intentScore: 0,
      textQuality: 0,
      recencyScore: 0,
      totalScore: 0,
    };
  }

  const intentScore = Math.min(120, dateIntentScore) + Math.min(120, tagScore);
  const textQuality = Math.max(titleSignal.textQuality, authorSignal.textQuality, blockSignal.textQuality, dateSignal.textQuality);
  const recencyScore = Math.max(0, 240 - entry.sourceOrder);
  const totalScore = tierBase + fieldScore + intentScore + textQuality + recencyScore - Math.round(entry.typeOrder * 5);

  return { tier, tierBase, fieldScore, intentScore, textQuality, recencyScore, totalScore };
}

function compareRankedMentionMatches(a: RankedMentionMatch, b: RankedMentionMatch): number {
  if (a.rank.tier !== b.rank.tier) return b.rank.tier - a.rank.tier;
  if (a.rank.fieldScore !== b.rank.fieldScore) return b.rank.fieldScore - a.rank.fieldScore;
  if (a.rank.intentScore !== b.rank.intentScore) return b.rank.intentScore - a.rank.intentScore;
  if (a.rank.textQuality !== b.rank.textQuality) return b.rank.textQuality - a.rank.textQuality;
  if (a.rank.recencyScore !== b.rank.recencyScore) return b.rank.recencyScore - a.rank.recencyScore;
  if (a.rank.totalScore !== b.rank.totalScore) return b.rank.totalScore - a.rank.totalScore;
  if (a.entry.matchType !== b.entry.matchType) return a.entry.matchType === 'object' ? -1 : 1;
  return a.entry.sourceOrder - b.entry.sourceOrder;
}

function compareRankedSearchCandidates<T extends SearchRankingCandidate>(
  a: RankedSearchCandidate<T>,
  b: RankedSearchCandidate<T>,
): number {
  if (a.rank.tier !== b.rank.tier) return b.rank.tier - a.rank.tier;
  if (a.rank.fieldScore !== b.rank.fieldScore) return b.rank.fieldScore - a.rank.fieldScore;
  if (a.rank.intentScore !== b.rank.intentScore) return b.rank.intentScore - a.rank.intentScore;
  if (a.rank.textQuality !== b.rank.textQuality) return b.rank.textQuality - a.rank.textQuality;
  if (a.rank.recencyScore !== b.rank.recencyScore) return b.rank.recencyScore - a.rank.recencyScore;
  if (a.rank.totalScore !== b.rank.totalScore) return b.rank.totalScore - a.rank.totalScore;
  if ((a.item.matchType ?? 'object') !== (b.item.matchType ?? 'object')) {
    return (a.item.matchType ?? 'object') === 'object' ? -1 : 1;
  }
  return (a.item.sourceOrder ?? 0) - (b.item.sourceOrder ?? 0);
}

function typeOrderForSearch(type: string): number {
  switch (type) {
    case 'topic-note': return MENTION_TYPE_ORDER['topic-note'];
    case 'daily-note': return MENTION_TYPE_ORDER['daily-note'];
    case 'habit': return MENTION_TYPE_ORDER.habit;
    case 'project': return MENTION_TYPE_ORDER.project;
    case 'ref-material': return MENTION_TYPE_ORDER['ref-material'];
    default: return 99;
  }
}

function candidateToMentionEntry(candidate: SearchRankingCandidate, sourceOrder: number): MentionIndexEntry {
  return createMentionEntry({
    id: candidate.id,
    type: candidate.type,
    title: candidate.title,
    author: candidate.author,
    date: candidate.date,
    syncPath: candidate.syncPath,
    blockId: candidate.blockId,
    matchType: candidate.matchType ?? 'object',
    blockPreview: candidate.blockPreview,
    tags: candidate.tags ?? [],
    sourceOrder: candidate.sourceOrder ?? sourceOrder,
    typeOrder: candidate.typeOrder ?? typeOrderForSearch(candidate.type),
    searchFields: [
      candidate.title,
      candidate.author,
      candidate.date,
      candidate.metadata,
      candidate.snippet,
      candidate.contentSearch,
      candidate.blockPreview,
      (candidate.tags ?? []).join(' '),
    ],
  });
}

export function rankSearchCandidates<T extends SearchRankingCandidate>(
  query: string,
  candidates: T[],
): RankedSearchCandidate<T>[] {
  const knownTags = new Set(
    candidates
      .flatMap((candidate) => candidate.tags ?? [])
      .map((tag) => normalizeForSearch(tag))
      .filter(Boolean),
  );
  const parsedQuery = parseMentionQuery(query, knownTags);
  return candidates
    .map((item, index) => {
      const rank = rankMentionEntry(candidateToMentionEntry(item, index), parsedQuery);
      return { item, rank };
    })
    .filter((candidate) => candidate.rank.tier > 0)
    .sort(compareRankedSearchCandidates);
}

function yieldToEventLoop(): Promise<void> {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function selectTopRankedMentions(
  mentionIndex: MentionIndexEntry[],
  parsedQuery: ReturnType<typeof parseMentionQuery>,
  maxCandidates: number,
  options: SearchObjectsOptions = {},
): Promise<RankedMentionMatch[]> {
  const top: RankedMentionMatch[] = [];
  const chunkSize = 160;
  for (let index = 0; index < mentionIndex.length; index += 1) {
    if (options.signal?.aborted) return top;
    const entry = mentionIndex[index];
    const rank = rankMentionEntry(entry, parsedQuery);
    if (rank.tier <= 0) continue;
    const candidate: RankedMentionMatch = { entry, rank };

    let insertAt = top.length;
    for (let i = 0; i < top.length; i += 1) {
      if (compareRankedMentionMatches(candidate, top[i]) < 0) {
        insertAt = i;
        break;
      }
    }

    if (insertAt === top.length && top.length >= maxCandidates) continue;
    top.splice(insertAt, 0, candidate);
    if (top.length > maxCandidates) top.pop();

    if (index > 0 && index % chunkSize === 0) {
      await yieldToEventLoop();
    }
  }
  return top;
}

function createMentionEntry(
  value: Omit<
    MentionIndexEntry,
    'searchableText' | 'prettyDateSearch' | 'titleSearch' | 'authorSearch' | 'dateSearch' | 'blockPreviewSearch' | 'tagsSearch'
  > & {
    searchFields: Array<string | undefined>;
  },
): MentionIndexEntry {
  const searchableText = value.searchFields
    .map((field) => normalizeForSearch(field))
    .filter(Boolean)
    .join('\n');
  const prettyDateSearch = value.date ? normalizeForSearch(formatDatePretty(value.date)) : undefined;
  return {
    id: value.id,
    type: value.type,
    title: value.title,
    titleSearch: normalizeForSearch(value.title),
    author: value.author,
    authorSearch: normalizeForSearch(value.author),
    date: value.date,
    dateSearch: normalizeForSearch(value.date),
    syncPath: value.syncPath,
    blockId: value.blockId,
    matchType: value.matchType,
    blockPreview: value.blockPreview,
    blockPreviewSearch: normalizeForSearch(value.blockPreview),
    tags: value.tags,
    tagsSearch: value.tags.map((tag) => normalizeForSearch(tag)),
    searchableText,
    prettyDateSearch,
    sourceOrder: value.sourceOrder,
    typeOrder: value.typeOrder,
  };
}

async function ensureMentionIndex(options: { force?: boolean } = {}): Promise<MentionIndexEntry[]> {
  if (options.force) {
    mentionIndexCache = null;
    mentionIndexInFlight = null;
    mentionIndexKnownTagsCache = null;
    mentionSearchCache = new Map<string, MentionSearchResult[]>();
  }
  if (mentionIndexCache) return mentionIndexCache;
  if (mentionIndexInFlight) return mentionIndexInFlight;

  mentionIndexInFlight = (async () => {
    const bundle = await listMetaBundle(options.force ? { force: true } : {});
    const entries: MentionIndexEntry[] = [];
    const topicById = new Map(bundle.topicNotes.map((item) => [item.id, item]));
    const dailyById = new Map(bundle.dailyNotes.map((item) => [item.id, item]));
    let sourceOrder = 0;

    for (const item of bundle.topicNotes) {
      entries.push(createMentionEntry({
        id: item.id,
        type: 'topic-note',
        title: item.displayTitle,
        date: item.date,
        blockId: item.firstBlockId,
        matchType: 'object',
        tags: item.tags,
        sourceOrder: sourceOrder++,
        typeOrder: MENTION_TYPE_ORDER['topic-note'],
        searchFields: [item.displayTitle, item.date, item.preview, item.contentSearch, item.tags.join(' ')],
      }));
    }

    for (const item of bundle.dailyNotes) {
      entries.push(createMentionEntry({
        id: item.id,
        type: 'daily-note',
        title: item.displayTitle,
        date: item.date,
        blockId: item.firstBlockId,
        matchType: 'object',
        tags: item.tags,
        sourceOrder: sourceOrder++,
        typeOrder: MENTION_TYPE_ORDER['daily-note'],
        searchFields: [item.displayTitle, item.date, item.preview, item.contentSearch, item.tags.join(' ')],
      }));
    }

    for (const item of bundle.habits) {
      entries.push(createMentionEntry({
        id: item.id,
        type: 'habit',
        title: item.displayTitle,
        date: item.date,
        syncPath: item.syncPath,
        matchType: 'object',
        tags: item.tags,
        sourceOrder: sourceOrder++,
        typeOrder: MENTION_TYPE_ORDER.habit,
        searchFields: [item.displayTitle, item.date, item.text, item.contentSearch, item.tags.join(' ')],
      }));
    }

    for (const item of bundle.files) {
      entries.push(createMentionEntry({
        id: item.id,
        type: item.type,
        title: item.displayTitle,
        author: item.author,
        date: item.startDate,
        syncPath: item.syncPath,
        matchType: 'object',
        tags: item.tags,
        sourceOrder: sourceOrder++,
        typeOrder: MENTION_TYPE_ORDER[item.type] ?? 99,
        searchFields: [item.displayTitle, item.author, item.startDate, item.tags.join(' ')],
      }));
    }

    for (const block of bundle.noteBlocks) {
      const parent = block.noteType === 'topic-note'
        ? topicById.get(block.noteId)
        : dailyById.get(block.noteId);
      if (!parent || !block.blockId) continue;
      const blockPreview = normalizeForSearch(block.preview) ? block.preview : '(empty block)';
      entries.push(createMentionEntry({
        id: parent.id,
        type: parent.type,
        title: parent.displayTitle,
        date: parent.date,
        blockId: block.blockId,
        matchType: 'block',
        blockPreview,
        tags: parent.tags,
        sourceOrder: sourceOrder++,
        typeOrder: (MENTION_TYPE_ORDER[parent.type] ?? 99) + 0.2,
        searchFields: [parent.displayTitle, parent.date, parent.preview, parent.contentSearch, blockPreview, parent.tags.join(' ')],
      }));
    }

    mentionIndexCache = entries;
    mentionIndexKnownTagsCache = new Set(
      entries
        .flatMap((entry) => entry.tagsSearch)
        .filter(Boolean),
    );
    mentionSearchCache = new Map<string, MentionSearchResult[]>();
    return entries;
  })();

  try {
    return await mentionIndexInFlight;
  } finally {
    mentionIndexInFlight = null;
  }
}

/**
 * Search all objects (daily-note, topic-note, project, ref-material, habit)
 * by title or date. Uses a cached in-memory mention index built from list-meta.
 */
export async function searchObjects(
  query: string,
  limit = 10,
  options: SearchObjectsOptions = {},
): Promise<MentionSearchResult[]> {
  if (options.signal?.aborted) return [];
  const mentionIndex = await ensureMentionIndex();
  if (options.signal?.aborted) return [];
  const normalizedQuery = normalizeForSearch(query);
  const cacheKey = `${limit}:${normalizedQuery}`;
  const cached = mentionSearchCache.get(cacheKey);
  if (cached) return cached.slice(0, limit);

  const knownTags = mentionIndexKnownTagsCache ?? new Set<string>();
  const parsedQuery = parseMentionQuery(query, knownTags);
  const matched = selectTopRankedMentions(
    mentionIndex,
    parsedQuery,
    Math.max(96, limit * 12),
    options,
  );
  const ranked = await matched;
  if (options.signal?.aborted) return [];

  const results: MentionSearchResult[] = [];
  const blockResultCountByNote = new Map<string, number>();
  for (const { entry } of ranked) {
    if (options.signal?.aborted) return [];
    if (results.length >= limit) break;
    if (entry.matchType === 'block') {
      const key = `${entry.type}:${entry.id}`;
      const current = blockResultCountByNote.get(key) ?? 0;
      if (current >= 2) continue;
      blockResultCountByNote.set(key, current + 1);
    }
    results.push({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      author: entry.author,
      date: entry.date,
      syncPath: entry.syncPath,
      blockId: entry.blockId,
      matchType: entry.matchType,
      blockPreview: entry.blockPreview,
    });
  }

  // If the query looks like a date and no existing daily note covers it exactly,
  // add a synthetic "create new daily note" option at the top of results.
  if (parsedQuery.normalized) {
    const parsedDate = parsedQuery.dateIntent;
    if (parsedDate) {
      const alreadyListed = results.some(
        (r) => r.type === 'daily-note' && r.date === parsedDate,
      );
      const existsInIndex = mentionIndex.some((entry) => entry.type === 'daily-note' && entry.date === parsedDate);
      if (!alreadyListed && !existsInIndex) {
        const prettyDate = formatDatePretty(parsedDate);
        results.unshift({
          id: `${DATE_MENTION_HREF_PREFIX}${parsedDate}`,
          type: 'daily-note',
          title: prettyDate || parsedDate,
          date: parsedDate,
          isNew: true,
        });
      }
    }
  }

  const finalResults = results.slice(0, limit);
  if (!options.signal?.aborted) {
    mentionSearchCache.set(cacheKey, finalResults);
  }
  return finalResults;
}

/**
 * Sentinel prefix used in mention link hrefs for pending (not-yet-created) daily notes.
 * When a note is saved, these are replaced with real daily note UUIDs.
 */
export const DATE_MENTION_HREF_PREFIX = 'date:';

export async function listMetaBundle(options: { force?: boolean } = {}): Promise<MetaBundle> {
  if (!options.force && metaBundleCache) {
    return metaBundleCache;
  }
  if (!options.force && metaBundleInFlight) {
    return metaBundleInFlight;
  }

  metaBundleInFlight = (async () => {
    const result = await runPuzzlePKMCli(['list-meta']);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'list-meta failed');

    const raw = JSON.parse(result.stdout) as {
      syncRootFolder?: string;
      topicNotes?: Array<Record<string, unknown>>;
      dailyNotes?: Array<Record<string, unknown>>;
      habits?: Array<Record<string, unknown>>;
      files?: Array<Record<string, unknown>>;
      scriptures?: Array<Record<string, unknown>>;
      scriptureChapters?: Array<Record<string, unknown>>;
      scriptureChapterLinks?: Array<Record<string, unknown>>;
      tags?: Array<Record<string, unknown>>;
      objectLinks?: Array<Record<string, unknown>>;
      noteBlocks?: Array<Record<string, unknown>>;
    };

    const syncRootFolder = typeof raw.syncRootFolder === 'string' ? raw.syncRootFolder : null;

    const topicNotes: TopicNoteMeta[] = (Array.isArray(raw.topicNotes) ? raw.topicNotes : [])
      .map((row) => {
        const title = String(row.title ?? '');
        const date = String(row.date ?? '').trim() || undefined;
        const preview = String(row.preview ?? '');
        const contentSearch = String(row.contentSearch ?? row.content_search ?? '').trim() || undefined;
        const firstBlockId = String(row.firstBlockId ?? row.first_block_id ?? '').trim() || undefined;
        const tags = Array.isArray(row.tags) ? row.tags.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        return {
          id: String(row.id ?? ''),
          title,
          updatedAt: String(row.updatedAt ?? ''),
          date,
          preview,
          contentSearch,
          firstBlockId,
          tags,
          displayTitle: getObjectDisplayTitle('topic-note', { title, date, preview }),
          type: 'topic-note' as const,
        };
      })
      .filter((row) => row.id);

    const dailyNotes: DailyNoteMeta[] = (Array.isArray(raw.dailyNotes) ? raw.dailyNotes : [])
      .map((row) => {
        const date = String(row.date ?? '');
        const preview = String(row.preview ?? '');
        const contentSearch = String(row.contentSearch ?? row.content_search ?? '').trim() || undefined;
        const firstBlockId = String(row.firstBlockId ?? row.first_block_id ?? '').trim() || undefined;
        const tags = Array.isArray(row.tags) ? row.tags.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        return {
          id: String(row.id ?? ''),
          date,
          preview,
          contentSearch,
          firstBlockId,
          tags,
          displayTitle: getObjectDisplayTitle('daily-note', { date }),
          type: 'daily-note' as const,
        };
      })
      .filter((row) => row.id);

    const habits: HabitMeta[] = (Array.isArray(raw.habits) ? raw.habits : [])
      .map((row): HabitMeta => {
        const date = String(row.date ?? '');
        const text = String(row.text ?? '');
        const contentSearch = String(row.contentSearch ?? row.content_search ?? row.text ?? '').trim() || undefined;
        const tags = Array.isArray(row.tags) ? row.tags.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        const status: HabitMeta['status'] = row.status === 'accomplished' ? 'accomplished' : 'planned';
        return {
          id: String(row.id ?? ''),
          date,
          status,
          text,
          contentSearch,
          syncPath: String(row.syncPath ?? ''),
          tags,
          displayTitle: getObjectDisplayTitle('habit', { date, text, tags }),
          type: 'habit' as const,
        };
      })
      .filter((row) => row.id);

    const files: FileMeta[] = (Array.isArray(raw.files) ? raw.files : [])
      .map((row): FileMeta => {
        const type: FileMeta['type'] = row.type === 'ref-material' ? 'ref-material' : 'project';
        const name = String(row.name ?? '');
        const rawSyncPath = String(row.syncPath ?? '');
        return {
          id: String(row.id ?? ''),
          name,
          author: type === 'ref-material' ? String(row.author ?? '') : undefined,
          syncPath: resolveDisplaySyncPath(rawSyncPath, syncRootFolder),
          startDate: type === 'project' ? String(row.startDate ?? '') : undefined,
          tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t ?? '').trim()).filter(Boolean) : [],
          displayTitle: getObjectDisplayTitle(type, { name }),
          type,
        };
      })
      .filter((row) => row.id);

    const scriptures: ScriptureMeta[] = (Array.isArray(raw.scriptures) ? raw.scriptures : [])
      .map((row) => {
        const reference = String(row.reference ?? '');
        return {
          id: String(row.id ?? ''),
          reference,
          passageUrl: String(row.passageUrl ?? ''),
          noteCount: Number.parseInt(String(row.noteCount ?? '0'), 10) || 0,
          displayTitle: getObjectDisplayTitle('scripture', { reference }),
          type: 'scripture' as const,
        };
      })
      .filter((row) => row.id);

    const scriptureChapters: ScriptureChapterMeta[] = (Array.isArray(raw.scriptureChapters) ? raw.scriptureChapters : [])
      .map((row) => {
        const reference = String(row.reference ?? '');
        return {
          id: String(row.id ?? ''),
          reference,
          bookName: String(row.bookName ?? ''),
          bookOrder: Number.parseInt(String(row.bookOrder ?? '0'), 10) || 0,
          chapter: Number.parseInt(String(row.chapter ?? '0'), 10) || 0,
          passageUrl: String(row.passageUrl ?? ''),
          referenceCount: Number.parseInt(String(row.referenceCount ?? '0'), 10) || 0,
          noteCount: Number.parseInt(String(row.noteCount ?? '0'), 10) || 0,
          displayTitle: reference,
          type: 'scripture-chapter' as const,
        };
      })
      .filter((row) => row.id);

    const scriptureChapterLinks: Array<{ scriptureId: string; chapterId: string }> =
      (Array.isArray(raw.scriptureChapterLinks) ? raw.scriptureChapterLinks : [])
        .map((row) => ({
          scriptureId: String(row.scriptureId ?? ''),
          chapterId: String(row.chapterId ?? ''),
        }))
        .filter((row) => row.scriptureId && row.chapterId);

    const tags: TagSummary[] = (Array.isArray(raw.tags) ? raw.tags : [])
      .map((row) => {
        const id = String(row.id ?? '');
        const displayName = String(row.displayName ?? row.name ?? id);
        return {
          id,
          name: String(row.name ?? displayName),
          displayName,
          objectCount: Number.parseInt(String(row.objectCount ?? '0'), 10) || 0,
        };
      })
      .filter((row) => row.id)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

    const objectLinks: Array<{ sourceId: string; targetId: string }> = (Array.isArray(raw.objectLinks) ? raw.objectLinks : [])
      .map((row) => ({
        sourceId: String(row.sourceId ?? ''),
        targetId: String(row.targetId ?? ''),
      }))
      .filter((row) => row.sourceId && row.targetId);

    const noteBlocks: NoteBlockMeta[] = (Array.isArray(raw.noteBlocks) ? raw.noteBlocks : [])
      .map((row) => {
        const noteType: NoteBlockMeta['noteType'] = row.noteType === 'daily-note' ? 'daily-note' : 'topic-note';
        const position = Number.parseInt(String(row.position ?? '0'), 10);
        return {
          noteId: String(row.noteId ?? ''),
          noteType,
          blockId: String(row.blockId ?? ''),
          position: Number.isFinite(position) ? position : 0,
          preview: String(row.preview ?? ''),
        };
      })
      .filter((row) => row.noteId && row.blockId);

    const bundle = {
      topicNotes,
      dailyNotes,
      habits,
      files,
      scriptures,
      scriptureChapters,
      scriptureChapterLinks,
      tags,
      objectLinks,
      noteBlocks,
    };
    metaBundleCache = bundle;
    mentionIndexCache = null;
    return bundle;
  })();

  try {
    return await metaBundleInFlight;
  } finally {
    metaBundleInFlight = null;
  }
}

/**
 * List daily notes for calendar/list views (returns parsed metadata, not full content).
 */
export async function listDailyNoteMeta(): Promise<
  DailyNoteMeta[]
> {
  try {
    const stdout = await listObjects('daily-note');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line.includes('\t'))
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
          displayTitle: getObjectDisplayTitle('daily-note', { date: parts[1] ?? '' }),
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
  TopicNoteMeta[]
> {
  try {
    const stdout = await listObjects('topic-note');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line.includes('\t'))
      .map((line) => {
        const parts = line.split('\t');
        const rawTags = parts[6] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        const title = parts[2] ?? '';
        const date = (parts[4] ?? '').trim() || undefined;
        const preview = parts[5] ?? '';
        return {
          id: parts[0] ?? '',
          updatedAt: parts[1] ?? '',
          title,
          date,
          preview,
          tags,
          displayTitle: getObjectDisplayTitle('topic-note', { title, date, preview }),
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
  HabitMeta[]
> {
  try {
    const stdout = await listObjects('habit');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line.includes('\t'))
      .map((line) => {
        const parts = line.split('\t');
        const rawTags = parts[5] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        const status: 'planned' | 'accomplished' = parts[2] === 'accomplished' ? 'accomplished' : 'planned';
        const date = parts[1] ?? '';
        const text = parts[3] ?? '';
        return {
          id: parts[0] ?? '',
          date,
          status,
          text,
          syncPath: parts[4] ?? '',
          tags,
          displayTitle: getObjectDisplayTitle('habit', { date, text, tags }),
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
  FileMeta[]
> {
  const results: Array<{ id: string; name: string; author?: string; syncPath: string; startDate?: string; tags: string[]; displayTitle: string; type: 'project' | 'ref-material' }> = [];
  let syncRootFolder: string | null;
  try {
    syncRootFolder = await getSyncRootFolder();
  } catch {
    syncRootFolder = null;
  }

  for (const type of ['project', 'ref-material'] as const) {
    try {
      const stdout = await listObjects(type);
      for (const line of stdout.split('\n').map((entry) => entry.trim()).filter((entry) => Boolean(entry) && entry.includes('\t'))) {
        const parts = line.split('\t');
        const rawTags = parts[4] ?? '';
        const tags = rawTags
          ? rawTags.split(',').map((t) => t.trim().replace(/^#/, ''))
          : [];
        if (parts[0]) {
          const rawSyncPath = type === 'ref-material' ? (parts[3] ?? '') : (parts[2] ?? '');
          const name = parts[1] ?? '';
          results.push({
            id: parts[0],
            name,
            author: type === 'ref-material' ? (parts[2] ?? '') : undefined,
            syncPath: resolveDisplaySyncPath(rawSyncPath, syncRootFolder),
            startDate: type === 'project' ? (parts[3] ?? '') : undefined,
            tags,
            displayTitle: getObjectDisplayTitle(type, { name }),
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

function resolveDisplaySyncPath(path: string, rootFolder: string | null): string {
  const raw = String(path ?? '').trim();
  if (!raw || raw === '(no path)') return '';
  if (!rootFolder) return raw;

  const normalizedRaw = raw.replace(/\\/g, '/');
  const normalizedRoot = rootFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedRaw.startsWith(`${normalizedRoot}/`) || normalizedRaw === normalizedRoot) {
    return raw;
  }

  const rawSegments = normalizedRaw.replace(/^\/+/, '').split('/').filter(Boolean);
  const firstSegment = rawSegments[0]?.toLowerCase();
  const secondSegment = rawSegments[1]?.toLowerCase();
  const rootName = normalizedRoot.split('/').filter(Boolean).at(-1)?.toLowerCase();
  const knownObjectFolders = new Set(['topic-notes', 'daily-notes', 'habits', 'projects', 'ref-materials', 'scriptures', 'tags']);
  const filesystemRootSegments = new Set(['users', 'volumes', 'private', 'tmp', 'var', 'etc', 'home']);
  const looksRootRelativeAlias = Boolean(firstSegment) && (
    firstSegment === 'puzzlepkm'
    || (rootName ? firstSegment === rootName : false)
    || knownObjectFolders.has(firstSegment)
    // Some root-relative aliases can look like /SomeRoot/projects/...; detect
    // them by checking a non-filesystem root segment followed by a known object folder.
    || (Boolean(secondSegment) && !filesystemRootSegments.has(firstSegment ?? '') && knownObjectFolders.has(secondSegment ?? ''))
  );

  if (!looksRootRelativeAlias) return raw;

  const suffix = getRootRelativeSuffix(normalizedRaw, normalizedRoot);
  if (!suffix) return raw;
  return joinPath(normalizedRoot, suffix);
}

export async function listScriptureMeta(): Promise<
  ScriptureMeta[]
> {
  try {
    const stdout = await listObjects('scripture');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line.includes('\t'))
      .map((line) => {
        const parts = line.split('\t');
        return {
          id: parts[0] ?? '',
          reference: parts[1] ?? '',
          passageUrl: parts[2] ?? '',
          noteCount: Number.parseInt(parts[3] ?? '0', 10) || 0,
          displayTitle: getObjectDisplayTitle('scripture', { reference: parts[1] ?? '' }),
          type: 'scripture' as const,
        };
      })
      .filter((entry) => entry.id);
  } catch {
    return [];
  }
}

export async function listTags(): Promise<TagSummary[]> {
  try {
    const stdout = await listObjects('tag');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line.includes('\t'))
      .map((line) => {
        const parts = line.split('\t');
        const id = parts[0] ?? '';
        const displayName = parts[1] ?? id;
        const name = displayName || id;
        const countMatch = /^(\d+)/.exec(parts[2] ?? '0');
        return {
          id,
          name,
          displayName,
          objectCount: countMatch ? Number.parseInt(countMatch[1], 10) : 0,
        };
      })
      .filter((entry) => entry.id)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

export interface AuthorSummary {
  name: string;
  usageCount: number;
}

export async function listAuthors(): Promise<AuthorSummary[]> {
  try {
    const result = await runPuzzlePKMCli(['list-authors']);
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return {
          name: parts[0] ?? '',
          usageCount: Number.parseInt(parts[1] ?? '0', 10) || 0,
        };
      })
      .filter((entry) => Boolean(entry.name));
  } catch {
    return [];
  }
}

export async function createAuthor(name: string): Promise<AuthorSummary> {
  const result = await runPuzzlePKMCli(['create-author', name]);
  if (result.exitCode !== 0) {
    throw new Error(stripNodeWarnings(result.stderr) || `Failed to create author: ${name}`);
  }
  return { name, usageCount: 0 };
}

export async function deleteAuthor(name: string): Promise<void> {
  const result = await runPuzzlePKMCli(['delete-author', name]);
  if (result.exitCode !== 0) {
    throw new Error(stripNodeWarnings(result.stderr) || `Failed to delete author: ${name}`);
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
 * Returns list of files and folders (excluding internal/system metadata files).
 * CLI format: kind \t name (where kind is 'dir' or 'file')
 */
export async function browseDirectory(
  path: string,
  options?: { objectType?: 'project' | 'ref-material'; objectName?: string },
): Promise<{ directoryPath: string; entries: Array<{ kind: 'dir' | 'file'; name: string }> }> {
  const candidates = await resolveSyncPathCandidates(path, options);
  let lastError: string | null = null;

  for (const candidate of candidates) {
    const result = await runPuzzlePKMCli(['browse', 'files', candidate]);
    if (result.exitCode !== 0) {
      lastError = result.stderr || 'browse failed';
      continue;
    }

    const lines = result.stdout.split('\n').filter(Boolean);
    const directoryPath = lines[0] ?? candidate;
    const entries = lines
      .slice(1)
      .map((line) => {
        const parts = line.split('\t');
        return {
          kind: (parts[0] === 'dir' ? 'dir' : 'file') as 'dir' | 'file',
          name: parts[1] ?? '',
        };
      })
      .filter((entry) => {
        const normalizedName = entry.name.trim().toLowerCase();
        return Boolean(normalizedName) && normalizedName !== 'meta.yaml' && normalizedName !== '.ds_store';
      });

    return { directoryPath, entries };
  }

  throw new Error(lastError || 'browse failed');
}

export async function openPathInDefaultApp(path: string): Promise<void> {
  const trimmed = String(path ?? '').trim();
  if (!trimmed) throw new Error('Path is required');

  try {
    await invoke<void>('open_url', { url: trimmed });
  } catch {
    if (typeof window !== 'undefined') {
      const href = trimmed.startsWith('file://') ? trimmed : `file://${trimmed}`;
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }
}

function joinPath(base: string, ...parts: string[]): string {
  const cleanedBase = base.replace(/\/$/, '');
  const suffix = parts
    .map((part) => part.replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/');
  return suffix ? `${cleanedBase}/${suffix}` : cleanedBase;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const path of paths) {
    const normalized = path.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function getRootRelativeSuffix(path: string, rootFolder: string): string {
  const rawSegments = path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (rawSegments.length === 0) return '';

  const knownObjectFolders = new Set([
    'topic-notes',
    'daily-notes',
    'habits',
    'projects',
    'ref-materials',
    'scriptures',
    'tags',
  ]);

  const rootName = rootFolder.split(/[/\\]/).filter(Boolean).at(-1)?.toLowerCase();
  const firstSegment = rawSegments[0]?.toLowerCase();

  if (firstSegment === 'puzzlepkm' || (rootName && firstSegment === rootName)) {
    return rawSegments.slice(1).join('/');
  }

  const folderAnchorIndex = rawSegments.findIndex((segment) => knownObjectFolders.has(segment.toLowerCase()));
  if (folderAnchorIndex >= 0) {
    return rawSegments.slice(folderAnchorIndex).join('/');
  }

  return rawSegments.join('/');
}

async function getSyncRootFolder(): Promise<string | null> {
  const settings = await runPuzzlePKMCli(['settings', 'show']);
  if (settings.exitCode !== 0) return null;

  const parsed = JSON.parse(settings.stdout) as {
    sync?: { resolvedRootFolder?: string; effectiveRootFolder?: string; rootFolder?: string };
  };

  return parsed.sync?.resolvedRootFolder ?? parsed.sync?.effectiveRootFolder ?? parsed.sync?.rootFolder ?? null;
}

async function resolveSyncPathCandidates(
  path: string,
  options?: { objectType?: 'project' | 'ref-material'; objectName?: string },
): Promise<string[]> {
  const raw = String(path ?? '').trim();
  if (!raw) throw new Error('Browse path is required');

  const candidates: string[] = [];
  const isAbsoluteLike = /^(\/|[A-Za-z]:[\\/])/.test(raw);

  // Always try to get the sync root so we can build absolute candidates.
  const root = await getSyncRootFolder().catch(() => null);

  if (isAbsoluteLike) {
    // Try the raw absolute path first.
    candidates.push(raw);
    if (root) {
      // Also try resolving the root-relative suffix under the actual root folder
      // in case the path was stored from a different machine or Dropbox location.
      const suffix = getRootRelativeSuffix(raw, root);
      if (suffix) candidates.push(joinPath(root, suffix));
    }
  } else {
    // Relative path (e.g. "PuzzlePKM/projects/my-project") — resolve under root.
    if (root) {
      candidates.push(joinPath(root, raw));
      // Also strip any known root-name prefix so "PuzzlePKM/projects/x" works
      // when the root folder itself is "/Users/x/Dropbox/PuzzlePKM".
      const suffix = getRootRelativeSuffix(raw, root);
      if (suffix && suffix !== raw) candidates.push(joinPath(root, suffix));
    }
    // Keep raw as last-resort fallback (CLI will resolve from its CWD).
    candidates.push(raw);
  }

  // Repair fallback for stale file-object paths: derive the canonical slug-backed
  // sync directory from the current object name and configured sync root.
  const objectName = String(options?.objectName ?? '').trim();
  const objectType = options?.objectType;
  if (root && objectName && (objectType === 'project' || objectType === 'ref-material')) {
    const slug = slugifyForPath(objectName);
    const folder = objectType === 'project' ? 'projects' : 'ref-materials';
    candidates.push(joinPath(root, folder, slug));
  }

  return uniquePaths(candidates);
}

function slugifyForPath(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}
