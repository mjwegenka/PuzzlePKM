#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import process, { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { handleNotesCommand } from './commands/notes.mjs';
import { handleObjectsCommand } from './commands/objects.mjs';
import { handleSettingsCommand } from './commands/settings.mjs';
import { handleSyncCommand } from './commands/sync.mjs';
import { createDailyNoteRepository } from './objects/daily-note/repository.mjs';
import { createDailyNoteService } from './objects/daily-note/service.mjs';
import { createHabitRepository } from './objects/habit/repository.mjs';
import { createHabitService } from './objects/habit/service.mjs';
import { createObjectTypeAliasMap } from './objects/index.mjs';
import { createLinkRepository } from './objects/link/repository.mjs';
import { createLinkService } from './objects/link/service.mjs';
import { createProjectRepository } from './objects/project/repository.mjs';
import { createProjectService } from './objects/project/service.mjs';
import { createRefMaterialRepository } from './objects/ref-material/repository.mjs';
import { createRefMaterialService } from './objects/ref-material/service.mjs';
import { createScriptureRepository } from './objects/scripture/repository.mjs';
import { createScriptureService } from './objects/scripture/service.mjs';
import { createTagRepository } from './objects/tag/repository.mjs';
import { createTagService } from './objects/tag/service.mjs';
import { createTopicNoteRepository } from './objects/topic-note/repository.mjs';
import { createTopicNoteService } from './objects/topic-note/service.mjs';

const KEYCHAIN_ACCESS_TOKEN = 'sync_access_token';
const KEYCHAIN_REFRESH_TOKEN = 'sync_refresh_token';
const KEYCHAIN_ACCOUNT_EMAIL = 'sync_account_email';
const KEYCHAIN_ROOT_FOLDER = 'sync_root_folder';
const MILLISECONDS_PER_MINUTE = 60_000;
const MAX_NOTE_TITLE_LENGTH = 120;
const MAX_HABIT_TEXT_LENGTH = 255;
const PRIMARY_PRODUCT_NAME = 'PuzzlePKM';
const PRIMARY_CLI_COMMAND = 'puzzlepkm';
const PRIMARY_DB_ENV_VAR = 'PUZZLEPKM_DB_PATH';
const PRIMARY_SECRETS_ENV_VAR = 'PUZZLEPKM_SECRETS_PATH';
const HABIT_STATUS_PLANNED = 'planned';
const HABIT_STATUS_ACCOMPLISHED = 'accomplished';
const HABIT_STATUSES = new Set([HABIT_STATUS_PLANNED, HABIT_STATUS_ACCOMPLISHED]);
const SHELL_HISTORY_SIZE = 200;
const DEFAULT_NOTES_ROOT = '/PuzzlePKM';
const DAILY_NOTES_SUBFOLDER = 'daily-notes';
const TOPIC_NOTES_SUBFOLDER = 'topic-notes';
const PROJECTS_SUBFOLDER = 'projects';
const REF_MATERIALS_SUBFOLDER = 'ref-materials';
const HABITS_SUBFOLDER = 'habits';
const MOBILE_INBOX_SUBFOLDER = 'mobile-inbox';
const MOBILE_INBOX_DAILY_NOTES_SUBFOLDER = `${MOBILE_INBOX_SUBFOLDER}/daily-notes`;
const MOBILE_INBOX_HABITS_SUBFOLDER = `${MOBILE_INBOX_SUBFOLDER}/habits`;
const SYNC_INTERVAL_MINUTES_DEFAULT = 15;
const BLOCK_ID_PATTERN = /^blk-[a-f0-9]{12}$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INBOX_TAG_NAME = 'Inbox';
const PINNED_TAG_NAME = 'pinned';
const SCRIPTURE_TYPE = 'scripture';
const ROOT_RELATIVE_APP_PATTERN = /^puzzlepkm\//i;
const DEFAULT_LOCAL_STORAGE_DIR = platform() === 'darwin'
  ? join(homedir(), 'Library', 'CloudStorage', 'Sync')
  : join(homedir(), 'Sync');

function resolveLocalSyncPath(syncPath) {
  const raw = normalize(syncPath) || DEFAULT_NOTES_ROOT;
  const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  const normalized = expanded === '/' ? '/' : (expanded.replace(/\\/g, '/').replace(/\/+$/, '') || DEFAULT_NOTES_ROOT);

  if (normalized === DEFAULT_NOTES_ROOT || normalized.startsWith(`${DEFAULT_NOTES_ROOT}/`)) {
    return join(DEFAULT_LOCAL_STORAGE_DIR, normalized.replace(/^\//, ''));
  }
  if (normalized.startsWith('/')) return normalized;
  return resolve(normalized);
}

function normalizeSyncRootFolderInput(rootFolder) {
  const normalized = normalize(rootFolder).replace(/\\/g, '/');
  if (!normalized) return '';
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/, '');
}

function validateSyncRootFolderInput(rootFolder) {
  const normalized = normalizeSyncRootFolderInput(rootFolder);
  if (!normalized) {
    throw new Error('Root folder path is required (for example: /PuzzlePKM).');
  }
  const hasControlChars = Array.from(normalized).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31;
  });
  if (hasControlChars) {
    throw new Error('Root folder path cannot contain control characters.');
  }
  if (normalized === '/') {
    throw new Error('Root folder cannot be "/". Choose a dedicated folder (for example: /PuzzlePKM).');
  }
  const isAbsoluteUnix = normalized.startsWith('/');
  const isHomeRelative = normalized === '~' || normalized.startsWith('~/');
  const isAbsoluteWindows = /^[a-zA-Z]:\//.test(normalized);
  if (!isAbsoluteUnix && !isHomeRelative && !isAbsoluteWindows) {
    throw new Error('Root folder must be absolute. Use /PuzzlePKM, ~/path, or an absolute drive path.');
  }
  return normalized;
}

const schema = `
  CREATE TABLE IF NOT EXISTS topic_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '{}',
    content_markdown TEXT NOT NULL DEFAULT '',
    linked_object_ids TEXT NOT NULL DEFAULT '[]',
    sync_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_notes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '{}',
    content_markdown TEXT NOT NULL DEFAULT '',
    linked_object_ids TEXT NOT NULL DEFAULT '[]',
    sync_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sync_path TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ref_materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    author TEXT,
    sync_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'accomplished')),
    sync_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS object_tags (
    object_id TEXT NOT NULL,
    object_type TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (object_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS object_links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    object_id TEXT NOT NULL,
    object_type TEXT NOT NULL,
    has_remote_copy INTEGER NOT NULL DEFAULT 0,
    last_seen_remote_at TEXT,
    PRIMARY KEY (object_id, object_type)
  );

  CREATE TABLE IF NOT EXISTS note_blocks (
    note_id TEXT NOT NULL,
    block_id TEXT NOT NULL,
    note_type TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    content_markdown TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (note_id, block_id)
  );

  CREATE TABLE IF NOT EXISTS scriptures (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    book_name TEXT NOT NULL,
    book_order INTEGER NOT NULL,
    passage_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS authors (
    name TEXT PRIMARY KEY
  );

  CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(date);
  CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
  CREATE INDEX IF NOT EXISTS idx_object_tags_object ON object_tags(object_id);
  CREATE INDEX IF NOT EXISTS idx_object_tags_tag ON object_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_source ON object_links(source_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_target ON object_links(target_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_source_type_id ON object_links(source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_target_type_id ON object_links(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_sync_state_object_type ON sync_state(object_type, object_id);
  CREATE INDEX IF NOT EXISTS idx_habits_date ON habits(date);
  CREATE INDEX IF NOT EXISTS idx_habits_updated_at ON habits(updated_at);
  CREATE INDEX IF NOT EXISTS idx_topic_notes_title ON topic_notes(title);
  CREATE INDEX IF NOT EXISTS idx_topic_notes_updated_at ON topic_notes(updated_at);
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
  CREATE INDEX IF NOT EXISTS idx_ref_materials_updated_at ON ref_materials(updated_at);
  CREATE INDEX IF NOT EXISTS idx_note_blocks_note_id ON note_blocks(note_id);
  CREATE INDEX IF NOT EXISTS idx_note_blocks_position ON note_blocks(note_id, position);
  CREATE INDEX IF NOT EXISTS idx_scriptures_book_order ON scriptures(book_order, reference);
 `;

 // DEC-20: Ensure schema is migrated for new sync_path columns (DEC-21)
 function ensureSchemaMigrations(db) {
    const ensureSyncPathColumn = (tableName) => {
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const hasSyncPath = columns.some((c) => c.name === 'sync_path');
      const hasLegacyPath = columns.some((c) => c.name === 'dropbox_path');
      if (hasSyncPath) return;
      if (hasLegacyPath) {
        try {
          db.prepare(`ALTER TABLE ${tableName} RENAME COLUMN dropbox_path TO sync_path`).run();
          return;
        } catch {
          // Fall back when column rename is not available.
        }
      }
      db.prepare(`ALTER TABLE ${tableName} ADD COLUMN sync_path TEXT NOT NULL DEFAULT ''`).run();
      if (hasLegacyPath) {
        db.prepare(`UPDATE ${tableName} SET sync_path = TRIM(COALESCE(dropbox_path, '')) WHERE TRIM(COALESCE(sync_path, '')) = ''`).run();
      }
    };

   try {
      // Ensure topic_notes has required legacy columns and sync_path.
     const topicColumnsCheck = db.prepare("PRAGMA table_info(topic_notes)").all();
     if (!topicColumnsCheck.some(c => c.name === 'date')) {
       db.prepare("ALTER TABLE topic_notes ADD COLUMN date TEXT NOT NULL DEFAULT ''").run();
     }
      ensureSyncPathColumn('topic_notes');
   } catch (e) {
     // Column may already exist or table doesn't exist yet
   }

   try {
      ensureSyncPathColumn('daily_notes');
   } catch (e) {
     // Column may already exist or table doesn't exist yet
   }

    try {
      // Ensure habits has sync_path and required status migration.
      ensureSyncPathColumn('habits');
      const habitsColumnsCheck = db.prepare("PRAGMA table_info(habits)").all();
      if (!habitsColumnsCheck.some(c => c.name === 'status')) {
        db.prepare(`ALTER TABLE habits ADD COLUMN status TEXT NOT NULL DEFAULT '${HABIT_STATUS_ACCOMPLISHED}'`).run();
      }
      db.prepare(`
        UPDATE habits
        SET status = CASE
          WHEN lower(trim(COALESCE(status, ''))) IN ('planned', 'accomplished')
            THEN lower(trim(status))
          ELSE '${HABIT_STATUS_PLANNED}'
        END
      `).run();
    } catch (e) {
      // Column may already exist or table doesn't exist yet
    }

    try {
        ensureSyncPathColumn('projects');
      } catch (e) {
        // Column may already exist or table doesn't exist yet
      }

      try {
        ensureSyncPathColumn('ref_materials');
      const refMaterialColumnsCheck = db.prepare("PRAGMA table_info(ref_materials)").all();
      if (!refMaterialColumnsCheck.some(c => c.name === 'author')) {
        db.prepare('ALTER TABLE ref_materials ADD COLUMN author TEXT').run();
      }
    } catch (e) {
      // Column may already exist or table doesn't exist yet
    }

    try {
      // Ensure authors catalog table (DEC-29)
      db.prepare('CREATE TABLE IF NOT EXISTS authors (name TEXT PRIMARY KEY)').run();
      // Backfill from existing ref_materials authors
      db.prepare(`
        INSERT OR IGNORE INTO authors (name)
        SELECT DISTINCT trim(author) FROM ref_materials WHERE trim(COALESCE(author, '')) != ''
      `).run();
    } catch (e) {
      // Table may already exist
    }
  }

function defaultAppDataDir() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'puzzlepkm');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'puzzlepkm');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'puzzlepkm');
}

const appDataDir = defaultAppDataDir();

function secretsFilePath() {
  return process.env[PRIMARY_SECRETS_ENV_VAR] ?? join(appDataDir, 'secrets.json');
}

const dbFile = process.env[PRIMARY_DB_ENV_VAR] ?? join(appDataDir, 'puzzlepkm.sqlite');

function getIsoNow() {
  return new Date().toISOString();
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * MILLISECONDS_PER_MINUTE;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function normalize(value) {
  return value?.trim() ?? '';
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function titleFromText(text) {
  const title = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return title?.slice(0, MAX_NOTE_TITLE_LENGTH) ?? 'Untitled note';
}

function parseCsv(value) {
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function normalizeHabitStatus(value, fallback = HABIT_STATUS_PLANNED) {
  const normalized = normalize(String(value ?? '')).toLowerCase();
  return HABIT_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeHabitTagNames(tags) {
  if (!Array.isArray(tags)) return [];
  const [first] = tags
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return first ? [first] : [];
}

// Appends the Inbox tag to a tag list if not already present (for multi-tag object types).
function addInboxTag(tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [];
  const hasInbox = names.some((t) => t.toLowerCase() === INBOX_TAG_NAME.toLowerCase());
  return hasInbox ? names : [...names, INBOX_TAG_NAME];
}

// Prepends the Inbox tag for habits (single-tag constraint: DEC-45).
// Inbox becomes the primary tag; the original remote tag is preserved in the sync file.
function addInboxTagForHabit(tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [];
  const hasInbox = names.some((t) => t.toLowerCase() === INBOX_TAG_NAME.toLowerCase());
  return hasInbox ? names : [INBOX_TAG_NAME, ...names];
}

function mergeRemoteTagsPreservingImportedInbox(existingTagNames, remoteTagNames) {
  const remoteNames = Array.isArray(remoteTagNames) ? remoteTagNames : [];
  const existingHasInbox = (Array.isArray(existingTagNames) ? existingTagNames : [])
    .some((tag) => String(tag ?? '').trim().toLowerCase() === INBOX_TAG_NAME.toLowerCase());
  const remoteHasInbox = remoteNames
    .some((tag) => String(tag ?? '').trim().toLowerCase() === INBOX_TAG_NAME.toLowerCase());
  if (!existingHasInbox || remoteHasInbox) return remoteNames;
  return [...remoteNames, INBOX_TAG_NAME];
}

function normalizeTagNameForComparison(value) {
  return String(value ?? '').trim().replace(/^#/, '').toLowerCase();
}

function assertPinnedTagAllowedForObjectType(objectType, tagNames) {
  if (objectType !== 'habit' && objectType !== 'tag') return;
  const hasPinnedTag = (Array.isArray(tagNames) ? tagNames : [])
    .some((tag) => normalizeTagNameForComparison(tag) === PINNED_TAG_NAME);
  if (!hasPinnedTag) return;
  throw new Error(`${objectType} objects cannot use the reserved "Pinned" tag.`);
}

function decodeUriComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSyncPath(value) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const withoutQuery = raw.replace(/[?#].*$/, '');
  if (!withoutQuery) return '';
  const collapsed = withoutQuery.replace(/\/+/g, '/');
  return collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
}

function normalizeSyncPathForLookup(value) {
  return normalizeSyncPath(value).toLowerCase();
}

function splitPathSegments(path) {
  return String(path ?? '').split('/').filter(Boolean);
}

function dirnamePath(path) {
  const parts = splitPathSegments(path);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

function resolveRelativeSyncPath(baseFilePath, hrefPath) {
  const normalizedHref = String(hrefPath ?? '').replace(/\\/g, '/').trim();
  if (!normalizedHref) return '';
  if (normalizedHref.startsWith('/')) return normalizeSyncPath(normalizedHref);

  const baseDirParts = splitPathSegments(dirnamePath(baseFilePath));
  const hrefParts = splitPathSegments(normalizedHref);
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

function hasTraversalPathSegments(path) {
  const segments = splitPathSegments(path);
  return segments.some((segment) => segment === '.' || segment === '..');
}

function isPathWithinSyncRoot(path, rootFolder) {
  const normalizedPath = normalizeSyncPath(path);
  const normalizedRoot = normalizeSyncPath(rootFolder);
  if (!normalizedPath || !normalizedRoot) return false;
  const pathSegments = splitPathSegments(normalizedPath).map((segment) => segment.toLowerCase());
  const rootSegments = splitPathSegments(normalizedRoot).map((segment) => segment.toLowerCase());
  if (pathSegments.length < rootSegments.length) return false;
  for (let idx = 0; idx < rootSegments.length; idx += 1) {
    if (pathSegments[idx] !== rootSegments[idx]) return false;
  }
  return true;
}

function relativeSyncPathBetween(sourceSyncPath, targetSyncPath) {
  const sourceDirSegments = splitPathSegments(dirnamePath(sourceSyncPath));
  const targetSegments = splitPathSegments(targetSyncPath);
  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < sourceDirSegments.length
    && sharedPrefixLength < targetSegments.length
    && sourceDirSegments[sharedPrefixLength].toLowerCase() === targetSegments[sharedPrefixLength].toLowerCase()
  ) {
    sharedPrefixLength += 1;
  }
  const upLevels = sourceDirSegments.length - sharedPrefixLength;
  const suffixSegments = targetSegments.slice(sharedPrefixLength);
  const relativeSegments = [...Array.from({ length: upLevels }, () => '..'), ...suffixSegments];
  return relativeSegments.length > 0 ? relativeSegments.join('/') : './';
}

function normalizeRelativePathSegments(path) {
  return String(path ?? '')
    .replace(/^[./]+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

const SCRIPTURE_BOOK_ORDER = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther',
  'Job', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel',
  'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai',
  'Zechariah', 'Malachi', 'Tobit', 'Judith', 'Wisdom', 'Sirach', '1 Maccabees', '2 Maccabees', 'Matthew', 'Mark',
  'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians',
  'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
  'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];
const SCRIPTURE_BOOK_ORDER_INDEX = new Map(SCRIPTURE_BOOK_ORDER.map((book, index) => [book, index]));
const SCRIPTURE_VOLUME_BOOKS = new Set(['Samuel', 'Kings', 'Chronicles', 'Maccabees', 'Corinthians', 'Thessalonians', 'Timothy', 'Peter', 'John']);

// Canonical max chapter counts for every book in the RSVCE Catholic canon.
// Books that require a volume prefix (Samuel, Kings, …) are listed under both
// their numbered names (the canonical forms) and their bare names (the combined
// maximum across all volumes) so that a loose reference like "Thessalonians 5"
// is still accepted while "Thessalonians 500" is rejected.
// DEC-48 / chapter-validator
const SCRIPTURE_BOOK_MAX_CHAPTERS = new Map([
  // Pentateuch
  ['Genesis', 50], ['Exodus', 40], ['Leviticus', 27], ['Numbers', 36], ['Deuteronomy', 34],
  // Historical books
  ['Joshua', 24], ['Judges', 21], ['Ruth', 4],
  ['1 Samuel', 31], ['2 Samuel', 24], ['Samuel', 31],   // bare max = 1 Samuel
  ['1 Kings', 22], ['2 Kings', 25], ['Kings', 25],
  ['1 Chronicles', 29], ['2 Chronicles', 36], ['Chronicles', 36],
  ['Ezra', 10], ['Nehemiah', 13], ['Esther', 16],
  // Wisdom / Poetry
  ['Job', 42], ['Psalm', 150], ['Proverbs', 31], ['Ecclesiastes', 12], ['Song of Solomon', 8],
  // Major prophets
  ['Isaiah', 66], ['Jeremiah', 52], ['Lamentations', 5], ['Ezekiel', 48], ['Daniel', 14],
  // Minor prophets
  ['Hosea', 14], ['Joel', 3], ['Amos', 9], ['Obadiah', 1], ['Jonah', 4], ['Micah', 7],
  ['Nahum', 3], ['Habakkuk', 3], ['Zephaniah', 3], ['Haggai', 2], ['Zechariah', 14], ['Malachi', 4],
  // Deuterocanonical
  ['Tobit', 14], ['Judith', 16], ['Wisdom', 19], ['Sirach', 51],
  ['1 Maccabees', 16], ['2 Maccabees', 15], ['Maccabees', 16],
  // Gospels & Acts
  ['Matthew', 28], ['Mark', 16], ['Luke', 24],
  ['John', 21],  // Gospel of John; 1/2/3 John handled separately below
  ['Acts', 28],
  // Pauline letters
  ['Romans', 16],
  ['1 Corinthians', 16], ['2 Corinthians', 13], ['Corinthians', 16],
  ['Galatians', 6], ['Ephesians', 6], ['Philippians', 4], ['Colossians', 4],
  ['1 Thessalonians', 5], ['2 Thessalonians', 3], ['Thessalonians', 5],
  ['1 Timothy', 6], ['2 Timothy', 4], ['Timothy', 6],
  ['Titus', 3], ['Philemon', 1], ['Hebrews', 13],
  // General epistles
  ['James', 5],
  ['1 Peter', 5], ['2 Peter', 3], ['Peter', 5],
  ['1 John', 5], ['2 John', 1], ['3 John', 1],
  ['Jude', 1], ['Revelation', 22],
]);
const SCRIPTURE_LINK_HOST_PATTERN = /^https?:\/\/(?:www\.)?biblegateway\.com\/passage\/\?search=/i;
const SCRIPTURE_VOLUME_NORMALIZATION = new Map([
  ['1', '1'], ['i', '1'], ['1st', '1'], ['first', '1'],
  ['2', '2'], ['ii', '2'], ['2nd', '2'], ['second', '2'],
  ['3', '3'], ['iii', '3'], ['3rd', '3'], ['third', '3'],
]);
const SCRIPTURE_BOOK_ALIASES = new Map([
  ['gen', 'Genesis'], ['genesis', 'Genesis'],
  ['ex', 'Exodus'], ['exo', 'Exodus'], ['exodus', 'Exodus'],
  ['lev', 'Leviticus'], ['leviticus', 'Leviticus'],
  ['num', 'Numbers'], ['nmb', 'Numbers'], ['numbers', 'Numbers'],
  ['deut', 'Deuteronomy'], ['dt', 'Deuteronomy'], ['deuteronomy', 'Deuteronomy'],
  ['josh', 'Joshua'], ['joshua', 'Joshua'],
  ['judg', 'Judges'], ['jdg', 'Judges'], ['judges', 'Judges'],
  ['rut', 'Ruth'], ['ruth', 'Ruth'],
  ['sam', 'Samuel'], ['samuel', 'Samuel'],
  ['ki', 'Kings'], ['kin', 'Kings'], ['kn', 'Kings'], ['kgs', 'Kings'], ['kings', 'Kings'],
  ['chr', 'Chronicles'], ['chron', 'Chronicles'], ['chronicles', 'Chronicles'],
  ['ezr', 'Ezra'], ['ezra', 'Ezra'],
  ['neh', 'Nehemiah'], ['nehemiah', 'Nehemiah'],
  ['est', 'Esther'], ['esther', 'Esther'],
  ['jb', 'Job'], ['job', 'Job'],
  ['psa', 'Psalm'], ['ps', 'Psalm'], ['psalm', 'Psalm'], ['psalms', 'Psalm'],
  ['pr', 'Proverbs'], ['prov', 'Proverbs'], ['proverbs', 'Proverbs'],
  ['eccl', 'Ecclesiastes'], ['ecclesiastes', 'Ecclesiastes'],
  ['song', 'Song of Solomon'], ['songs of solomon', 'Song of Solomon'], ['song of songs', 'Song of Solomon'], ['song of solomon', 'Song of Solomon'],
  ['isa', 'Isaiah'], ['is', 'Isaiah'], ['isaiah', 'Isaiah'],
  ['jer', 'Jeremiah'], ['jeremiah', 'Jeremiah'],
  ['lam', 'Lamentations'], ['lamentations', 'Lamentations'],
  ['eze', 'Ezekiel'], ['ezekiel', 'Ezekiel'],
  ['dan', 'Daniel'], ['daniel', 'Daniel'],
  ['hos', 'Hosea'], ['hosea', 'Hosea'],
  ['joe', 'Joel'], ['joel', 'Joel'],
  ['amo', 'Amos'], ['amos', 'Amos'],
  ['oba', 'Obadiah'], ['obadiah', 'Obadiah'],
  ['jon', 'Jonah'], ['jonah', 'Jonah'],
  ['mic', 'Micah'], ['micah', 'Micah'],
  ['nah', 'Nahum'], ['nahum', 'Nahum'],
  ['hab', 'Habakkuk'], ['habakkuk', 'Habakkuk'],
  ['zeph', 'Zephaniah'], ['zephaniah', 'Zephaniah'],
  ['hag', 'Haggai'], ['haggai', 'Haggai'],
  ['zech', 'Zechariah'], ['zechariah', 'Zechariah'],
  ['mal', 'Malachi'], ['malachi', 'Malachi'],
  ['tob', 'Tobit'], ['tobit', 'Tobit'],
  ['jud', 'Judith'], ['judith', 'Judith'],
  ['wis', 'Wisdom'], ['wisdom', 'Wisdom'],
  ['sir', 'Sirach'], ['sirach', 'Sirach'],
  ['mac', 'Maccabees'], ['macc', 'Maccabees'], ['maccabees', 'Maccabees'],
  ['mt', 'Matthew'], ['matt', 'Matthew'], ['matthew', 'Matthew'],
  ['mk', 'Mark'], ['mrk', 'Mark'], ['mark', 'Mark'],
  ['lk', 'Luke'], ['lu', 'Luke'], ['luke', 'Luke'],
  ['jn', 'John'], ['jh', 'John'], ['jo', 'John'], ['john', 'John'],
  ['act', 'Acts'], ['acts', 'Acts'], ['acts of the apostles', 'Acts'],
  ['rom', 'Romans'], ['romans', 'Romans'],
  ['cor', 'Corinthians'], ['corinthians', 'Corinthians'],
  ['gal', 'Galatians'], ['galatians', 'Galatians'],
  ['eph', 'Ephesians'], ['ephesians', 'Ephesians'],
  ['phi', 'Philippians'], ['phil', 'Philippians'], ['philippians', 'Philippians'],
  ['col', 'Colossians'], ['colossians', 'Colossians'],
  ['the', 'Thessalonians'], ['thes', 'Thessalonians'], ['thess', 'Thessalonians'], ['thessalonians', 'Thessalonians'],
  ['ti', 'Timothy'], ['tim', 'Timothy'], ['timothy', 'Timothy'],
  ['tit', 'Titus'], ['titus', 'Titus'],
  ['phile', 'Philemon'], ['philemon', 'Philemon'],
  ['heb', 'Hebrews'], ['hebrews', 'Hebrews'],
  ['jam', 'James'], ['jas', 'James'], ['james', 'James'],
  ['pet', 'Peter'], ['pe', 'Peter'], ['pt', 'Peter'], ['peter', 'Peter'],
  ['ju', 'Jude'], ['jude', 'Jude'],
  ['rev', 'Revelation'], ['revelation', 'Revelation'], ['revelations', 'Revelation'],
]);
const SCRIPTURE_BOOK_MATCH_PATTERN = '(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs?|Ecclesiastes|Songs? of Solomon|Song of Songs|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Wisdom|Maccabees|Sirach|Judith|Tobit|Matthew|Mark|Luke|John|Acts?|Acts of the Apostles|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation(?:s?)?|Gen|Ex|Exo|Lev|Num|Nmb|Deut?|Dt|Josh?|Judg?|Jdg|Rut|Sam|Ki|Kin|Kn|Kgs|Chr(?:on?)?|Ezr|Neh|Est|Jb|Psa?|Pr(?:ov?)?|Eccl?|Song?|Isa|Is|Jer|Lam|Eze|Da?n|Hos|Joe|Amo?|Oba|Jon|Mic|Nah|Hab|Zeph?|Hag|Zech?|Mal|Wis|Sir|Mac|Macc|Jud|Tob|M(?:at)?t|Mr?k|Lu?k|Jh?n|Jo|Act|Rom|Cor|Gal|Eph|Col|Phi(?:l?)?|The?|Thess?|Ti?m|Tit|Phile|Heb|Ja?m|Pe?t|Pt|Ju|Rev)\\.?';
const SCRIPTURE_PASSAGE_REGEX = new RegExp(`\\b(?:(${['1', '2', '3', 'I', 'II', 'III', '1st', '2nd', '3rd', 'First', 'Second', 'Third'].join('|')})\\s*)?(${SCRIPTURE_BOOK_MATCH_PATTERN})\\s+([0-9]{1,3}(?:[:.][0-9]{1,3})?(?:\\s*[-&,;]\\s*[0-9]{1,3}(?:[:.][0-9]{1,3})?)*)`, 'gi');
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

function normalizeScriptureVolume(volumeRaw) {
  const normalized = normalize(volumeRaw).toLowerCase().replace(/\./g, '');
  if (!normalized) return '';
  return SCRIPTURE_VOLUME_NORMALIZATION.get(normalized) ?? '';
}

function normalizeScriptureBook(bookRaw) {
  const normalized = normalize(bookRaw).replace(/\.$/, '').toLowerCase();
  if (!normalized) return null;
  return SCRIPTURE_BOOK_ALIASES.get(normalized) ?? null;
}

function normalizeScriptureVersePart(verseRaw) {
  return normalize(verseRaw).replace(/\s+/g, '').replace(/\./g, ':');
}

function buildCanonicalScriptureBook(volumeRaw, bookRaw) {
  const volume = normalizeScriptureVolume(volumeRaw);
  const book = normalizeScriptureBook(bookRaw);
  if (!book) return null;
  if (!volume) return book;
  if (!SCRIPTURE_VOLUME_BOOKS.has(book)) return book;
  return `${volume} ${book}`;
}

function buildScripturePassageUrl(reference) {
  const search = encodeURIComponent(reference.replace(':', '.'));
  return `https://www.biblegateway.com/passage/?search=${search}&version=RSVCE&interface=print`;
}

function parseScriptureMatch(volumeRaw, bookRaw, verseRaw) {
  const canonicalBook = buildCanonicalScriptureBook(volumeRaw, bookRaw);
  if (!canonicalBook) return null;
  const verse = normalizeScriptureVersePart(verseRaw);
  if (!verse) return null;

  // DEC-48 chapter validation: reject references whose chapter number exceeds
  // the real maximum for that book (e.g. "Thessalonians 500" → chapter 500 > 5).
  const chapterMatch = /^(\d+)/.exec(verse);
  if (chapterMatch) {
    const chapter = parseInt(chapterMatch[1], 10);
    const maxChapter = SCRIPTURE_BOOK_MAX_CHAPTERS.get(canonicalBook);
    if (maxChapter !== undefined && chapter > maxChapter) return null;
  }

  const reference = `${canonicalBook} ${verse}`;
  const bookOrder = SCRIPTURE_BOOK_ORDER_INDEX.get(canonicalBook) ?? Number.MAX_SAFE_INTEGER;
  return {
    reference,
    bookName: canonicalBook,
    bookOrder,
    passageUrl: buildScripturePassageUrl(reference),
  };
}

function getMarkdownLinkRanges(markdown) {
  const ranges = [];
  const regex = new RegExp(MARKDOWN_LINK_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function indexWithinRanges(index, ranges) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function normalizeStandaloneScriptureReference(text) {
  const candidate = normalize(text);
  if (!candidate) return null;
  const regex = new RegExp(`^(?:(${['1', '2', '3', 'I', 'II', 'III', '1st', '2nd', '3rd', 'First', 'Second', 'Third'].join('|')})\\s*)?(${SCRIPTURE_BOOK_MATCH_PATTERN})\\s+([0-9]{1,3}(?:[:.][0-9]{1,3})?(?:\\s*[-&,;]\\s*[0-9]{1,3}(?:[:.][0-9]{1,3})?)*)$`, 'i');
  const match = regex.exec(candidate);
  if (!match) return null;
  return parseScriptureMatch(match[1] ?? '', match[2] ?? '', match[3] ?? '');
}

function normalizeScriptureLinksInMarkdown(markdown) {
  let content = String(markdown ?? '');
  const referencesByKey = new Map();

  content = content.replace(MARKDOWN_LINK_REGEX, (full, label, href) => {
    const parsed = normalizeStandaloneScriptureReference(label);
    if (!parsed) return full;
    if (!SCRIPTURE_LINK_HOST_PATTERN.test(String(href ?? ''))) return full;
    referencesByKey.set(parsed.reference, parsed);
    return `[${parsed.reference}](${parsed.passageUrl})`;
  });

  const protectedRanges = getMarkdownLinkRanges(content);
  SCRIPTURE_PASSAGE_REGEX.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = SCRIPTURE_PASSAGE_REGEX.exec(content)) !== null) {
    if (indexWithinRanges(match.index, protectedRanges)) continue;
    const parsed = parseScriptureMatch(match[1] ?? '', match[2] ?? '', match[3] ?? '');
    if (!parsed) continue;
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      parsed,
    });
  }

  let normalizedContent = '';
  let cursor = 0;
  for (const item of matches) {
    if (item.start < cursor) continue;
    normalizedContent += content.slice(cursor, item.start);
    normalizedContent += `[${item.parsed.reference}](${item.parsed.passageUrl})`;
    cursor = item.end;
    referencesByKey.set(item.parsed.reference, item.parsed);
  }
  normalizedContent += content.slice(cursor);

  return {
    contentMarkdown: normalizedContent,
    references: Array.from(referencesByKey.values())
      .sort((a, b) => a.bookOrder - b.bookOrder || a.reference.localeCompare(b.reference)),
  };
}

function normalizeScriptureBlocks(blocks) {
  const referencesByKey = new Map();
  const normalizedBlocks = blocks.map((block) => {
    const normalized = normalizeScriptureLinksInMarkdown(block.contentMarkdown);
    for (const reference of normalized.references) {
      referencesByKey.set(reference.reference, reference);
    }
    return {
      ...block,
      contentMarkdown: normalized.contentMarkdown,
    };
  });
  return {
    blocks: normalizedBlocks,
    references: Array.from(referencesByKey.values())
      .sort((a, b) => a.bookOrder - b.bookOrder || a.reference.localeCompare(b.reference)),
  };
}

function isLocalDateString(value) {
  const candidate = normalize(value);
  if (!LOCAL_DATE_PATTERN.test(candidate)) return false;
  const [year, month, day] = candidate.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function parseFrontMatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content.trimStart());

  // Parse the YAML block (front matter block, or the whole content for plain meta.yaml files)
  const yamlBlock = match ? match[1] : content.trim();
  const body = match ? match[2].replace(/^\n+/, '') : '';
  const data = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const parsed = safeJsonParse(rawValue, []);
      data[key] = Array.isArray(parsed) ? parsed.map(String) : [];
      continue;
    }

    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        data[key] = JSON.parse(rawValue);
      } catch {
        data[key] = rawValue.slice(1, -1);
      }
      continue;
    }

    data[key] = rawValue;
  }

  return { data, body };
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return [];
}

function parseDailyNoteMarkdownForImport(content, fileName) {
  const now = getIsoNow();
  const { data, body } = parseFrontMatter(content);
  const id = normalize(typeof data.id === 'string' ? data.id : '');
  const fallbackDate = /^\d{4}-\d{2}-\d{2}\.md$/i.test(fileName) ? fileName.slice(0, 10) : '';
  const date = normalize(typeof data.date === 'string' ? data.date : fallbackDate);
  const declaredType = normalize(typeof data.type === 'string' ? data.type : '').toLowerCase();

  if (!id) return null;
  if (!date) return null;
  if (declaredType && declaredType !== 'daily-note') return null;

  // DEC-38: Parse blocks from body so create/update can store them without re-parsing.
  // Legacy markdown without block ID comments receives fresh block IDs per DEC-36.
  const blocks = parseBlocksFromMarkdown(body);
  return {
    id,
    date,
    content: {},
    contentMarkdown: body,
    blocks,
    linkedObjectIds: parseStringList(data.linkedObjectIds),
    tags: parseStringList(data.tags),
    createdAt: normalize(typeof data.createdAt === 'string' ? data.createdAt : now) || now,
    updatedAt: normalize(typeof data.updatedAt === 'string' ? data.updatedAt : now) || now,
  };
}

function parseTopicNoteMarkdownForImport(content) {
  const now = getIsoNow();
  const { data, body } = parseFrontMatter(content);
  const id = normalize(typeof data.id === 'string' ? data.id : '');
  const declaredType = normalize(typeof data.type === 'string' ? data.type : '').toLowerCase();
  const title = normalize(typeof data.title === 'string' ? data.title : '') || titleFromText(body);

  if (!id) return null;
  if (declaredType && declaredType !== 'topic-note') return null;

  // DEC-38: Parse blocks from body so create/update can store them without re-parsing.
  // Legacy markdown without block ID comments receives fresh block IDs per DEC-36.
  const blocks = parseBlocksFromMarkdown(body);
  return {
    id,
    title,
    date: normalize(typeof data.date === 'string' ? data.date : ''),
    content: {},
    contentMarkdown: body,
    blocks,
    linkedObjectIds: parseStringList(data.linkedObjectIds),
    tags: parseStringList(data.tags),
    createdAt: normalize(typeof data.createdAt === 'string' ? data.createdAt : now) || now,
    updatedAt: normalize(typeof data.updatedAt === 'string' ? data.updatedAt : now) || now,
  };
}

function importNotesFromDirectory(type, directoryPath) {
  const targetPath = resolve(directoryPath);
  if (!existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }

  const files = readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
    .map((entry) => join(targetPath, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    return {
      type,
      path: targetPath,
      scanned: 0,
      created: 0,
      updated: 0,
      failed: 0,
      failures: [],
    };
  }

  return withDb((db) => {
    const failures = [];
    let created = 0;
    let updated = 0;

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const content = readFileSync(filePath, 'utf8');
        if (type === 'daily-note') {
          const parsed = parseDailyNoteMarkdownForImport(content, fileName);
          if (!parsed) {
            throw new Error('Daily Note front matter must include both id and date fields');
          }
          const existing = getDailyNote(db, parsed.id) ?? getDailyNote(db, parsed.date);
          if (existing) {
            updateDailyNoteRecord(db, existing.id, parsed);
            updated += 1;
          } else {
            createDailyNoteRecord(db, parsed);
            created += 1;
          }
          continue;
        }

        const parsed = parseTopicNoteMarkdownForImport(content);
        if (!parsed) {
          throw new Error('Topic Note front matter must include an id field');
        }
        const existing = getTopicNote(db, parsed.id);
        if (existing) {
          updateTopicNoteRecord(db, parsed.id, parsed);
          updated += 1;
        } else {
          createTopicNoteRecord(db, parsed);
          created += 1;
        }
      } catch (error) {
        failures.push({
          file: fileName,
          error: String(error instanceof Error ? error.message : error),
        });
      }
    }

    return {
      type,
      path: targetPath,
      scanned: files.length,
      created,
      updated,
      failed: failures.length,
      failures,
    };
  });
}

function withDb(action) {
  const db = openDb();
  try {
    return action(db);
  } finally {
    db.close();
  }
}

function cleanupOrphanedScriptures(db) {
  const orphans = db.prepare(`
    SELECT s.id, s.reference
    FROM scriptures s
    LEFT JOIN object_links ol ON ol.target_id = s.id AND ol.target_type = ?
    WHERE ol.target_id IS NULL
  `).all(SCRIPTURE_TYPE);
  if (orphans.length === 0) return [];
  const del = db.prepare('DELETE FROM scriptures WHERE id = ?');
  for (const row of orphans) del.run(row.id);
  return orphans;
}

// DEC-48: Remove scripture records whose chapter numbers exceed the real
// maximum for their book (e.g. "Thessalonians 500" created before chapter
// validation was introduced).  Also scrubs the embedded BibleGateway markdown
// link from any note_blocks that contain it, reverting to plain text.
function repairInvalidScriptureChapters(db) {
  const all = db.prepare('SELECT id, reference, passage_url FROM scriptures').all();
  if (all.length === 0) return [];

  const removed = [];

  for (const row of all) {
    const ref = String(row.reference ?? '').trim();

    // Re-validate: parse the reference against the chapter map.
    // A reference looks like "1 Thessalonians 5" or "Psalm 150:3".
    const refMatch = /^(?:(1|2|3)\s+)?(.+?)\s+(\d+)(?:[:.]\d+)?/.exec(ref);
    if (!refMatch) continue; // can't parse → skip cautiously

    const volumeRaw = refMatch[1] ?? '';
    const bookRaw = refMatch[2] ?? '';
    const chapter = parseInt(refMatch[3], 10);

    const canonicalBook = buildCanonicalScriptureBook(volumeRaw, bookRaw);
    if (!canonicalBook) {
      removed.push({ id: row.id, reference: ref, passage_url: row.passage_url ?? '', reason: 'unresolvable book' });
    } else {
      const maxChapter = SCRIPTURE_BOOK_MAX_CHAPTERS.get(canonicalBook);
      if (maxChapter !== undefined && chapter > maxChapter) {
        removed.push({ id: row.id, reference: ref, passage_url: row.passage_url ?? '', reason: `chapter ${chapter} > max ${maxChapter}` });
      }
    }
  }

  if (removed.length === 0) return [];

  const deleteLinks = db.prepare('DELETE FROM object_links WHERE target_id = ? AND target_type = ?');
  const deleteScripture = db.prepare('DELETE FROM scriptures WHERE id = ?');
  const updateBlock = db.prepare('UPDATE note_blocks SET content_markdown = ?, updated_at = ? WHERE note_id = ? AND block_id = ?');
  const now = getIsoNow();

  for (const item of removed) {
    const passageUrl = item.passage_url;

    // Scrub the biblegateway link from any note_blocks that embed it:
    // Replace [label](passageUrl) → label (drop the link, keep the label text)
    if (passageUrl) {
      const affectedBlocks = db.prepare(
        "SELECT note_id, block_id, content_markdown FROM note_blocks WHERE content_markdown LIKE ?",
      ).all(`%${passageUrl}%`);

      for (const block of affectedBlocks) {
        const escapedUrl = passageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cleaned = block.content_markdown.replace(
          new RegExp(`\\[([^\\]]+)\\]\\(${escapedUrl}\\)`, 'g'),
          '$1',
        );
        if (cleaned !== block.content_markdown) {
          updateBlock.run(cleaned, now, block.note_id, block.block_id);
        }
      }
    }

    deleteLinks.run(item.id, SCRIPTURE_TYPE);
    deleteScripture.run(item.id);
  }

  console.warn(`[scripture-repair] Removed ${removed.length} invalid scripture record(s): ${removed.map((r) => `"${r.reference}" (${r.reason})`).join(', ')}`);

  return removed;
}

function configureDbConcurrency(db) {
  // Desktop background sync may overlap with foreground reads/writes.
  // Use WAL + a busy timeout so separate CLI processes can coexist without
  // stalling the UI or immediately failing with "database is locked".
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
}

function openDb() {
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  configureDbConcurrency(db);
  ensureSchema(db);
  backfillMissingSyncPaths(db);
  backfillNoteBlocks(db);
  repairNoteBlocksIntegrity(db);
  repairInvalidScriptureChapters(db);
  cleanupOrphanedScriptures(db);
  return db;
}

function ensureSchema(db) {
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    db.prepare(statement).run();
  }
  // DEC-20, DEC-21: Ensure schema is migrated for new sync_path columns
  ensureSchemaMigrations(db);
}

function isMissingSyncPath(path) {
  const value = String(path ?? '').trim();
  return value === '' || value === '(no path)';
}

function backfillMissingSyncPaths(db) {
  const rootFolder = getSyncRootFolder();

  const missingDaily = db.prepare("SELECT id, date, sync_path FROM daily_notes WHERE TRIM(COALESCE(sync_path, '')) = ''").all();
  for (const row of missingDaily) {
    db.prepare('UPDATE daily_notes SET sync_path = ? WHERE id = ?').run(dailyNoteSyncPath(rootFolder, row.date), row.id);
  }

  const missingTopic = db.prepare("SELECT id, title, sync_path FROM topic_notes WHERE TRIM(COALESCE(sync_path, '')) = ''").all();
  for (const row of missingTopic) {
    db.prepare('UPDATE topic_notes SET sync_path = ? WHERE id = ?').run(topicNoteSyncPath(rootFolder, row.title, row.id), row.id);
  }

  const missingProject = db.prepare("SELECT id, name, sync_path FROM projects WHERE TRIM(COALESCE(sync_path, '')) = ''").all();
  for (const row of missingProject) {
    db.prepare('UPDATE projects SET sync_path = ? WHERE id = ?').run(canonicalProjectSyncPath(rootFolder, row.name || row.id), row.id);
  }

  const missingRefMat = db.prepare("SELECT id, name, sync_path FROM ref_materials WHERE TRIM(COALESCE(sync_path, '')) = ''").all();
  for (const row of missingRefMat) {
    db.prepare('UPDATE ref_materials SET sync_path = ? WHERE id = ?').run(canonicalRefMaterialSyncPath(rootFolder, row.name || row.id), row.id);
  }

  // Repair legacy file-object rows that store stale human-readable folder paths
  // instead of the canonical slug-backed sync directory (README / DEC-10).
  const projectRows = db.prepare("SELECT id, name, sync_path FROM projects WHERE TRIM(COALESCE(sync_path, '')) <> ''").all();
  for (const row of projectRows) {
    const canonicalPath = canonicalProjectSyncPath(rootFolder, row.name || row.id);
    const currentPath = String(row.sync_path ?? '').trim();
    if (!currentPath || currentPath === canonicalPath) continue;
    const currentLocalPath = resolveLocalSyncPath(currentPath);
    const canonicalLocalPath = resolveLocalSyncPath(canonicalPath);
    if (!existsSync(currentLocalPath) && existsSync(canonicalLocalPath)) {
      db.prepare('UPDATE projects SET sync_path = ? WHERE id = ?').run(canonicalPath, row.id);
    }
  }

  const refMatRows = db.prepare("SELECT id, name, sync_path FROM ref_materials WHERE TRIM(COALESCE(sync_path, '')) <> ''").all();
  for (const row of refMatRows) {
    const canonicalPath = canonicalRefMaterialSyncPath(rootFolder, row.name || row.id);
    const currentPath = String(row.sync_path ?? '').trim();
    if (!currentPath || currentPath === canonicalPath) continue;
    const currentLocalPath = resolveLocalSyncPath(currentPath);
    const canonicalLocalPath = resolveLocalSyncPath(canonicalPath);
    if (!existsSync(currentLocalPath) && existsSync(canonicalLocalPath)) {
      db.prepare('UPDATE ref_materials SET sync_path = ? WHERE id = ?').run(canonicalPath, row.id);
    }
  }

  const missingHabit = db.prepare("SELECT id, date, sync_path FROM habits WHERE TRIM(COALESCE(sync_path, '')) = ''").all();
  for (const row of missingHabit) {
    const tags = getTagDisplayNames(db, row.id);
    db.prepare('UPDATE habits SET sync_path = ? WHERE id = ?').run(habitSyncPath(rootFolder, row.id, row.date, tags), row.id);
  }

  // Safety pass for any legacy placeholder value persisted from older flows.
  for (const table of ['daily_notes', 'topic_notes', 'projects', 'ref_materials', 'habits']) {
    const rows = db.prepare(`SELECT id, sync_path FROM ${table} WHERE sync_path = '(no path)'`).all();
    if (!rows.length) continue;
    for (const row of rows) {
      if (!isMissingSyncPath(row.sync_path)) continue;
      // Placeholder gets rewritten by type-specific pass on next open.
      db.prepare(`UPDATE ${table} SET sync_path = '' WHERE id = ?`).run(row.id);
    }
  }
}

// DEC-36: Generate a new block ID in the canonical `blk-<12 lowercase hex>` format.
function generateBlockId() {
  return 'blk-' + randomUUID().replace(/-/g, '').slice(0, 12);
}

// DEC-36: Parse markdown into an ordered array of blocks, extracting embedded block IDs
// from trailing HTML comments (e.g. `text <!-- blk-a1b2c3d4e5f6 -->`). Blocks without
// an embedded ID receive a freshly generated one. The returned `contentMarkdown` for each
// block does NOT include the comment; the ID is stored in `blockId`.
function parseBlocksFromMarkdown(contentMarkdown) {
  const raw = (contentMarkdown ?? '').trimEnd();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/).map((p) => p.trimEnd()).filter(Boolean);
  const seenIds = new Set();
  return paragraphs.map((paragraph) => {
    const match = /\s*<!--\s*(blk-[a-f0-9]{12})\s*-->\s*$/.exec(paragraph);
    const embeddedId = match?.[1] ?? '';
    const blockId = embeddedId && !seenIds.has(embeddedId) ? embeddedId : generateBlockId();
    seenIds.add(blockId);
    if (match && blockId === embeddedId) {
      return { blockId, contentMarkdown: paragraph.slice(0, match.index).trimEnd() };
    }
    return { blockId, contentMarkdown: paragraph };
  });
}

function normalizeBlocksForPersistence(blocks, contextLabel) {
  if (!Array.isArray(blocks)) {
    throw new Error(`${contextLabel}: blocks must be an array`);
  }
  const seenBlockIds = new Set();
  return blocks.map((block, index) => {
    if (!block || typeof block !== 'object') {
      throw new Error(`${contextLabel}: block at index ${index} must be an object`);
    }
    const rawId = typeof block.blockId === 'string' ? block.blockId.trim() : '';
    if (!BLOCK_ID_PATTERN.test(rawId)) {
      throw new Error(`${contextLabel}: block at index ${index} has an invalid block ID`);
    }
    if (seenBlockIds.has(rawId)) {
      throw new Error(`${contextLabel}: duplicate block ID "${rawId}"`);
    }
    seenBlockIds.add(rawId);
    const contentMarkdown = typeof block.contentMarkdown === 'string'
      ? block.contentMarkdown
      : String(block.contentMarkdown ?? '');
    return {
      blockId: rawId,
      position: index,
      contentMarkdown,
    };
  });
}

function ensureBackfillBlocks(contentMarkdown) {
  const parsedBlocks = parseBlocksFromMarkdown(contentMarkdown);
  if (parsedBlocks.length > 0) {
    return normalizeBlocksForPersistence(parsedBlocks, 'Legacy note backfill');
  }
  return normalizeBlocksForPersistence(
    [{ blockId: generateBlockId(), contentMarkdown: '' }],
    'Legacy note backfill',
  );
}

function repairNoteBlocksIntegrity(db) {
  const now = getIsoNow();
  const noteIds = db.prepare('SELECT DISTINCT note_id FROM note_blocks').all().map((row) => row.note_id);
  const selectRows = db.prepare(`
    SELECT rowid, note_id, block_id, note_type, position, content_markdown
    FROM note_blocks
    WHERE note_id = ?
    ORDER BY position ASC, rowid ASC
  `);
  const deleteRows = db.prepare('DELETE FROM note_blocks WHERE note_id = ?');
  const insertRow = db.prepare(
    'INSERT INTO note_blocks (note_id, block_id, note_type, position, content_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const hasTopicNote = db.prepare('SELECT 1 FROM topic_notes WHERE id = ? LIMIT 1');
  const hasDailyNote = db.prepare('SELECT 1 FROM daily_notes WHERE id = ? LIMIT 1');
  const warnings = [];

  for (const noteId of noteIds) {
    const rows = selectRows.all(noteId);
    if (!rows.length) continue;

    const rawType = typeof rows[0].note_type === 'string' ? rows[0].note_type : '';
    const inferredType = hasTopicNote.get(noteId) ? 'topic-note' : (hasDailyNote.get(noteId) ? 'daily-note' : '');
    const noteType = rawType === 'topic-note' || rawType === 'daily-note' ? rawType : inferredType;
    if (!noteType) {
      warnings.push(`note_id=${noteId}: could not infer note type while validating note_blocks`);
      continue;
    }

    const seen = new Set();
    let changed = false;
    const normalized = rows.map((row, index) => {
      const existingId = typeof row.block_id === 'string' ? row.block_id.trim() : '';
      let nextId = existingId;
      if (!BLOCK_ID_PATTERN.test(nextId) || seen.has(nextId)) {
        nextId = generateBlockId();
        changed = true;
      }
      seen.add(nextId);
      if (row.position !== index || row.note_type !== noteType) {
        changed = true;
      }
      return {
        blockId: nextId,
        position: index,
        contentMarkdown: typeof row.content_markdown === 'string'
          ? row.content_markdown
          : String(row.content_markdown ?? ''),
      };
    });

    if (!changed) continue;

    withTransaction(db, () => {
      deleteRows.run(noteId);
      for (const block of normalized) {
        insertRow.run(noteId, block.blockId, noteType, block.position, block.contentMarkdown, now, now);
      }
    });
  }

  if (warnings.length > 0) {
    console.error(
      `note_blocks integrity warnings during startup:\n${warnings.map((warning) => `- ${warning}`).join('\n')}`,
    );
  }
}

// DEC-36: Assemble full content_markdown from ordered blocks, embedding each block's ID as
// a trailing HTML comment. Used for dual-write to the legacy content_markdown column so that
// subsequent reads can round-trip block IDs without querying the note_blocks table.
function assembleMarkdownFromBlocks(blocks) {
  const normalizedBlocks = normalizeBlocksForPersistence(blocks, 'assembleMarkdownFromBlocks');
  if (!normalizedBlocks.length) return '';
  return normalizedBlocks.map(({ blockId, contentMarkdown }) => `${contentMarkdown} <!-- ${blockId} -->`).join('\n\n');
}

// DEC-37: Fetch ordered blocks for a note from the note_blocks table.
function getNoteBlocks(db, noteId) {
  return db
    .prepare('SELECT block_id, position, content_markdown FROM note_blocks WHERE note_id = ? ORDER BY position ASC')
    .all(noteId)
    .map((row) => ({ blockId: row.block_id, position: row.position, contentMarkdown: row.content_markdown }));
}

function getCanonicalNoteContent(db, noteId, legacyContentMarkdown) {
  const blocks = getNoteBlocks(db, noteId);
  if (blocks.length > 0) {
    return {
      blocks,
      contentMarkdown: assembleMarkdownFromBlocks(blocks),
    };
  }
  return {
    blocks,
    contentMarkdown: legacyContentMarkdown ?? '',
  };
}

const SQLITE_IN_CLAUSE_CHUNK_SIZE = 400;

function chunkValues(values, chunkSize = SQLITE_IN_CLAUSE_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function getCanonicalNoteContentMap(db, noteRows) {
  const rows = Array.isArray(noteRows) ? noteRows : [];
  const ids = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  const blocksByNoteId = new Map();

  for (const chunk of chunkValues(ids)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const blocks = db.prepare(`
      SELECT note_id, block_id, position, content_markdown
      FROM note_blocks
      WHERE note_id IN (${placeholders})
      ORDER BY note_id ASC, position ASC
    `).all(...chunk);
    for (const row of blocks) {
      if (!blocksByNoteId.has(row.note_id)) {
        blocksByNoteId.set(row.note_id, []);
      }
      blocksByNoteId.get(row.note_id).push({
        blockId: row.block_id,
        position: row.position,
        contentMarkdown: row.content_markdown,
      });
    }
  }

  const contentByNoteId = new Map();
  for (const row of rows) {
    const blocks = blocksByNoteId.get(row.id) ?? [];
    contentByNoteId.set(row.id, {
      blocks,
      contentMarkdown: blocks.length > 0 ? assembleMarkdownFromBlocks(blocks) : (row.content_markdown ?? ''),
    });
  }
  return contentByNoteId;
}

// DEC-37: Atomically replace all blocks for a note. Must be called within a transaction.
function persistNoteBlocks(db, noteId, noteType, blocks, now) {
  const normalizedBlocks = normalizeBlocksForPersistence(blocks, `persistNoteBlocks(${noteId})`);
  db.prepare('DELETE FROM note_blocks WHERE note_id = ?').run(noteId);
  const insert = db.prepare(
    'INSERT INTO note_blocks (note_id, block_id, note_type, position, content_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const block of normalizedBlocks) {
    insert.run(noteId, block.blockId, noteType, block.position, block.contentMarkdown, now, now);
  }
}

// DEC-36, DEC-37: Backfill note_blocks for legacy notes that have content_markdown but no blocks yet.
function backfillNoteBlocks(db) {
  const now = getIsoNow();
  const insertBlock = db.prepare(
    'INSERT INTO note_blocks (note_id, block_id, note_type, position, content_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const hasBlocks = db.prepare('SELECT 1 FROM note_blocks WHERE note_id = ? LIMIT 1');
  const errors = [];

  const topicNotes = db.prepare('SELECT id, content_markdown FROM topic_notes').all();
  for (const row of topicNotes) {
    if (hasBlocks.get(row.id)) continue;
    try {
      if (typeof row.id !== 'string' || !row.id.trim()) {
        throw new Error('missing or invalid note id');
      }
      if (row.content_markdown !== null && row.content_markdown !== undefined && typeof row.content_markdown !== 'string') {
        throw new Error('content_markdown must be text');
      }
      const blocks = ensureBackfillBlocks(row.content_markdown ?? '');
      for (const block of blocks) {
        insertBlock.run(row.id, block.blockId, 'topic-note', block.position, block.contentMarkdown, now, now);
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      errors.push(`topic-note ${String(row.id ?? '(unknown)')}: ${message}`);
    }
  }

  const dailyNotes = db.prepare('SELECT id, content_markdown FROM daily_notes').all();
  for (const row of dailyNotes) {
    if (hasBlocks.get(row.id)) continue;
    try {
      if (typeof row.id !== 'string' || !row.id.trim()) {
        throw new Error('missing or invalid note id');
      }
      if (row.content_markdown !== null && row.content_markdown !== undefined && typeof row.content_markdown !== 'string') {
        throw new Error('content_markdown must be text');
      }
      const blocks = ensureBackfillBlocks(row.content_markdown ?? '');
      for (const block of blocks) {
        insertBlock.run(row.id, block.blockId, 'daily-note', block.position, block.contentMarkdown, now, now);
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      errors.push(`daily-note ${String(row.id ?? '(unknown)')}: ${message}`);
    }
  }

  if (errors.length > 0) {
    const visibleErrors = errors.slice(0, 20);
    console.error(
      `Legacy note block backfill skipped malformed rows (${errors.length}):\n${visibleErrors.map((entry) => `- ${entry}`).join('\n')}`,
    );
  }
}

function withTransaction(db, action) {
  db.exec('BEGIN');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function withDbAsync(action) {
  const db = openDb();
  try {
    return await action(db);
  } finally {
    db.close();
  }
}

function getSyncState(db, objectType, objectId) {
  return db.prepare(`
    SELECT object_id, object_type, has_remote_copy, last_seen_remote_at
    FROM sync_state
    WHERE object_id = ? AND object_type = ?
  `).get(objectId, objectType) ?? null;
}

function hasKnownRemoteCopy(db, objectType, objectId) {
  const state = getSyncState(db, objectType, objectId);
  return Boolean(state?.has_remote_copy);
}

function markRemotePresence(db, objectType, objectId, seenAt = getIsoNow()) {
  db.prepare(`
    INSERT INTO sync_state (object_id, object_type, has_remote_copy, last_seen_remote_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(object_id, object_type) DO UPDATE SET
      has_remote_copy = 1,
      last_seen_remote_at = excluded.last_seen_remote_at
  `).run(objectId, objectType, seenAt);
}

function clearSyncState(db, objectType, objectId) {
  db.prepare('DELETE FROM sync_state WHERE object_id = ? AND object_type = ?').run(objectId, objectType);
}

function getTagDisplayNames(db, objectId) {
  const rows = db.prepare(`
    SELECT t.display_name
    FROM object_tags ot
    JOIN tags t ON t.id = ot.tag_id
    WHERE ot.object_id = ?
    ORDER BY t.display_name ASC
  `).all(objectId);
  return rows.map((row) => row.display_name);
}

function getTagDisplayNamesMap(db, objectIds) {
  const ids = Array.from(new Set((objectIds ?? []).filter(Boolean)));
  const tagNamesByObjectId = new Map();
  for (const objectId of ids) {
    tagNamesByObjectId.set(objectId, []);
  }

  for (const chunk of chunkValues(ids)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT ot.object_id, t.display_name
      FROM object_tags ot
      JOIN tags t ON t.id = ot.tag_id
      WHERE ot.object_id IN (${placeholders})
      ORDER BY ot.object_id ASC, t.display_name COLLATE NOCASE ASC
    `).all(...chunk);
    for (const row of rows) {
      if (!tagNamesByObjectId.has(row.object_id)) {
        tagNamesByObjectId.set(row.object_id, []);
      }
      tagNamesByObjectId.get(row.object_id).push(row.display_name);
    }
  }

  return tagNamesByObjectId;
}

function ensureTagIds(db, displayNames) {
  const normalizedNames = Array.from(new Set(displayNames.map((name) => name.trim()).filter(Boolean)));
  const ids = [];
  for (const displayName of normalizedNames) {
    const name = displayName.toLowerCase();
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (existing?.id) {
      ids.push(existing.id);
      continue;
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO tags (id, name, display_name, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, displayName, getIsoNow());
    ids.push(id);
  }
  return ids;
}

function syncObjectTags(db, objectId, objectType, tagNames) {
  assertPinnedTagAllowedForObjectType(objectType, tagNames);
  db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(objectId);
  if (!tagNames) return;
  const tagIds = ensureTagIds(db, tagNames);
  const insert = db.prepare('INSERT OR IGNORE INTO object_tags (object_id, object_type, tag_id) VALUES (?, ?, ?)');
  for (const tagId of tagIds) {
    insert.run(objectId, objectType, tagId);
  }
}

function listLinkableObjectRefs(db) {
  return db.prepare(`
    SELECT id, type, sync_path FROM (
      SELECT id, 'topic-note' AS type, sync_path AS sync_path FROM topic_notes
      UNION ALL
      SELECT id, 'daily-note' AS type, sync_path AS sync_path FROM daily_notes
      UNION ALL
      SELECT id, 'project' AS type, sync_path AS sync_path FROM projects
      UNION ALL
      SELECT id, 'ref-material' AS type, sync_path AS sync_path FROM ref_materials
      UNION ALL
      SELECT id, 'habit' AS type, sync_path AS sync_path FROM habits
    )
  `).all().map((row) => ({
    id: row.id,
    type: row.type,
    syncPath: row.sync_path || '',
  }));
}

function lookupObjectSummary(db, id, typeHint) {
  const lookupType = normalize(typeHint).toLowerCase();
  const row = db.prepare(`
    SELECT id, type, label, date, sync_path, passage_url FROM (
      SELECT id, 'topic-note' AS type, title AS label, date, sync_path AS sync_path, '' AS passage_url FROM topic_notes
      UNION ALL
      SELECT id, 'daily-note' AS type, date AS label, date, sync_path AS sync_path, '' AS passage_url FROM daily_notes
      UNION ALL
      SELECT id, 'project' AS type, name AS label, '' AS date, sync_path AS sync_path, '' AS passage_url FROM projects
      UNION ALL
      SELECT id, 'ref-material' AS type, name AS label, '' AS date, sync_path AS sync_path, '' AS passage_url FROM ref_materials
      UNION ALL
      SELECT id, 'habit' AS type, text AS label, date, sync_path AS sync_path, '' AS passage_url FROM habits
      UNION ALL
      SELECT id, 'scripture' AS type, reference AS label, '' AS date, '' AS sync_path, passage_url AS passage_url FROM scriptures
    )
    WHERE id = ?
      AND (? = '' OR type = ?)
    ORDER BY type ASC
    LIMIT 1
  `).get(id, lookupType, lookupType);
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.label || '',
    date: row.date || '',
    syncPath: row.sync_path || '',
    passageUrl: row.passage_url || '',
  };
}

function parseMarkdownLinkHrefs(contentMarkdown) {
  const markdown = String(contentMarkdown ?? '');
  const matches = markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  const seen = new Set();
  const hrefs = [];
  for (const match of matches) {
    const raw = String(match[1] ?? '').trim();
    if (!raw) continue;
    const withoutAngleBrackets = raw.replace(/^<|>$/g, '');
    const href = withoutAngleBrackets.split(/\s+/)[0] || '';
    if (!href || seen.has(href)) continue;
    seen.add(href);
    hrefs.push(href);
  }
  return hrefs;
}

function parseCanonicalInternalHref(href) {
  const decodedHref = decodeUriComponentSafe(String(href ?? '').trim());
  if (!decodedHref || decodedHref.startsWith('#')) return null;
  if (/^(mailto|tel):/i.test(decodedHref)) return null;
  if (/^https?:\/\//i.test(decodedHref)) return null;
  const withoutQuery = decodedHref.replace(/\?.*$/, '');
  const hashIndex = withoutQuery.indexOf('#');
  const targetId = (hashIndex >= 0 ? withoutQuery.slice(0, hashIndex) : withoutQuery).trim();
  const fragment = (hashIndex >= 0 ? withoutQuery.slice(hashIndex + 1) : '').trim();
  if (!targetId || targetId.includes('/')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(targetId)) return null;
  return { targetId, fragment };
}

function createSyncOutgoingLinkResolver(db, sourceSyncPath, rootFolder) {
  const targetCache = new Map();

  function lookupTargetById(id) {
    if (!id) return null;
    if (targetCache.has(id)) return targetCache.get(id);
    const summary = lookupObjectSummary(db, id, '');
    targetCache.set(id, summary);
    return summary;
  }

  function resolveBibleGatewayLink(target, fragment) {
    const url = String(target?.passageUrl ?? '').trim();
    if (!url || !SCRIPTURE_LINK_HOST_PATTERN.test(url)) return null;
    return fragment ? `${url}#${fragment}` : url;
  }

  function resolveLocalRelativePath(target, fragment) {
    const targetPath = normalizeSyncPath(target?.syncPath ?? '');
    if (!targetPath || hasTraversalPathSegments(targetPath)) return null;

    const sourcePath = normalizeSyncPath(sourceSyncPath);
    if (!sourcePath || hasTraversalPathSegments(sourcePath)) return null;
    if (!isPathWithinSyncRoot(sourcePath, rootFolder) || !isPathWithinSyncRoot(targetPath, rootFolder)) return null;

    const relativePath = relativeSyncPathBetween(sourcePath, targetPath);
    if (!relativePath) return null;
    return fragment ? `${relativePath}#${fragment}` : relativePath;
  }

  // Resolver precedence (first match wins): BibleGateway URL metadata, then local relative sync path.
  const resolvers = [resolveBibleGatewayLink, resolveLocalRelativePath];

  return (href) => {
    const parsed = parseCanonicalInternalHref(href);
    if (!parsed) return href;
    const target = lookupTargetById(parsed.targetId);
    if (!target) return href;

    for (const resolveLink of resolvers) {
      const nextHref = resolveLink(target, parsed.fragment);
      if (nextHref) return nextHref;
    }
    return href;
  };
}

function resolveMarkdownLinkHrefParts(rawHref) {
  const raw = String(rawHref ?? '');
  const match = /^(\s*)(<[^>]+>|[^\s)]+)(.*)$/.exec(raw);
  if (!match) return null;
  const leading = match[1] ?? '';
  const hrefToken = match[2] ?? '';
  const trailing = match[3] ?? '';
  if (!hrefToken) return null;
  const wrapped = hrefToken.startsWith('<') && hrefToken.endsWith('>');
  const href = wrapped ? hrefToken.slice(1, -1) : hrefToken;
  return { leading, href, trailing, wrapped };
}

function rewriteMarkdownLinkHrefs(contentMarkdown, resolveHref) {
  if (typeof resolveHref !== 'function') return String(contentMarkdown ?? '');
  const linkRegex = new RegExp(MARKDOWN_LINK_REGEX.source, 'g');
  return String(contentMarkdown ?? '').replace(linkRegex, (full, label, rawHref) => {
    const parsedHref = resolveMarkdownLinkHrefParts(rawHref);
    if (!parsedHref) return full;
    const resolvedHref = String(resolveHref(parsedHref.href) ?? '').trim();
    if (!resolvedHref || resolvedHref === parsedHref.href) return full;
    const formattedHref = parsedHref.wrapped ? `<${resolvedHref}>` : resolvedHref;
    return `[${label}](${parsedHref.leading}${formattedHref}${parsedHref.trailing})`;
  });
}

function resolveLegacyPathHrefToObject(refs, href, sourceSyncPath) {
  const decodedHref = decodeUriComponentSafe(String(href ?? '').trim());
  if (!decodedHref || decodedHref.startsWith('#')) return { status: 'skipped', reason: 'fragment-only' };
  if (/^(mailto|tel):/i.test(decodedHref)) return { status: 'skipped', reason: 'unsupported-scheme' };
  if (/^https?:\/\//i.test(decodedHref)) return { status: 'skipped', reason: 'external-url' };

  const withoutQuery = decodedHref.replace(/\?.*$/, '');
  const hashIndex = withoutQuery.indexOf('#');
  const pathPart = (hashIndex >= 0 ? withoutQuery.slice(0, hashIndex) : withoutQuery).trim();
  const fragment = (hashIndex >= 0 ? withoutQuery.slice(hashIndex + 1) : '').trim();
  if (!pathPart) return { status: 'skipped', reason: 'empty-href' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathPart)) return { status: 'skipped', reason: 'unsupported-scheme' };

  const rootRelative = ROOT_RELATIVE_APP_PATTERN.test(pathPart) ? `/${pathPart}` : pathPart;
  const looksLegacyPath = pathPart.includes('/') || pathPart.includes('\\') || rootRelative.startsWith('.') || /\.md$/i.test(pathPart);
  if (!looksLegacyPath) return { status: 'skipped', reason: 'not-legacy-path' };

  const normalizedTargetPath = rootRelative.startsWith('/')
    ? normalizeSyncPath(rootRelative)
    : sourceSyncPath
      ? resolveRelativeSyncPath(sourceSyncPath, rootRelative)
      : '';

  const exactMatches = normalizedTargetPath
    ? refs.filter((item) => normalizeSyncPathForLookup(item.syncPath) === normalizeSyncPathForLookup(normalizedTargetPath))
    : [];
  const exactUniqueMatches = Array.from(new Map(exactMatches.map((item) => [item.id, item])).values());
  if (exactUniqueMatches.length === 1) {
    return { status: 'resolved', target: exactUniqueMatches[0], fragment };
  }
  if (exactUniqueMatches.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple-exact-path-matches',
      candidateIds: exactUniqueMatches.map((item) => item.id).sort((a, b) => a.localeCompare(b)),
    };
  }

  const targetRelative = normalizeRelativePathSegments(rootRelative);
  if (!targetRelative) return { status: 'unresolved', reason: 'path-not-resolved' };

  const suffixMatches = refs.filter((item) => {
    const candidate = normalizeSyncPathForLookup(item.syncPath);
    return candidate.endsWith(`/${targetRelative}`) || candidate.endsWith(targetRelative);
  });
  const suffixUniqueMatches = Array.from(new Map(suffixMatches.map((item) => [item.id, item])).values());
  if (suffixUniqueMatches.length === 1) {
    return { status: 'resolved', target: suffixUniqueMatches[0], fragment };
  }
  if (suffixUniqueMatches.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple-suffix-matches',
      candidateIds: suffixUniqueMatches.map((item) => item.id).sort((a, b) => a.localeCompare(b)),
    };
  }

  const targetBaseName = splitPathSegments(targetRelative).at(-1) ?? '';
  if (!targetBaseName) return { status: 'unresolved', reason: 'path-not-resolved' };

  const baseNameMatches = refs.filter((item) => {
    const candidateParts = splitPathSegments(normalizeSyncPathForLookup(item.syncPath));
    return candidateParts.at(-1) === targetBaseName;
  });
  const baseNameUniqueMatches = Array.from(new Map(baseNameMatches.map((item) => [item.id, item])).values());
  if (baseNameUniqueMatches.length === 1) {
    return { status: 'resolved', target: baseNameUniqueMatches[0], fragment };
  }
  if (baseNameUniqueMatches.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'multiple-basename-matches',
      candidateIds: baseNameUniqueMatches.map((item) => item.id).sort((a, b) => a.localeCompare(b)),
    };
  }

  return { status: 'unresolved', reason: 'no-matching-object' };
}

function resolveNoteLinkTarget(refs, href, sourceSyncPath) {
  const decodedHref = decodeUriComponentSafe(String(href ?? '').trim());
  if (!decodedHref || decodedHref.startsWith('#')) return null;
  if (/^(mailto|tel):/i.test(decodedHref)) return null;

  let hrefPath = decodedHref;
  if (/^https?:\/\//i.test(decodedHref)) {
    try {
      hrefPath = new URL(decodedHref).pathname || decodedHref;
    } catch {
      return null;
    }
  }

  const withoutFragment = hrefPath.replace(/[?#].*$/, '').trim();
  if (!withoutFragment) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)) return null;

  const idMatch = refs.find((item) => item.id === withoutFragment);
  if (idMatch) return { id: idMatch.id, type: idMatch.type };

  const rootRelative = ROOT_RELATIVE_APP_PATTERN.test(withoutFragment) ? `/${withoutFragment}` : withoutFragment;
  const targetPath = rootRelative.startsWith('/')
    ? normalizeSyncPath(rootRelative)
    : sourceSyncPath
      ? resolveRelativeSyncPath(sourceSyncPath, rootRelative)
      : '';
  if (!targetPath) return null;

  const normalizedTargetPath = normalizeSyncPathForLookup(targetPath);
  const exactPathMatch = refs.find((item) => normalizeSyncPathForLookup(item.syncPath) === normalizedTargetPath);
  if (exactPathMatch) return { id: exactPathMatch.id, type: exactPathMatch.type };

  const targetRelative = normalizeRelativePathSegments(rootRelative);
  const targetBaseName = splitPathSegments(targetRelative).at(-1) ?? '';
  if (!targetRelative) return null;

  const suffixMatch = refs.find((item) => {
    const candidate = normalizeSyncPathForLookup(item.syncPath);
    return candidate.endsWith(`/${targetRelative}`) || candidate.endsWith(targetRelative);
  });
  if (suffixMatch) return { id: suffixMatch.id, type: suffixMatch.type };

  if (!targetBaseName) return null;
  const baseNameMatch = refs.find((item) => {
    const candidateParts = splitPathSegments(normalizeSyncPathForLookup(item.syncPath));
    return candidateParts.at(-1) === targetBaseName;
  });
  return baseNameMatch ? { id: baseNameMatch.id, type: baseNameMatch.type } : null;
}

function extractDateFromLinkHref(href, sourceSyncPath) {
  const decodedHref = decodeUriComponentSafe(String(href ?? '').trim());
  if (!decodedHref || decodedHref.startsWith('#')) return null;
  if (/^(mailto|tel):/i.test(decodedHref)) return null;

  let hrefPath = decodedHref;
  if (/^https?:\/\//i.test(decodedHref)) {
    try {
      hrefPath = new URL(decodedHref).pathname || decodedHref;
    } catch {
      return null;
    }
  }

  const withoutFragment = hrefPath.replace(/[?#].*$/, '').trim();
  if (!withoutFragment) return null;

  if (isLocalDateString(withoutFragment)) {
    return withoutFragment;
  }

  const rootRelative = ROOT_RELATIVE_APP_PATTERN.test(withoutFragment) ? `/${withoutFragment}` : withoutFragment;
  const resolvedPath = rootRelative.startsWith('/')
    ? normalizeSyncPath(rootRelative)
    : sourceSyncPath
      ? resolveRelativeSyncPath(sourceSyncPath, rootRelative)
      : normalizeSyncPath(rootRelative);

  const normalizedCandidates = new Set(
    [withoutFragment, rootRelative, resolvedPath]
      .filter(Boolean)
      .map((candidate) => normalizeSyncPathForLookup(candidate)),
  );

  for (const candidate of normalizedCandidates) {
    const dailyNotesPathMatch = new RegExp(`(?:^|/)${DAILY_NOTES_SUBFOLDER}/(\\d{4}-\\d{2}-\\d{2})\\.md$`, 'i').exec(candidate);
    if (dailyNotesPathMatch?.[1] && isLocalDateString(dailyNotesPathMatch[1])) {
      return dailyNotesPathMatch[1];
    }
    const dateFileMatch = /^\/?(\d{4}-\d{2}-\d{2})(?:\.md)?$/i.exec(candidate);
    if (dateFileMatch?.[1] && isLocalDateString(dateFileMatch[1])) {
      return dateFileMatch[1];
    }
  }

  return null;
}

function mergeLinkTargets(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const target of group ?? []) {
      if (!target?.id || seen.has(target.id)) continue;
      seen.add(target.id);
      merged.push(target);
    }
  }
  return merged;
}

function collectDateLinkTargets(db, dates) {
  const seenDailyIds = new Set();
  const targets = [];
  for (const rawDate of dates) {
    const date = normalize(rawDate);
    if (!isLocalDateString(date)) continue;
    const dailyNote = ensureDailyNoteForDate(db, date);
    if (!dailyNote?.id || seenDailyIds.has(dailyNote.id)) continue;
    seenDailyIds.add(dailyNote.id);
    targets.push({ id: dailyNote.id, type: 'daily-note' });
  }
  return targets;
}

function deriveNoteLinksFromContent(db, sourceId, sourceSyncPath, contentMarkdown) {
  const refs = listLinkableObjectRefs(db);
  const hrefs = parseMarkdownLinkHrefs(contentMarkdown);
  const seenIds = new Set();
  const targets = [];
  for (const href of hrefs) {
    let target = resolveNoteLinkTarget(refs, href, sourceSyncPath);
    if (!target) {
      const dateLink = extractDateFromLinkHref(href, sourceSyncPath);
      if (dateLink) {
        const dailyNote = ensureDailyNoteForDate(db, dateLink);
        if (dailyNote?.id) {
          target = { id: dailyNote.id, type: 'daily-note' };
          refs.push({
            id: dailyNote.id,
            type: 'daily-note',
            syncPath: dailyNote.syncPath || dailyNoteSyncPath(getSyncRootFolder(), dateLink),
          });
        }
      }
    }
    if (!target || target.id === sourceId || seenIds.has(target.id)) continue;
    seenIds.add(target.id);
    targets.push(target);
  }
  return targets;
}

function syncNoteObjectLinks(db, sourceId, sourceType, targets) {
  const targetIds = new Set(targets.map((target) => target.id));
  const removedDailyTargetIds = [];
  const removedScriptureTargetIds = [];
  const existingLinks = db
    .prepare('SELECT source_id, target_id, target_type FROM object_links WHERE source_id = ? AND source_type = ?')
    .all(sourceId, sourceType);
  for (const link of existingLinks) {
    if (!targetIds.has(link.target_id)) {
      db.prepare('DELETE FROM object_links WHERE source_id = ? AND target_id = ?').run(link.source_id, link.target_id);
      if (link.target_type === 'daily-note') {
        removedDailyTargetIds.push(link.target_id);
      }
      if (link.target_type === SCRIPTURE_TYPE) {
        removedScriptureTargetIds.push(link.target_id);
      }
    }
  }

  const insert = db.prepare(`
    INSERT INTO object_links (id, source_id, target_id, source_type, target_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, target_id) DO NOTHING
  `);
  for (const target of targets) {
    insert.run(randomUUID(), sourceId, target.id, sourceType, target.type, getIsoNow());
  }
  cleanupScripturesIfEligible(db, removedScriptureTargetIds);
  return removedDailyTargetIds;
}

function isScriptureDeleteEligible(db, scriptureId) {
  const row = db.prepare('SELECT id FROM scriptures WHERE id = ?').get(scriptureId);
  if (!row?.id) return false;
  if (db.prepare('SELECT 1 FROM object_links WHERE target_id = ? AND target_type = ? LIMIT 1').get(scriptureId, SCRIPTURE_TYPE)) {
    return false;
  }
  return true;
}

function autoDeleteScriptureIfEligible(db, scriptureId) {
  const id = normalize(scriptureId);
  if (!id || !isScriptureDeleteEligible(db, id)) return false;
  const result = db.prepare('DELETE FROM scriptures WHERE id = ?').run(id);
  return result.changes > 0;
}

function cleanupScripturesIfEligible(db, scriptureIds) {
  const seen = new Set();
  for (const scriptureId of scriptureIds ?? []) {
    const id = normalize(scriptureId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    autoDeleteScriptureIfEligible(db, id);
  }
}

function sortRelatedObjectsStable(items) {
  return items.sort((a, b) => {
    const typeCmp = String(a.type).localeCompare(String(b.type));
    if (typeCmp !== 0) return typeCmp;
    const titleCmp = String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
    if (titleCmp !== 0) return titleCmp;
    const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a.id).localeCompare(String(b.id));
  });
}

function getRelatedObjects(db, noteId, direction) {
  const isForward = direction === 'forward';
  const rows = isForward
    ? db.prepare('SELECT target_id AS related_id, target_type AS related_type FROM object_links WHERE source_id = ?').all(noteId)
    : db.prepare('SELECT source_id AS related_id, source_type AS related_type FROM object_links WHERE target_id = ?').all(noteId);
  const seen = new Set();
  const related = [];
  for (const row of rows) {
    if (seen.has(row.related_id)) continue;
    seen.add(row.related_id);
    const summary = lookupObjectSummary(db, row.related_id, row.related_type);
    if (summary) related.push(summary);
  }
  return sortRelatedObjectsStable(related);
}

const objectTypeAliasMap = createObjectTypeAliasMap();

const scriptureService = createScriptureService({
  SCRIPTURE_TYPE,
  getIsoNow,
  randomUUID,
});
const { collectScriptureLinkTargets } = scriptureService;
const scriptureRepository = createScriptureRepository({
  SCRIPTURE_TYPE,
  lookupObjectSummary,
  sortRelatedObjectsStable,
});
const { getScripture, listScriptures } = scriptureRepository;

let dailyNoteService;
const dailyNoteRepository = createDailyNoteRepository({
  assembleMarkdownFromBlocks,
  cleanupDailyNotesIfEligible: (...args) => dailyNoteService.cleanupDailyNotesIfEligible(...args),
  collectScriptureLinkTargets,
  dailyNoteSyncPath,
  deriveNoteLinksFromContent,
  getCanonicalNoteContent,
  getCanonicalNoteContentMap,
  getIsoNow,
  getNoteBlocks,
  getRelatedObjects,
  getSyncRootFolder,
  getTagDisplayNames,
  getTagDisplayNamesMap,
  mergeLinkTargets,
  normalize,
  normalizeScriptureBlocks,
  normalizeSyncPath,
  parseBlocksFromMarkdown,
  persistNoteBlocks,
  safeJsonParse,
  syncNoteObjectLinks,
  syncObjectTags,
  withTransaction,
});
dailyNoteService = createDailyNoteService({
  clearSyncState,
  cleanupScripturesIfEligible,
  createDailyNoteRecord: dailyNoteRepository.createDailyNoteRecord,
  createDailyNoteRecordInternal: dailyNoteRepository.createDailyNoteRecordInternal,
  findDailyNoteRow: dailyNoteRepository.findDailyNoteRow,
  getDailyNote: dailyNoteRepository.getDailyNote,
  getIsoNow,
  hasNonEmptyDailyNoteContent: dailyNoteRepository.hasNonEmptyDailyNoteContent,
  isLocalDateString,
  localDateString,
  normalize,
  prompt,
  promptList,
  promptMultiline,
  randomUUID,
  SCRIPTURE_TYPE,
  updateDailyNoteRecord: dailyNoteRepository.updateDailyNoteRecord,
  withTransaction,
});
const {
  cleanupDailyNotesIfEligible,
  createDailyNoteInteractive,
  deleteDailyNoteRecord,
  ensureDailyNoteForDate,
  isDailyNoteDeleteEligible,
  updateDailyNoteInteractive,
} = dailyNoteService;
const {
  createDailyNoteRecord,
  getDailyNote,
  listDailyNotes,
  listDailyNotesForSync,
  updateDailyNoteRecord,
} = dailyNoteRepository;

const topicNoteRepository = createTopicNoteRepository({
  assembleMarkdownFromBlocks,
  cleanupDailyNotesIfEligible,
  cleanupScripturesIfEligible,
  clearSyncState,
  collectDateLinkTargets,
  collectScriptureLinkTargets,
  deriveNoteLinksFromContent,
  getCanonicalNoteContent,
  getCanonicalNoteContentMap,
  getIsoNow,
  getRelatedObjects,
  getSyncRootFolder,
  getTagDisplayNames,
  getTagDisplayNamesMap,
  mergeLinkTargets,
  normalizeScriptureBlocks,
  normalizeSyncPath,
  parseBlocksFromMarkdown,
  persistNoteBlocks,
  safeJsonParse,
  SCRIPTURE_TYPE,
  syncNoteObjectLinks,
  syncObjectTags,
  topicNoteSyncPath,
  withTransaction,
});
const topicNoteService = createTopicNoteService({
  createTopicNoteRecord: topicNoteRepository.createTopicNoteRecord,
  getIsoNow,
  getTopicNote: topicNoteRepository.getTopicNote,
  prompt,
  promptList,
  promptMultiline,
  randomUUID,
  updateTopicNoteRecord: topicNoteRepository.updateTopicNoteRecord,
});
const {
  createTopicNoteInteractive,
  updateTopicNoteInteractive,
} = topicNoteService;
const {
  createTopicNoteRecord,
  deleteTopicNoteRecord,
  getTopicNote,
  listTopicNotes,
  listTopicNotesForSync,
  updateTopicNoteRecord,
} = topicNoteRepository;

const projectRepository = createProjectRepository({
  clearSyncState,
  cleanupDailyNotesIfEligible,
  collectDateLinkTargets,
  getIsoNow,
  getRelatedObjects,
  getTagDisplayNames,
  getTagDisplayNamesMap,
  syncNoteObjectLinks,
  syncObjectTags,
  withTransaction,
});
const projectService = createProjectService({
  createProjectRecord: projectRepository.createProjectRecord,
  getIsoNow,
  getProject: projectRepository.getProject,
  prompt,
  promptList,
  randomUUID,
  updateProjectRecord: projectRepository.updateProjectRecord,
});
const {
  createProjectInteractive,
  updateProjectInteractive,
} = projectService;
const {
  createProjectRecord,
  deleteProjectRecord,
  getProject,
  listProjects,
  listProjectsForSync,
  updateProjectRecord,
} = projectRepository;

const refMaterialRepository = createRefMaterialRepository({
  clearSyncState,
  getIsoNow,
  getRelatedObjects,
  getTagDisplayNames,
  getTagDisplayNamesMap,
  syncObjectTags,
  withTransaction,
});
const refMaterialService = createRefMaterialService({
  createRefMatRecord: refMaterialRepository.createRefMatRecord,
  getIsoNow,
  getRefMat: refMaterialRepository.getRefMat,
  prompt,
  promptList,
  randomUUID,
  updateRefMatRecord: refMaterialRepository.updateRefMatRecord,
});
const {
  createRefMaterialInteractive,
  updateRefMaterialInteractive,
} = refMaterialService;
const {
  createRefMatRecord,
  deleteRefMatRecord,
  getRefMat,
  listRefMaterialsForSync,
  listRefMats,
  updateRefMatRecord,
} = refMaterialRepository;

let habitService;
const habitRepository = createHabitRepository({
  HABIT_STATUS_PLANNED,
  cleanupDailyNotesIfEligible,
  clearSyncState,
  collectDateLinkTargets,
  getIsoNow,
  getTagDisplayNames,
  getTagDisplayNamesMap,
  normalizeHabitStatus,
  normalizeHabitTagNames,
  sanitizeHabitText: (...args) => habitService.sanitizeHabitText(...args),
  syncNoteObjectLinks,
  syncObjectTags,
  withTransaction,
});
habitService = createHabitService({
  MAX_HABIT_TEXT_LENGTH,
  createHabitRecord: habitRepository.createHabitRecord,
  getHabit: habitRepository.getHabit,
  getIsoNow,
  localDateString,
  prompt,
  promptList,
  randomUUID,
  updateHabitRecord: habitRepository.updateHabitRecord,
});
const {
  createHabitInteractive,
  updateHabitInteractive,
} = habitService;
const {
  createHabitRecord,
  deleteHabitRecord,
  getHabit,
  listHabits,
  listHabitsForSync,
  updateHabitRecord,
} = habitRepository;

const tagRepository = createTagRepository({
  getIsoNow,
  normalize,
  randomUUID,
  withTransaction,
});
const tagService = createTagService({
  createTagRecord: tagRepository.createTagRecord,
  getTag: tagRepository.getTag,
  prompt,
  updateTagRecord: tagRepository.updateTagRecord,
});
const {
  updateTagInteractive,
} = tagService;
const {
  createTagRecord,
  deleteTagRecord,
  getTag,
  listTags,
} = tagRepository;

// ── Author catalog functions (DEC-29) ───────────────────────────────────────
function listAuthors(db) {
  return db.prepare(`
    SELECT a.name,
           COUNT(r.id) AS usage_count
    FROM authors a
    LEFT JOIN ref_materials r ON trim(r.author) = a.name
    GROUP BY a.name
    ORDER BY a.name COLLATE NOCASE
  `).all();
}

function createAuthor(db, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Author name cannot be empty');
  db.prepare('INSERT OR IGNORE INTO authors (name) VALUES (?)').run(trimmed);
  return { name: trimmed };
}

function deleteAuthor(db, name) {
  const trimmed = String(name ?? '').trim();
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM ref_materials WHERE trim(COALESCE(author, '')) = ?
  `).get(trimmed);
  if (row && row.cnt > 0) {
    throw new Error(`Cannot delete author "${trimmed}": still referenced by ${row.cnt} ref-material(s).`);
  }
  const result = db.prepare('DELETE FROM authors WHERE name = ?').run(trimmed);
  return result.changes > 0;
}
// ─────────────────────────────────────────────────────────────────────────────

const linkRepository = createLinkRepository();
const linkService = createLinkService({
  createLinkRecord: linkRepository.createLinkRecord,
  getIsoNow,
  prompt,
  randomUUID,
  resolveType: (...args) => resolveType(...args),
});
const { createLinkInteractive } = linkService;
const {
  deleteLinkRecord,
  getLinks,
} = linkRepository;

function listObjects(type) {
  return withDb((db) => {
    switch (type) {
      case 'topic-note': return listTopicNotes(db);
      case 'daily-note': return listDailyNotes(db);
      case 'project': return listProjects(db);
      case 'ref-material': return listRefMats(db);
      case 'habit': return listHabits(db);
      case 'scripture': return listScriptures(db);
      case 'tag': return listTags(db);
      case 'link': return getLinks(db);
      default: throw new Error(`Unsupported type: ${type}`);
    }
  });
}

function listMetaBundle() {
  return withDb((db) => {
    const projects = listProjects(db).map((row) => ({ ...row, type: 'project' }));
    const refMaterials = listRefMats(db).map((row) => ({ ...row, type: 'ref-material' }));
    // Bulk fetch all object-link edges in a single query to avoid N+1 per-note gets
    const objectLinks = db
      .prepare('SELECT source_id, target_id FROM object_links')
      .all()
      .map((row) => ({ sourceId: row.source_id, targetId: row.target_id }));
    return {
      syncRootFolder: getSyncRootFolder(),
      topicNotes: listTopicNotes(db),
      dailyNotes: listDailyNotes(db),
      habits: listHabits(db),
      files: [...projects, ...refMaterials],
      scriptures: listScriptures(db),
      tags: listTags(db),
      objectLinks,
    };
  });
}

function getObject(type, reference) {
  return withDb((db) => {
    switch (type) {
      case 'topic-note': return getTopicNote(db, reference);
      case 'daily-note': return getDailyNote(db, reference);
      case 'project': return getProject(db, reference);
      case 'ref-material': return getRefMat(db, reference);
      case 'habit': return getHabit(db, reference);
      case 'scripture': return getScripture(db, reference);
      case 'tag': return getTag(db, reference);
      case 'link': return getLinks(db).find((link) => link.id === reference) ?? null;
      default: throw new Error(`Unsupported type: ${type}`);
    }
  });
}

function resolveType(token) {
  const value = normalize(token).toLowerCase();
  if (!value) return null;
  return objectTypeAliasMap.get(value) ?? null;
}

function formatCompact(value) {
  return JSON.stringify(value, null, 2);
}

function listField(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

function printRecords(type, rows) {
  if (!rows.length) {
    console.log(`No ${type} found.`);
    return;
  }

  for (const row of rows) {
    switch (type) {
      case 'topic-note':
        console.log(`${row.id}\t${row.updatedAt}\t${listField(row.title)}\t${row.syncPath || '(no path)'}\t${row.date || ''}\t${listField(row.preview)}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'daily-note':
        console.log(`${row.id}\t${row.date}\t${listField(row.preview)}\t${row.syncPath || '(no path)'}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'project':
        console.log(`${row.id}\t${listField(row.name)}\t${row.syncPath || '(no path)'}\t${row.startDate || ''}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'ref-material':
        console.log(`${row.id}\t${listField(row.name)}\t${listField(row.author)}\t${row.syncPath || '(no path)'}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
        break;
      case 'scripture':
        console.log(`${row.id}\t${listField(row.reference)}\t${row.passageUrl}\t${row.noteCount ?? 0}`);
        break;
       case 'habit':
         console.log(`${row.id}\t${row.date}\t${row.status}\t${listField(row.text)}\t${row.syncPath || '(no path)'}${row.tags.length ? `\t#${row.tags.join(', #')}` : ''}`);
         break;
       case 'tag':
         console.log(`${row.id}\t${row.displayName}\t${row.objectCount} objects`);
         break;
       case 'link':
         console.log(`${row.id}\t${row.sourceType}:${row.sourceId} -> ${row.targetType}:${row.targetId}`);
         break;
       default:
         console.log(formatCompact(row));
    }
  }
}

function printSection(title, rows, type) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
  printRecords(type, rows);
}

function browseTarget(target, value) {
  const normalizedTarget = normalize(target).toLowerCase();

  if (!normalizedTarget || normalizedTarget === 'all') {
    withDb((db) => {
      printSection('Topic Notes', listTopicNotes(db), 'topic-note');
      printSection('Daily Notes', listDailyNotes(db), 'daily-note');
      printSection('Projects', listProjects(db), 'project');
      printSection('Reference Materials', listRefMats(db), 'ref-material');
      printSection('Habits', listHabits(db), 'habit');
      printSection('Scripture', listScriptures(db), 'scripture');
      printSection('Tags', listTags(db), 'tag');
    });
    return;
  }

  if (normalizedTarget === 'notes') {
    withDb((db) => {
      printSection('Topic Notes', listTopicNotes(db), 'topic-note');
      printSection('Daily Notes', listDailyNotes(db), 'daily-note');
    });
    return;
  }

  if (normalizedTarget === 'directories') {
    withDb((db) => {
      printSection('Projects', listProjects(db), 'project');
      printSection('Reference Materials', listRefMats(db), 'ref-material');
    });
    return;
  }

  if (normalizedTarget === 'files' || normalizedTarget === 'fs') {
    const targetPath = resolve(value || '.');
    if (!existsSync(targetPath)) {
      throw new Error(`Path not found: ${targetPath}`);
    }
    const entries = readdirSync(targetPath, { withFileTypes: true })
      .map((entry) => ({
        kind: entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file',
        name: entry.name,
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    console.log(targetPath);
    if (!entries.length) {
      console.log('(empty directory)');
      return;
    }
    for (const entry of entries) {
      console.log(`${entry.kind}\t${entry.name}`);
    }
    return;
  }

  const type = resolveType(normalizedTarget);
  if (!type) {
    throw new Error(`Unknown browse target: ${target}`);
  }
  printRecords(type, listObjects(type));
}

function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of line) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function readSecretStore() {
  const filePath = secretsFilePath();
  if (!existsSync(filePath)) {
    return { version: 1, values: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const legacyEncrypted = Boolean(parsed?.encrypted);
    const values = {};
    for (const [key, value] of Object.entries(parsed?.values ?? {})) {
      if (typeof value === 'string') {
        values[key] = { payload: value, encrypted: legacyEncrypted };
      } else if (value && typeof value === 'object' && typeof value.payload === 'string') {
        values[key] = { payload: value.payload, encrypted: Boolean(value.encrypted) };
      }
    }
    return { version: 1, values };
  } catch {
    return { version: 1, values: {} };
  }
}

function writeSecretStore(store) {
  const filePath = secretsFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function hasNonEmptyValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function createPromptInterface() {
  return createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY && stdout.isTTY),
    historySize: SHELL_HISTORY_SIZE,
  });
}

function encodeUnencryptedSecret(value) {
  return {
    encrypted: false,
    payload: Buffer.from(value, 'utf8').toString('base64'),
  };
}

function decodeUnencryptedSecret(entry) {
  if (!entry || entry.encrypted) return null;
  try {
    return Buffer.from(entry.payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function getSyncRootFolder() {
  const store = readSecretStore();
  const configured = decodeUnencryptedSecret(store.values[KEYCHAIN_ROOT_FOLDER]);
  const normalized = normalizeSyncRootFolderInput(configured || DEFAULT_NOTES_ROOT);
  return normalized === '/' ? DEFAULT_NOTES_ROOT : (normalized || DEFAULT_NOTES_ROOT);
}

function saveSyncToken(accessToken, email, refreshToken) {
  const store = readSecretStore();
  store.values[KEYCHAIN_ACCESS_TOKEN] = encodeUnencryptedSecret(accessToken);
  if (email) store.values[KEYCHAIN_ACCOUNT_EMAIL] = encodeUnencryptedSecret(email);
  if (refreshToken) store.values[KEYCHAIN_REFRESH_TOKEN] = encodeUnencryptedSecret(refreshToken);
  writeSecretStore(store);
}

function saveSyncRootFolder(rootFolder) {
  const store = readSecretStore();
  store.values[KEYCHAIN_ROOT_FOLDER] = encodeUnencryptedSecret(validateSyncRootFolderInput(rootFolder));
  writeSecretStore(store);
}

function getSettingsState() {
  const store = readSecretStore();
  const configuredRootFolder = decodeUnencryptedSecret(store.values[KEYCHAIN_ROOT_FOLDER]) ?? undefined;
  const effectiveRootFolder = getSyncRootFolder();
  return {
    dbPath: dbFile,
    secretsPath: secretsFilePath(),
    sync: {
      rootFolder: configuredRootFolder,
      effectiveRootFolder,
      resolvedRootFolder: resolveLocalSyncPath(effectiveRootFolder),
    },
  };
}

// ── Note sync: path helpers ───────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
}

/** Convert a Sync folder slug (e.g. "my-project-name") to a display title ("My Project Name"). */
function folderNameToTitle(slug) {
  return (slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Untitled';
}

function dailyNoteSyncPath(rootFolder, date) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${DAILY_NOTES_SUBFOLDER}/${date}.md`;
}

function topicNoteSyncPath(rootFolder, title, id) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  const slug = slugify(title || 'untitled');
  const shortId = id.slice(0, 8);
  return `${root}/${TOPIC_NOTES_SUBFOLDER}/${slug}-${shortId}.md`;
}

function dailyNotesFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${DAILY_NOTES_SUBFOLDER}`;
}

function topicNotesFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${TOPIC_NOTES_SUBFOLDER}`;
}

function projectsFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${PROJECTS_SUBFOLDER}`;
}

function refMaterialsFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${REF_MATERIALS_SUBFOLDER}`;
}

function habitsFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${HABITS_SUBFOLDER}`;
}

function projectDirectoryPath(rootFolder, slug) {
  return `${projectsFolderPath(rootFolder)}/${slug}`;
}

function canonicalProjectSyncPath(rootFolder, name) {
  return projectDirectoryPath(rootFolder, slugify(name || 'untitled'));
}

function projectMetaPath(rootFolder, slug) {
  return `${projectDirectoryPath(rootFolder, slug)}/meta.yaml`;
}

function refMaterialDirectoryPath(rootFolder, slug) {
  return `${refMaterialsFolderPath(rootFolder)}/${slug}`;
}

function canonicalRefMaterialSyncPath(rootFolder, name) {
  return refMaterialDirectoryPath(rootFolder, slugify(name || 'untitled'));
}

function refMaterialMetaPath(rootFolder, slug) {
  return `${refMaterialDirectoryPath(rootFolder, slug)}/meta.yaml`;
}

// DEC-20: Generate habit filename from date, first tag, and last 6 chars of ID
function habitFilename(id, date, tagNames) {
  const shortId = id.slice(-6);
  const firstTag = tagNames && tagNames.length > 0 ? tagNames[0] : '';
  return `${date}-${firstTag}-${shortId}.md`;
}

function habitSyncPath(rootFolder, id, date, tagNames) {
  const filename = habitFilename(id, date, tagNames);
  return `${habitsFolderPath(rootFolder)}/${filename}`;
}

function mobileInboxDailyNotesFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${MOBILE_INBOX_DAILY_NOTES_SUBFOLDER}`;
}

function mobileInboxHabitsFolderPath(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${MOBILE_INBOX_HABITS_SUBFOLDER}`;
}

function allSyncFolderPaths(rootFolder) {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return [
    root,
    dailyNotesFolderPath(rootFolder),
    topicNotesFolderPath(rootFolder),
    projectsFolderPath(rootFolder),
    refMaterialsFolderPath(rootFolder),
    habitsFolderPath(rootFolder),
    mobileInboxDailyNotesFolderPath(rootFolder),
    mobileInboxHabitsFolderPath(rootFolder),
  ].filter((path) => path && path !== '/');
}

// ── Note sync: YAML front matter ──────────────────────────────────────────────

function yamlStringArray(values) {
  if (values.length === 0) return '[]';
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

function serializeMetaYaml(data) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${yamlStringArray(value)}`);
    } else if (value === null || value === undefined || value === '') {
      // Skip empty values
      continue;
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  return lines.join('\n');
}

function serializeFrontMatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${yamlStringArray(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ── Note sync: serialization ──────────────────────────────────────────────────

function serializeNoteBodyForSync(fields, options = {}) {
  const body =
    Array.isArray(fields.blocks) && fields.blocks.length > 0
      ? assembleMarkdownFromBlocks(fields.blocks)
      : (fields.contentMarkdown ?? '');
  const db = options.db ?? null;
  if (!db) return body;
  const resolveHref = createSyncOutgoingLinkResolver(db, fields.syncPath || '', options.rootFolder || DEFAULT_NOTES_ROOT);
  return rewriteMarkdownLinkHrefs(body, resolveHref);
}

function dailyNoteToMarkdown(fields, options = {}) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'daily-note',
    date: fields.date,
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  // DEC-38: Prefer assembling from blocks so block IDs are always embedded in the file body.
  const body = serializeNoteBodyForSync(fields, options);
  return body ? `${fm}\n\n${body}` : `${fm}\n`;
}

function topicNoteToMarkdown(fields, options = {}) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'topic-note',
    title: fields.title,
    date: fields.date || '',
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  // DEC-38: Prefer assembling from blocks so block IDs are always embedded in the file body.
  const body = serializeNoteBodyForSync(fields, options);
  return body ? `${fm}\n\n${body}` : `${fm}\n`;
}

function projectToMetaYaml(fields) {
  return serializeMetaYaml({
    id: fields.id,
    name: fields.name,
    startDate: fields.startDate,
    endDate: fields.endDate,
    tags: fields.tagNames,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
}

function refMaterialToMetaYaml(fields) {
  return serializeMetaYaml({
    id: fields.id,
    name: fields.name,
    author: fields.author,
    tags: fields.tagNames,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
}

function habitToMarkdown(fields) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'habit',
    text: fields.text,
    date: fields.date,
    status: normalizeHabitStatus(fields.status, HABIT_STATUS_PLANNED),
    tags: normalizeHabitTagNames(fields.tagNames),
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  return `${fm}\n`;
}

function parseDailyNoteMarkdown(content) {
  const { data, body } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.date !== 'string' || !data.date) return null;
  // DEC-38: Parse blocks from body so callers have block-aware data without re-parsing.
  const blocks = parseBlocksFromMarkdown(body);
  return {
    id: data.id,
    date: data.date,
    contentMarkdown: body,
    blocks,
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    linkedObjectIds: Array.isArray(data.linkedObjectIds) ? data.linkedObjectIds.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function parseTopicNoteMarkdown(content) {
  const { data, body } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.title !== 'string') return null;
  // DEC-38: Parse blocks from body so callers have block-aware data without re-parsing.
  const blocks = parseBlocksFromMarkdown(body);
  return {
    id: data.id,
    title: data.title,
    date: typeof data.date === 'string' ? data.date : '',
    contentMarkdown: body,
    blocks,
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    linkedObjectIds: Array.isArray(data.linkedObjectIds) ? data.linkedObjectIds.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function parseProjectMetaYaml(content) {
  const { data } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.name !== 'string') return null;
  return {
    id: data.id,
    name: data.name,
    startDate: typeof data.startDate === 'string' ? data.startDate : '',
    endDate: typeof data.endDate === 'string' ? data.endDate : '',
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function parseProjectSyncFolderEntry(content, folder) {
  const parsed = parseProjectMetaYaml(content);
  if (!parsed) return null;
  return {
    ...parsed,
    // DEC-69: folder-backed sync locations come from the scanned folder, not serialized metadata.
    syncPath: folder.path,
    slug: folder.name,
    folderPath: folder.path,
  };
}

function parseRefMaterialMetaYaml(content) {
  const { data } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.name !== 'string') return null;
  return {
    id: data.id,
    name: data.name,
    author: typeof data.author === 'string' ? data.author : '',
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function parseRefMaterialSyncFolderEntry(content, folder) {
  const parsed = parseRefMaterialMetaYaml(content);
  if (!parsed) return null;
  return {
    ...parsed,
    // DEC-69: folder-backed sync locations come from the scanned folder, not serialized metadata.
    syncPath: folder.path,
    slug: folder.name,
    folderPath: folder.path,
  };
}

function parseHabitMarkdown(content) {
  const { data } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.text !== 'string') return null;
  if (typeof data.date !== 'string' || !data.date) return null;
  return {
    id: data.id,
    text: data.text,
    date: data.date,
    status: normalizeHabitStatus(data.status, HABIT_STATUS_ACCOMPLISHED),
    tagNames: normalizeHabitTagNames(Array.isArray(data.tags) ? data.tags.map(String) : []),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function normalizeStringArray(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

// ── Mobile inbox: parsers ─────────────────────────────────────────────────────

/** Parse a mobile-inbox daily note written by the iOS app. Returns null for unrecognized files. */
function parseMobileDailyNoteMarkdown(content) {
  const { data, body } = parseFrontMatter(content);
  if (data.source !== 'mobile') return null;
  if (typeof data.date !== 'string' || !LOCAL_DATE_PATTERN.test(data.date)) return null;
  return {
    date: data.date,
    contentMarkdown: body.trim(),
    writtenAt: typeof data.writtenAt === 'string' ? data.writtenAt : getIsoNow(),
  };
}

/** Parse a mobile-inbox habit written by the iOS app. Returns null for unrecognized files. */
function parseMobileHabitMarkdown(content) {
  const { data } = parseFrontMatter(content);
  if (data.source !== 'mobile') return null;
  if (typeof data.date !== 'string' || !LOCAL_DATE_PATTERN.test(data.date)) return null;
  if (typeof data.text !== 'string' || !data.text.trim()) return null;
  return {
    date: data.date,
    text: data.text.trim().slice(0, MAX_HABIT_TEXT_LENGTH),
    tag: typeof data.tag === 'string' ? data.tag.trim() : '',
    status: normalizeHabitStatus(data.status, HABIT_STATUS_ACCOMPLISHED),
    writtenAt: typeof data.writtenAt === 'string' ? data.writtenAt : getIsoNow(),
  };
}

function sameStringArrayAsSet(left, right) {
  const a = normalizeStringArray(left);
  const b = normalizeStringArray(right);
  if (a.length !== b.length) return false;
  for (let idx = 0; idx < a.length; idx += 1) {
    if (a[idx] !== b[idx]) return false;
  }
  return true;
}

function shouldApplyRemoteDailyNote(existing, remote) {
  if (!existing) return true;
  // Last-write-wins: only apply remote if it's newer than local (DEC-37)
  const remoteUpdatedAt = new Date(remote.updatedAt ?? 0).getTime();
  const localUpdatedAt = new Date(existing.updatedAt ?? 0).getTime();
  if (remoteUpdatedAt > localUpdatedAt) return true;
  if (remoteUpdatedAt < localUpdatedAt) return false;
  // If timestamps are equal, detect actual content changes
  if (remote.contentMarkdown !== existing.contentMarkdown) return true;
  if (JSON.stringify(remote.linkedObjectIds ?? []) !== JSON.stringify(existing.linkedObjectIds ?? [])) return true;
  if (!sameStringArrayAsSet(remote.tagNames, existing.tags)) return true;
  return false;
}

function shouldApplyRemoteTopicNote(existing, remote) {
  if (!existing) return true;
  // Last-write-wins: only apply remote if it's newer than local (DEC-37)
  const remoteUpdatedAt = new Date(remote.updatedAt ?? 0).getTime();
  const localUpdatedAt = new Date(existing.updatedAt ?? 0).getTime();
  if (remoteUpdatedAt > localUpdatedAt) return true;
  if (remoteUpdatedAt < localUpdatedAt) return false;
  // If timestamps are equal, detect actual content changes
  if ((remote.title ?? '') !== (existing.title ?? '')) return true;
  if ((remote.date ?? '') !== (existing.date ?? '')) return true;
  if (remote.contentMarkdown !== existing.contentMarkdown) return true;
  if (JSON.stringify(remote.linkedObjectIds ?? []) !== JSON.stringify(existing.linkedObjectIds ?? [])) return true;
  if (!sameStringArrayAsSet(remote.tagNames, existing.tags)) return true;
  return false;
}

function shouldApplyRemoteProject(existing, remote) {
  if (!existing) return true;
  const remoteUpdatedAt = new Date(remote.updatedAt ?? 0).getTime();
  const localUpdatedAt = new Date(existing.updatedAt ?? 0).getTime();
  if (remoteUpdatedAt > localUpdatedAt) return true;
  if (remoteUpdatedAt < localUpdatedAt) return false;
  if ((remote.name ?? '') !== (existing.name ?? '')) return true;
  if ((remote.syncPath ?? '') !== (existing.syncPath ?? '')) return true;
  if ((remote.startDate ?? '') !== (existing.startDate ?? '')) return true;
  if ((remote.endDate ?? '') !== (existing.endDate ?? '')) return true;
  const effectiveRemoteTags = mergeRemoteTagsPreservingImportedInbox(existing.tags, remote.tagNames);
  if (!sameStringArrayAsSet(effectiveRemoteTags, existing.tags)) return true;
  return false;
}

function shouldApplyRemoteRefMaterial(existing, remote) {
  if (!existing) return true;
  const remoteUpdatedAt = new Date(remote.updatedAt ?? 0).getTime();
  const localUpdatedAt = new Date(existing.updatedAt ?? 0).getTime();
  if (remoteUpdatedAt > localUpdatedAt) return true;
  if (remoteUpdatedAt < localUpdatedAt) return false;
  if ((remote.name ?? '') !== (existing.name ?? '')) return true;
  if ((remote.author ?? '') !== (existing.author ?? '')) return true;
  if ((remote.syncPath ?? '') !== (existing.syncPath ?? '')) return true;
  const effectiveRemoteTags = mergeRemoteTagsPreservingImportedInbox(existing.tags, remote.tagNames);
  if (!sameStringArrayAsSet(effectiveRemoteTags, existing.tags)) return true;
  return false;
}

function shouldApplyRemoteHabit(existing, remote) {
  if (!existing) return true;
  const remoteUpdatedAt = new Date(remote.updatedAt ?? 0).getTime();
  const localUpdatedAt = new Date(existing.updatedAt ?? 0).getTime();
  if (remoteUpdatedAt > localUpdatedAt) return true;
  if (remoteUpdatedAt < localUpdatedAt) return false;
  if ((remote.text ?? '') !== (existing.text ?? '')) return true;
  if ((remote.date ?? '') !== (existing.date ?? '')) return true;
  if (normalizeHabitStatus(remote.status, HABIT_STATUS_ACCOMPLISHED) !== normalizeHabitStatus(existing.status, HABIT_STATUS_PLANNED)) return true;
  if (!sameStringArrayAsSet(remote.tagNames, existing.tags)) return true;
  return false;
}

// ── Local sync transport helpers ──────────────────────────────────────────────

async function syncUploadText(path, content) {
  const filePath = resolveLocalSyncPath(path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

async function syncDownloadText(path) {
  const filePath = resolveLocalSyncPath(path);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

function stripLegacySyncPathMetadata(content) {
  const raw = String(content ?? '');
  if (!raw) return { content: raw, changed: false };

  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = /\r?\n$/.test(raw);
  const lines = raw.split(/\r?\n/);
  const legacyFieldPattern = /^\s*(syncPath|sync_path|dropboxPath|dropbox_path)\s*:/;

  let changed = false;
  let filtered;
  if (lines[0]?.trim() === '---') {
    let frontMatterClosed = false;
    filtered = lines.filter((line, index) => {
      if (index === 0) return true;
      if (!frontMatterClosed && line.trim() === '---') {
        frontMatterClosed = true;
        return true;
      }
      if (!frontMatterClosed && legacyFieldPattern.test(line)) {
        changed = true;
        return false;
      }
      return true;
    });
  } else {
    filtered = lines.filter((line) => {
      if (legacyFieldPattern.test(line)) {
        changed = true;
        return false;
      }
      return true;
    });
  }

  const next = filtered.join(newline);
  return {
    content: hadTrailingNewline ? `${next}${newline}` : next,
    changed,
  };
}

async function scrubLegacySyncPathMetadataFromSyncFiles(rootFolder) {
  const targets = [];

  for (const folderPath of [dailyNotesFolderPath(rootFolder), topicNotesFolderPath(rootFolder), habitsFolderPath(rootFolder)]) {
    const { files } = await listSyncMdFiles(folderPath);
    for (const file of files) {
      targets.push(file.path);
    }
  }

  for (const folderPath of [projectsFolderPath(rootFolder), refMaterialsFolderPath(rootFolder)]) {
    const { folders } = await listSyncFolders(folderPath);
    for (const folder of folders) {
      targets.push(`${folder.path}/meta.yaml`);
    }
  }

  const result = { rewritten: 0, errors: [] };
  for (const targetPath of targets) {
    try {
      const content = await syncDownloadText(targetPath);
      if (content === null) continue;
      const stripped = stripLegacySyncPathMetadata(content);
      if (!stripped.changed) continue;
      await syncUploadText(targetPath, stripped.content);
      result.rewritten++;
    } catch (error) {
      result.errors.push(`${targetPath}: ${String(error)}`);
    }
  }

  return result;
}

async function ensureSyncFolder(path) {
  mkdirSync(resolveLocalSyncPath(path), { recursive: true });
}

async function moveSyncFolder(fromPath, toPath) {
  const source = resolveLocalSyncPath(fromPath);
  const target = resolveLocalSyncPath(toPath);
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(source)) return;
  renameSync(source, target);
}

async function deleteSyncPath(path) {
  const target = resolveLocalSyncPath(path);
  rmSync(target, { recursive: true, force: true });
}

async function ensureSyncFolders(rootFolder) {
  for (const folderPath of allSyncFolderPaths(rootFolder)) {
    await ensureSyncFolder(folderPath);
  }
}

async function listSyncMdFiles(folderPath) {
  const localFolder = resolveLocalSyncPath(folderPath);
  if (!existsSync(localFolder)) {
    return { files: [], folderFound: false };
  }
  const entries = readdirSync(localFolder, { withFileTypes: true });
  return {
    folderFound: true,
    files: entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => ({
        name: e.name,
        path: `${folderPath.replace(/\/$/, '')}/${e.name}`,
        serverModified: statSync(join(localFolder, e.name)).mtime.toISOString(),
        contentHash: '',
      })),
  };
}

async function listSyncFolders(folderPath) {
  const localFolder = resolveLocalSyncPath(folderPath);
  if (!existsSync(localFolder)) {
    return { folders: [], folderFound: false };
  }
  const entries = readdirSync(localFolder, { withFileTypes: true });
  return {
    folderFound: true,
    folders: entries
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        path: `${folderPath.replace(/\/$/, '')}/${e.name}`,
      })),
  };
}

// ── Sync: reconcile helpers ───────────────────────────────────────────────────

async function fetchAllDailyNotesFromSyncFolder(token, rootFolder) {
  const { files, folderFound } = await listSyncMdFiles(dailyNotesFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await syncDownloadText(f.path);
      if (!content) return null;
      const parsed = parseDailyNoteMarkdown(content);
      if (!parsed) return null;
      return {
        ...parsed,
        syncPath: f.path,
        serverModified: f.serverModified,
        contentHash: f.contentHash,
      };
    }),
  );
  return {
    folderFound,
    notes: settled
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value),
  };
}

async function fetchAllTopicNotesFromSyncFolder(token, rootFolder) {
  const { files, folderFound } = await listSyncMdFiles(topicNotesFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await syncDownloadText(f.path);
      if (!content) return null;
      const parsed = parseTopicNoteMarkdown(content);
      if (!parsed) return null;
      return {
        ...parsed,
        syncPath: f.path,
        serverModified: f.serverModified,
        contentHash: f.contentHash,
      };
    }),
  );
  return {
    folderFound,
    notes: settled
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value),
  };
}

async function fetchAllProjectsFromSyncFolder(token, rootFolder) {
  const { folders, folderFound } = await listSyncFolders(projectsFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    folders.map(async (folder) => {
      const metaPath = `${folder.path}/meta.yaml`;
      const content = await syncDownloadText(metaPath);
      if (!content) return { _stub: true, slug: folder.name, folderPath: folder.path };
      const parsed = parseProjectSyncFolderEntry(content, folder);
      if (!parsed) return { _stub: true, slug: folder.name, folderPath: folder.path };
      return {
        ...parsed,
        serverModified: new Date().toISOString(),
      };
    }),
  );
  const all = settled
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
  return {
    folderFound,
    items: all.filter((r) => !r._stub),
    stubs: all.filter((r) => r._stub),
  };
}

async function fetchAllRefMaterialsFromSyncFolder(token, rootFolder) {
  const { folders, folderFound } = await listSyncFolders(refMaterialsFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    folders.map(async (folder) => {
      const metaPath = `${folder.path}/meta.yaml`;
      const content = await syncDownloadText(metaPath);
      if (!content) return { _stub: true, slug: folder.name, folderPath: folder.path };
      const parsed = parseRefMaterialSyncFolderEntry(content, folder);
      if (!parsed) return { _stub: true, slug: folder.name, folderPath: folder.path };
      return {
        ...parsed,
        serverModified: new Date().toISOString(),
      };
    }),
  );
  const all = settled
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
  return {
    folderFound,
    items: all.filter((r) => !r._stub),
    stubs: all.filter((r) => r._stub),
  };
}

async function fetchAllHabitsFromSyncFolder(token, rootFolder) {
  const { files, folderFound } = await listSyncMdFiles(habitsFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await syncDownloadText(f.path);
      if (!content) return null;
      const parsed = parseHabitMarkdown(content);
      if (!parsed) return null;
      return {
        ...parsed,
        syncPath: f.path,
        serverModified: f.serverModified,
      };
    }),
  );
  return {
    folderFound,
    items: settled
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value),
  };
}

async function reconcileDailyNotesDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, deleted: 0, warnings: [], errors: [] };

  const { notes: syncNotes, folderFound } = await fetchAllDailyNotesFromSyncFolder(token, rootFolder);
  const syncByDate = new Map(syncNotes.map((n) => [n.date, n]));

   for (const fields of syncNotes) {
     try {
       const existing = getDailyNote(db, fields.date);
       if (!existing) {
         createDailyNoteRecord(db, {
           id: fields.id,
           date: fields.date,
           content: {},
           contentMarkdown: fields.contentMarkdown,
           linkedObjectIds: fields.linkedObjectIds,
           syncPath: fields.syncPath || dailyNoteSyncPath(rootFolder, fields.date),
           tags: addInboxTag(fields.tagNames),
           createdAt: fields.createdAt,
           updatedAt: fields.updatedAt,
         });
         result.imported++;
       } else if (shouldApplyRemoteDailyNote(existing, fields)) {
         updateDailyNoteRecord(db, existing.id, {
           contentMarkdown: fields.contentMarkdown,
           linkedObjectIds: fields.linkedObjectIds,
           syncPath: fields.syncPath || dailyNoteSyncPath(rootFolder, existing.date),
           tags: fields.tagNames,
           updatedAt: fields.updatedAt,
         });
         result.updated++;
       }
       markRemotePresence(db, 'daily-note', fields.id, fields.serverModified ?? fields.updatedAt ?? getIsoNow());
     } catch (e) {
       result.errors.push(`daily-note ${fields.date}: ${String(e)}`);
     }
   }

   const localNotes = listDailyNotesForSync(db);
   if (!folderFound) {
      await ensureSyncFolder(dailyNotesFolderPath(rootFolder));
     if (localNotes.length > 0) {
        result.warnings.push('Sync daily-notes folder was missing and has been created; skipped remote-deletion reconciliation for local daily notes.');
     }
     return result;
   }

   for (const note of localNotes) {
     if (!syncByDate.has(note.date)) {
       try {
         if (hasKnownRemoteCopy(db, 'daily-note', note.id)) {
           if (deleteDailyNoteRecord(db, note.id)) {
             result.deleted++;
           }
         } else {
           await ensureSyncFolder(dailyNotesFolderPath(rootFolder));
           await syncUploadText(dailyNoteSyncPath(rootFolder, note.date), dailyNoteToMarkdown(note, { db, rootFolder }));
           markRemotePresence(db, 'daily-note', note.id, getIsoNow());
           result.uploaded++;
         }
       } catch (e) {
         result.errors.push(`daily-note reconcile ${note.date}: ${String(e)}`);
       }
     } else {
       // Note exists in both local and Sync; upload if local is newer (DEC-37)
       const remoteNote = syncByDate.get(note.date);
       if (remoteNote) {
         const remoteTime = new Date(remoteNote.updatedAt ?? 0).getTime();
         const localTime = new Date(note.updatedAt ?? 0).getTime();
         if (localTime > remoteTime) {
           try {
             await syncUploadText(dailyNoteSyncPath(rootFolder, note.date), dailyNoteToMarkdown(note, { db, rootFolder }));
             result.uploaded++;
           } catch (e) {
             result.errors.push(`daily-note upload ${note.date}: ${String(e)}`);
           }
         }
       }
     }
   }

   return result;
}

async function reconcileTopicNotesDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, deleted: 0, warnings: [], errors: [] };

  const { notes: syncNotes, folderFound } = await fetchAllTopicNotesFromSyncFolder(token, rootFolder);
  const syncById = new Map(syncNotes.map((n) => [n.id, n]));

   for (const fields of syncNotes) {
     try {
       const existing = getTopicNote(db, fields.id);
       if (!existing) {
         createTopicNoteRecord(db, {
           id: fields.id,
           title: fields.title,
           date: fields.date || '',
           content: {},
           contentMarkdown: fields.contentMarkdown,
           linkedObjectIds: fields.linkedObjectIds,
           syncPath: fields.syncPath || topicNoteSyncPath(rootFolder, fields.title, fields.id),
           tags: addInboxTag(fields.tagNames),
           createdAt: fields.createdAt,
           updatedAt: fields.updatedAt,
         });
         result.imported++;
       } else if (shouldApplyRemoteTopicNote(existing, fields)) {
         updateTopicNoteRecord(db, existing.id, {
           title: fields.title,
           date: fields.date || '',
           contentMarkdown: fields.contentMarkdown,
           linkedObjectIds: fields.linkedObjectIds,
           syncPath: fields.syncPath || topicNoteSyncPath(rootFolder, fields.title, fields.id),
           tags: fields.tagNames,
           updatedAt: fields.updatedAt,
         });
         result.updated++;
       }
       markRemotePresence(db, 'topic-note', fields.id, fields.serverModified ?? fields.updatedAt ?? getIsoNow());
     } catch (e) {
       result.errors.push(`topic-note ${fields.id}: ${String(e)}`);
     }
   }

   const localNotes = listTopicNotesForSync(db);
   if (!folderFound) {
      await ensureSyncFolder(topicNotesFolderPath(rootFolder));
     if (localNotes.length > 0) {
        result.warnings.push('Sync topic-notes folder was missing and has been created; skipped remote-deletion reconciliation for local topic notes.');
     }
     return result;
   }

   for (const note of localNotes) {
     if (!syncById.has(note.id)) {
       try {
         if (hasKnownRemoteCopy(db, 'topic-note', note.id)) {
           if (deleteTopicNoteRecord(db, note.id)) {
             result.deleted++;
           }
         } else {
           await ensureSyncFolder(topicNotesFolderPath(rootFolder));
           await syncUploadText(topicNoteSyncPath(rootFolder, note.title, note.id), topicNoteToMarkdown(note, { db, rootFolder }));
           markRemotePresence(db, 'topic-note', note.id, getIsoNow());
           result.uploaded++;
         }
       } catch (e) {
         result.errors.push(`topic-note reconcile ${note.id}: ${String(e)}`);
       }
     } else {
       // Note exists in both local and Sync; upload if local is newer (DEC-37)
       const remoteNote = syncById.get(note.id);
       if (remoteNote) {
         const remoteTime = new Date(remoteNote.updatedAt ?? 0).getTime();
         const localTime = new Date(note.updatedAt ?? 0).getTime();
         if (localTime > remoteTime) {
           try {
             await syncUploadText(topicNoteSyncPath(rootFolder, note.title, note.id), topicNoteToMarkdown(note, { db, rootFolder }));
             result.uploaded++;
           } catch (e) {
             result.errors.push(`topic-note upload ${note.id}: ${String(e)}`);
           }
         }
       }
     }
   }

   return result;
}

async function reconcileProjectsDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, deleted: 0, warnings: [], errors: [] };

  const { items: syncItems, stubs, folderFound } = await fetchAllProjectsFromSyncFolder(token, rootFolder);
  const syncById = new Map(syncItems.map((item) => [item.id, item]));

  for (const fields of syncItems) {
    try {
      const existing = getProject(db, fields.id);
      if (!existing) {
        createProjectRecord(db, {
          id: fields.id,
          name: fields.name,
          syncPath: fields.syncPath,
          startDate: fields.startDate,
          endDate: fields.endDate,
          tags: addInboxTag(fields.tagNames),
          createdAt: fields.createdAt,
          updatedAt: fields.updatedAt,
        });
        result.imported++;
      } else if (shouldApplyRemoteProject(existing, fields)) {
        updateProjectRecord(db, existing.id, {
          name: fields.name,
          syncPath: fields.syncPath,
          startDate: fields.startDate,
          endDate: fields.endDate,
          tags: mergeRemoteTagsPreservingImportedInbox(existing.tags, fields.tagNames),
          updatedAt: fields.updatedAt,
        });
        result.updated++;
      }
      markRemotePresence(db, 'project', fields.id, fields.serverModified ?? fields.updatedAt ?? getIsoNow());
    } catch (e) {
      result.errors.push(`project ${fields.id}: ${String(e)}`);
    }
  }

  // Auto-create records for Sync folders that have no meta.yaml yet
  for (const stub of stubs) {
    try {
      // Avoid duplicates: skip if a project already tracks this folder path
      const existing = db.prepare('SELECT id FROM projects WHERE sync_path = ?').get(stub.folderPath);
      if (existing) {
        // Make sure the existing project is in syncById so it isn't deleted
        if (!syncById.has(existing.id)) {
          syncById.set(existing.id, { id: existing.id });
        }
        continue;
      }
      const now = getIsoNow();
      const newProject = createProjectRecord(db, {
        id: randomUUID(),
        name: folderNameToTitle(stub.slug),
        syncPath: stub.folderPath,
        startDate: null,
        endDate: null,
        tags: [INBOX_TAG_NAME],
        createdAt: now,
        updatedAt: now,
      });
      // Upload a meta.yaml so future syncs recognise this record by ID
      await syncUploadText(projectMetaPath(rootFolder, stub.slug), projectToMetaYaml({
        id: newProject.id,
        name: newProject.name,
        syncPath: newProject.syncPath,
        startDate: newProject.startDate,
        endDate: newProject.endDate,
        tagNames: [],
        createdAt: newProject.createdAt,
        updatedAt: newProject.updatedAt,
      }));
      markRemotePresence(db, 'project', newProject.id, getIsoNow());
      // Add to syncById so the local-cleanup loop below won't see it as "deleted remotely"
      syncById.set(newProject.id, { id: newProject.id, name: newProject.name, slug: stub.slug, updatedAt: now });
      result.imported++;
    } catch (e) {
      result.errors.push(`project stub ${stub.slug}: ${String(e)}`);
    }
  }

  const localItems = listProjectsForSync(db);
  if (!folderFound) {
    await ensureSyncFolder(projectsFolderPath(rootFolder));
    if (localItems.length > 0) {
      result.warnings.push('Sync projects folder was missing and has been created; skipped remote-deletion reconciliation for local projects.');
    }
    return result;
  }

  for (const item of localItems) {
    if (!syncById.has(item.id)) {
      try {
        if (hasKnownRemoteCopy(db, 'project', item.id)) {
          if (deleteProjectRecord(db, item.id)) {
            result.deleted++;
          }
        } else {
          const slug = slugify(item.name);
          const syncPath = canonicalProjectSyncPath(rootFolder, item.name);
          await ensureSyncFolder(projectDirectoryPath(rootFolder, slug));
          await syncUploadText(projectMetaPath(rootFolder, slug), projectToMetaYaml({ ...item, syncPath }));
          if (item.syncPath !== syncPath) {
            updateProjectRecord(db, item.id, { syncPath, updatedAt: item.updatedAt });
          }
          markRemotePresence(db, 'project', item.id, getIsoNow());
          result.uploaded++;
        }
      } catch (e) {
        result.errors.push(`project reconcile ${item.id}: ${String(e)}`);
      }
    } else {
      const remoteItem = syncById.get(item.id);
      if (remoteItem) {
        const remoteTime = new Date(remoteItem.updatedAt ?? 0).getTime();
        const localTime = new Date(item.updatedAt ?? 0).getTime();
        if (localTime > remoteTime) {
          try {
            const newSlug = slugify(item.name);
            const remoteSlug = remoteItem.slug;
            const newSyncPath = projectDirectoryPath(rootFolder, newSlug);
            if (newSlug !== remoteSlug) {
              // Name changed; rename directory by moving to new slug
              await moveSyncFolder(projectDirectoryPath(rootFolder, remoteSlug), newSyncPath);
            }
            await syncUploadText(projectMetaPath(rootFolder, newSlug), projectToMetaYaml({ ...item, syncPath: newSyncPath }));
            if (item.syncPath !== newSyncPath) {
              updateProjectRecord(db, item.id, { syncPath: newSyncPath, updatedAt: item.updatedAt });
            }
            result.uploaded++;
          } catch (e) {
            result.errors.push(`project upload ${item.id}: ${String(e)}`);
          }
        }
      }
    }
  }

  return result;
}

async function reconcileRefMaterialsDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, deleted: 0, warnings: [], errors: [] };

  const { items: syncItems, stubs, folderFound } = await fetchAllRefMaterialsFromSyncFolder(token, rootFolder);
  const syncById = new Map(syncItems.map((item) => [item.id, item]));

  for (const fields of syncItems) {
    try {
      const existing = getRefMat(db, fields.id);
      if (!existing) {
        createRefMatRecord(db, {
          id: fields.id,
          name: fields.name,
          author: fields.author,
          syncPath: fields.syncPath,
          tags: addInboxTag(fields.tagNames),
          createdAt: fields.createdAt,
          updatedAt: fields.updatedAt,
        });
        result.imported++;
      } else if (shouldApplyRemoteRefMaterial(existing, fields)) {
        updateRefMatRecord(db, existing.id, {
          name: fields.name,
          author: fields.author,
          syncPath: fields.syncPath,
          tags: mergeRemoteTagsPreservingImportedInbox(existing.tags, fields.tagNames),
          updatedAt: fields.updatedAt,
        });
        result.updated++;
      }
      markRemotePresence(db, 'ref-material', fields.id, fields.serverModified ?? fields.updatedAt ?? getIsoNow());
    } catch (e) {
      result.errors.push(`ref-material ${fields.id}: ${String(e)}`);
    }
  }

  // Auto-create records for Sync folders that have no meta.yaml yet
  for (const stub of stubs) {
    try {
      const existing = db.prepare('SELECT id FROM ref_materials WHERE sync_path = ?').get(stub.folderPath);
      if (existing) {
        if (!syncById.has(existing.id)) {
          syncById.set(existing.id, { id: existing.id });
        }
        continue;
      }
      const now = getIsoNow();
      const newRefMat = createRefMatRecord(db, {
        id: randomUUID(),
        name: folderNameToTitle(stub.slug),
        author: '',
        syncPath: stub.folderPath,
        tags: [INBOX_TAG_NAME],
        createdAt: now,
        updatedAt: now,
      });
      await syncUploadText(refMaterialMetaPath(rootFolder, stub.slug), refMaterialToMetaYaml({
        id: newRefMat.id,
        name: newRefMat.name,
        author: newRefMat.author,
        syncPath: newRefMat.syncPath,
        tagNames: [],
        createdAt: newRefMat.createdAt,
        updatedAt: newRefMat.updatedAt,
      }));
      markRemotePresence(db, 'ref-material', newRefMat.id, getIsoNow());
      // Add to syncById so the local-cleanup loop below won't see it as "deleted remotely"
      syncById.set(newRefMat.id, { id: newRefMat.id, name: newRefMat.name, slug: stub.slug, updatedAt: now });
      result.imported++;
    } catch (e) {
      result.errors.push(`ref-material stub ${stub.slug}: ${String(e)}`);
    }
  }

  const localItems = listRefMaterialsForSync(db);
  if (!folderFound) {
    await ensureSyncFolder(refMaterialsFolderPath(rootFolder));
    if (localItems.length > 0) {
      result.warnings.push('Sync ref-materials folder was missing and has been created; skipped remote-deletion reconciliation for local reference materials.');
    }
    return result;
  }

  for (const item of localItems) {
    if (!syncById.has(item.id)) {
      try {
        if (hasKnownRemoteCopy(db, 'ref-material', item.id)) {
          if (deleteRefMatRecord(db, item.id)) {
            result.deleted++;
          }
        } else {
          const slug = slugify(item.name);
          const syncPath = canonicalRefMaterialSyncPath(rootFolder, item.name);
          await ensureSyncFolder(refMaterialDirectoryPath(rootFolder, slug));
          await syncUploadText(refMaterialMetaPath(rootFolder, slug), refMaterialToMetaYaml({ ...item, syncPath }));
          if (item.syncPath !== syncPath) {
            updateRefMatRecord(db, item.id, { syncPath, updatedAt: item.updatedAt });
          }
          markRemotePresence(db, 'ref-material', item.id, getIsoNow());
          result.uploaded++;
        }
      } catch (e) {
        result.errors.push(`ref-material reconcile ${item.id}: ${String(e)}`);
      }
    } else {
      const remoteItem = syncById.get(item.id);
      if (remoteItem) {
        const remoteTime = new Date(remoteItem.updatedAt ?? 0).getTime();
        const localTime = new Date(item.updatedAt ?? 0).getTime();
        if (localTime > remoteTime) {
          try {
            const newSlug = slugify(item.name);
            const remoteSlug = remoteItem.slug;
            const newSyncPath = refMaterialDirectoryPath(rootFolder, newSlug);
            if (newSlug !== remoteSlug) {
              // Name changed; rename directory by moving to new slug
              await moveSyncFolder(refMaterialDirectoryPath(rootFolder, remoteSlug), newSyncPath);
            }
            await syncUploadText(refMaterialMetaPath(rootFolder, newSlug), refMaterialToMetaYaml({ ...item, syncPath: newSyncPath }));
            if (item.syncPath !== newSyncPath) {
              updateRefMatRecord(db, item.id, { syncPath: newSyncPath, updatedAt: item.updatedAt });
            }
            result.uploaded++;
          } catch (e) {
            result.errors.push(`ref-material upload ${item.id}: ${String(e)}`);
          }
        }
      }
    }
  }

  return result;
}

async function reconcileHabitsDb(db, token, rootFolder) {
  const result = { imported: 0, updated: 0, uploaded: 0, deleted: 0, warnings: [], errors: [] };

  const { items: syncItems, folderFound } = await fetchAllHabitsFromSyncFolder(token, rootFolder);
  const syncById = new Map(syncItems.map((item) => [item.id, item]));

   for (const fields of syncItems) {
     try {
       const existing = getHabit(db, fields.id);
        if (!existing) {
          createHabitRecord(db, {
            id: fields.id,
            text: fields.text,
            date: fields.date,
            status: fields.status,
            syncPath: fields.syncPath || habitSyncPath(rootFolder, fields.id, fields.date, fields.tagNames),
            tags: addInboxTagForHabit(fields.tagNames),
            createdAt: fields.createdAt,
            updatedAt: fields.updatedAt,
         });
         result.imported++;
        } else if (shouldApplyRemoteHabit(existing, fields)) {
          updateHabitRecord(db, existing.id, {
            text: fields.text,
            date: fields.date,
            status: fields.status,
            syncPath: fields.syncPath || habitSyncPath(rootFolder, fields.id, fields.date, fields.tagNames),
            tags: fields.tagNames,
            updatedAt: fields.updatedAt,
          });
         result.updated++;
       }
       markRemotePresence(db, 'habit', fields.id, fields.serverModified ?? fields.updatedAt ?? getIsoNow());
     } catch (e) {
       result.errors.push(`habit ${fields.id}: ${String(e)}`);
     }
   }

  const localItems = listHabitsForSync(db);
  if (!folderFound) {
    await ensureSyncFolder(habitsFolderPath(rootFolder));
    if (localItems.length > 0) {
      result.warnings.push('Sync habits folder was missing and has been created; skipped remote-deletion reconciliation for local habits.');
    }
    return result;
  }

   for (const item of localItems) {
     if (!syncById.has(item.id)) {
       try {
         if (hasKnownRemoteCopy(db, 'habit', item.id)) {
           if (deleteHabitRecord(db, item.id)) {
             result.deleted++;
           }
         } else {
           await syncUploadText(habitSyncPath(rootFolder, item.id, item.date, item.tagNames), habitToMarkdown(item));
           markRemotePresence(db, 'habit', item.id, getIsoNow());
           result.uploaded++;
         }
       } catch (e) {
         result.errors.push(`habit reconcile ${item.id}: ${String(e)}`);
       }
     } else {
       const remoteItem = syncById.get(item.id);
       if (remoteItem) {
         const remoteTime = new Date(remoteItem.updatedAt ?? 0).getTime();
         const localTime = new Date(item.updatedAt ?? 0).getTime();
         if (localTime > remoteTime) {
           try {
             await syncUploadText(habitSyncPath(rootFolder, item.id, item.date, item.tagNames), habitToMarkdown(item));
             result.uploaded++;
           } catch (e) {
             result.errors.push(`habit upload ${item.id}: ${String(e)}`);
           }
         }
       }
     }
   }

  return result;
}

// ── Mobile inbox reconciliation (DEC-55) ──────────────────────────────────────

/**
 * Process daily notes written by the iOS mobile app from the mobile-inbox folder.
 * If a daily note for the same date already exists locally, the mobile content is
 * appended below a section divider (append semantics per the mobile feature spec).
 * If no daily note exists for that date, a new one is created.
 * Mobile inbox files are deleted from the sync folder after successful processing.
 */
async function reconcileMobileInboxDailyNotes(db, rootFolder) {
  const result = { imported: 0, appended: 0, errors: [] };
  const { files, folderFound } = await listSyncMdFiles(mobileInboxDailyNotesFolderPath(rootFolder));
  if (!folderFound || files.length === 0) return result;

  for (const file of files) {
    try {
      const content = await syncDownloadText(file.path);
      if (!content) continue;
      const parsed = parseMobileDailyNoteMarkdown(content);
      if (!parsed) continue;
      if (!parsed.contentMarkdown) continue;

      const existing = getDailyNote(db, parsed.date);
      if (existing) {
        // Append mobile content below a divider to preserve desktop content (DEC-55).
        const existingMarkdown = existing.contentMarkdown ?? '';
        const separator = existingMarkdown.trim() ? '\n\n---\n\n' : '';
        const mobileSection = `*Written from mobile at ${parsed.writtenAt}*\n\n${parsed.contentMarkdown}`;
        const merged = `${existingMarkdown.trimEnd()}${separator}${mobileSection}`;
        updateDailyNoteRecord(db, existing.id, { contentMarkdown: merged });
        // Re-upload the merged note so the sync folder reflects the appended content.
        const updated = getDailyNote(db, parsed.date);
        if (updated) {
          await syncUploadText(dailyNoteSyncPath(rootFolder, parsed.date), dailyNoteToMarkdown(updated, { db, rootFolder }));
        }
        result.appended++;
      } else {
        createDailyNoteRecord(db, {
          id: randomUUID(),
          date: parsed.date,
          content: {},
          contentMarkdown: parsed.contentMarkdown,
          linkedObjectIds: [],
          syncPath: dailyNoteSyncPath(rootFolder, parsed.date),
          tags: [],
          createdAt: parsed.writtenAt,
          updatedAt: parsed.writtenAt,
        });
        result.imported++;
      }

      // Remove the processed mobile inbox file.
      await deleteSyncPath(file.path);
    } catch (e) {
      result.errors.push(`mobile-inbox daily-note ${file.name}: ${String(e)}`);
    }
  }

  return result;
}

/**
 * Process habits written by the iOS mobile app from the mobile-inbox folder.
 * Each file creates a new habit in the local DB. Mobile inbox files are deleted
 * from the sync folder after successful processing.
 */
async function reconcileMobileInboxHabits(db, rootFolder) {
  const result = { imported: 0, errors: [] };
  const { files, folderFound } = await listSyncMdFiles(mobileInboxHabitsFolderPath(rootFolder));
  if (!folderFound || files.length === 0) return result;

  for (const file of files) {
    try {
      const content = await syncDownloadText(file.path);
      if (!content) continue;
      const parsed = parseMobileHabitMarkdown(content);
      if (!parsed) continue;

      const newId = randomUUID();
      const tagNames = parsed.tag ? [parsed.tag] : [];
      createHabitRecord(db, {
        id: newId,
        text: parsed.text,
        date: parsed.date,
        status: parsed.status,
        syncPath: habitSyncPath(rootFolder, newId, parsed.date, tagNames),
        tags: tagNames,
        createdAt: parsed.writtenAt,
        updatedAt: parsed.writtenAt,
      });

      // Remove the processed mobile inbox file.
      await deleteSyncPath(file.path);
      result.imported++;
    } catch (e) {
      result.errors.push(`mobile-inbox habit ${file.name}: ${String(e)}`);
    }
  }

  return result;
}

async function runSync() {
  const token = null;
  const rootFolder = getSyncRootFolder();
  return withDbAsync(async (db) => {
    await ensureSyncFolders(rootFolder);
    const dailyResult = await reconcileDailyNotesDb(db, token, rootFolder);
    const topicResult = await reconcileTopicNotesDb(db, token, rootFolder);
    const projectResult = await reconcileProjectsDb(db, token, rootFolder);
    const refMaterialResult = await reconcileRefMaterialsDb(db, token, rootFolder);
    const habitResult = await reconcileHabitsDb(db, token, rootFolder);
    // DEC-55: Process the mobile inbox sequentially after the main sync so that
    // newly imported desktop notes are already present before appending mobile content.
    const [mobileNoteResult, mobileHabitResult] = await Promise.all([
      reconcileMobileInboxDailyNotes(db, rootFolder),
      reconcileMobileInboxHabits(db, rootFolder),
    ]);
    const metadataCleanupResult = await scrubLegacySyncPathMetadataFromSyncFiles(rootFolder);
    return {
      imported: dailyResult.imported + topicResult.imported + projectResult.imported + refMaterialResult.imported + habitResult.imported + mobileNoteResult.imported + mobileHabitResult.imported,
      updated: dailyResult.updated + topicResult.updated + projectResult.updated + refMaterialResult.updated + habitResult.updated + mobileNoteResult.appended,
      uploaded: dailyResult.uploaded + topicResult.uploaded + projectResult.uploaded + refMaterialResult.uploaded + habitResult.uploaded,
      deleted: dailyResult.deleted + topicResult.deleted + projectResult.deleted + refMaterialResult.deleted + habitResult.deleted,
      warnings: [...dailyResult.warnings, ...topicResult.warnings, ...projectResult.warnings, ...refMaterialResult.warnings, ...habitResult.warnings],
      errors: [...dailyResult.errors, ...topicResult.errors, ...projectResult.errors, ...refMaterialResult.errors, ...habitResult.errors, ...mobileNoteResult.errors, ...mobileHabitResult.errors, ...metadataCleanupResult.errors],
    };
  });
}

function runLegacyLinkMigration(options = {}) {
  const apply = Boolean(options.apply);
  const mode = apply ? 'apply' : 'dry-run';

  return withDb((db) => {
    const refs = listLinkableObjectRefs(db).filter((item) => normalizeSyncPath(item.syncPath));
    const objectExistsCache = new Map();
    const hasExistingObject = (id) => {
      if (!id) return false;
      if (objectExistsCache.has(id)) return objectExistsCache.get(id);
      const exists = Boolean(lookupObjectSummary(db, id, ''));
      objectExistsCache.set(id, exists);
      return exists;
    };

    const notes = [
      ...listTopicNotesForSync(db).map((note) => ({
        noteType: 'topic-note',
        noteId: note.id,
        sourceSyncPath: note.syncPath || '',
        contentMarkdown: note.contentMarkdown ?? '',
      })),
      ...listDailyNotesForSync(db).map((note) => ({
        noteType: 'daily-note',
        noteId: note.id,
        sourceSyncPath: note.syncPath || '',
        contentMarkdown: note.contentMarkdown ?? '',
      })),
    ].sort((a, b) => a.noteType.localeCompare(b.noteType) || a.noteId.localeCompare(b.noteId));

    const report = {
      mode,
      summary: {
        notesScanned: notes.length,
        notesChanged: 0,
        linksProcessed: 0,
        converted: 0,
        skipped: 0,
        unresolved: 0,
      },
      converted: [],
      skipped: [],
      unresolved: [],
    };

    for (const note of notes) {
      const linkRegex = new RegExp(MARKDOWN_LINK_REGEX.source, 'g');
      let noteChanged = false;
      const rewrittenContent = String(note.contentMarkdown ?? '').replace(linkRegex, (full, label, rawHref) => {
        const parsedHref = resolveMarkdownLinkHrefParts(rawHref);
        if (!parsedHref) return full;
        report.summary.linksProcessed++;
        const originalHref = parsedHref.href;
        const canonical = parseCanonicalInternalHref(originalHref);
        if (canonical && hasExistingObject(canonical.targetId)) {
          report.skipped.push({
            noteType: note.noteType,
            noteId: note.noteId,
            href: originalHref,
            reason: 'already-canonical',
          });
          return full;
        }

        const resolved = resolveLegacyPathHrefToObject(refs, originalHref, note.sourceSyncPath);
        if (resolved.status === 'resolved') {
          const rewrittenHref = resolved.fragment ? `${resolved.target.id}#${resolved.fragment}` : resolved.target.id;
          if (rewrittenHref === originalHref) {
            report.skipped.push({
              noteType: note.noteType,
              noteId: note.noteId,
              href: originalHref,
              reason: 'already-canonical',
            });
            return full;
          }
          noteChanged = true;
          report.converted.push({
            noteType: note.noteType,
            noteId: note.noteId,
            fromHref: originalHref,
            toHref: rewrittenHref,
            targetId: resolved.target.id,
            targetType: resolved.target.type,
          });
          const formattedHref = parsedHref.wrapped ? `<${rewrittenHref}>` : rewrittenHref;
          return `[${label}](${parsedHref.leading}${formattedHref}${parsedHref.trailing})`;
        }

        if (resolved.status === 'ambiguous' || resolved.status === 'unresolved') {
          const canonicalMissingUuid = Boolean(
            canonical
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(canonical.targetId)
            && !hasExistingObject(canonical.targetId),
          );
          report.unresolved.push({
            noteType: note.noteType,
            noteId: note.noteId,
            href: originalHref,
            reason: canonicalMissingUuid ? 'canonical-target-missing' : resolved.reason,
            candidateIds: resolved.candidateIds ?? [],
          });
          return full;
        }

        report.skipped.push({
          noteType: note.noteType,
          noteId: note.noteId,
          href: originalHref,
          reason: resolved.reason ?? 'not-legacy-path',
        });
        return full;
      });

      if (!noteChanged || rewrittenContent === String(note.contentMarkdown ?? '')) {
        continue;
      }

      report.summary.notesChanged++;
      if (!apply) continue;
      if (note.noteType === 'topic-note') {
        updateTopicNoteRecord(db, note.noteId, { contentMarkdown: rewrittenContent });
      } else {
        updateDailyNoteRecord(db, note.noteId, { contentMarkdown: rewrittenContent });
      }
    }

    report.summary.converted = report.converted.length;
    report.summary.skipped = report.skipped.length;
    report.summary.unresolved = report.unresolved.length;
    return report;
  });
}

async function runSyncWatch(intervalMinutes) {
  const safeIntervalMinutes = Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? intervalMinutes
    : SYNC_INTERVAL_MINUTES_DEFAULT;
  const intervalMs = safeIntervalMinutes * MILLISECONDS_PER_MINUTE;
  console.log(`Starting sync watch mode (${safeIntervalMinutes} minute interval). Press Ctrl+C to stop.`);
  while (!process.exitCode) {
    const result = await runSync();
    console.log(`Sync complete — imported: ${result.imported}, updated: ${result.updated}, uploaded: ${result.uploaded}, deleted: ${result.deleted}, warnings: ${result.warnings.length}, errors: ${result.errors.length}`);
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) console.warn(`  [warning] ${warning}`);
    }
    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`  [error] ${error}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
}

async function prompt(rl, label, options = {}) {
  const suffix = options.showDefault && hasNonEmptyValue(options.defaultValue) ? ` [${options.defaultValue}]` : '';
  const hint = options.allowClear ? ' (blank keeps current, - clears)' : '';
  const answer = await rl.question(`${label}${suffix}${hint}: `);
  const trimmed = answer.trim();

  if (!trimmed) {
    if (options.required) {
      console.log(`${label} is required.`);
      return prompt(rl, label, options);
    }
    return options.defaultValue ?? '';
  }

  if (options.allowClear && trimmed === '-') {
    return '';
  }

  return trimmed;
}

async function promptList(rl, label, current = []) {
  const answer = await prompt(rl, label, {
    defaultValue: current.join(', '),
    showDefault: current.length > 0,
    allowClear: true,
  });
  if (answer === current.join(', ')) return current;
  return parseCsv(answer);
}

async function promptYesNo(rl, label, defaultValue = false) {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  const answer = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

function openInEditor(currentContent = '') {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
  const tmpFile = join(tmpdir(), `puzzlepkm-edit-${randomUUID()}.md`);
  try {
    writeFileSync(tmpFile, currentContent, 'utf8');
    const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
    if (result.error) throw result.error;
    return readFileSync(tmpFile, 'utf8');
  } finally {
    try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

async function promptMultiline(rl, label, currentValue = null) {
  if (stdin.isTTY) {
    const editorName = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
    console.log(`Opening ${label.toLowerCase()} in ${editorName}...`);
    return openInEditor(currentValue ?? '');
  }

  // Fallback for non-TTY contexts (piped input, CI, etc.)
  if (currentValue !== null) {
    const shouldEdit = await promptYesNo(rl, `${label} (current content will be replaced)`, false);
    if (!shouldEdit) return currentValue;
  }

  console.log(`${label} (finish with a single '.' on its own line)`);
  const lines = [];
  for (;;) {
    const line = await rl.question('... ');
    if (line === '.') break;
    lines.push(line);
  }
  return lines.join('\n');
}

async function createObjectInteractive(type, rl) {
  const db = openDb();
  try {
    switch (type) {
      case 'topic-note': return await createTopicNoteInteractive(db, rl);
      case 'daily-note': return await createDailyNoteInteractive(db, rl);
      case 'project': return await createProjectInteractive(db, rl);
      case 'ref-material': return await createRefMaterialInteractive(db, rl);
      case 'habit': return await createHabitInteractive(db, rl);
      case 'tag': return createTagRecord(db, await prompt(rl, 'Tag name', { required: true }));
      case 'link': return await createLinkInteractive(db, rl);
      default:
        throw new Error(`Unsupported type: ${type}`);
    }
  } finally {
    db.close();
  }
}

async function updateObjectInteractive(type, reference, rl) {
  const db = openDb();
  try {
    switch (type) {
      case 'topic-note': return await updateTopicNoteInteractive(db, reference, rl);
      case 'daily-note': return await updateDailyNoteInteractive(db, reference, rl);
      case 'project': return await updateProjectInteractive(db, reference, rl);
      case 'ref-material': return await updateRefMaterialInteractive(db, reference, rl);
      case 'habit': return await updateHabitInteractive(db, reference, rl);
      case 'tag': return await updateTagInteractive(db, reference, rl);
      default:
        throw new Error(`Interactive update is not supported for ${type}`);
    }
  } finally {
    db.close();
  }
}

function printHelp() {
  console.log(`${PRIMARY_PRODUCT_NAME} CLI

Usage:
  ${PRIMARY_CLI_COMMAND}                 Start the interactive shell
  ${PRIMARY_CLI_COMMAND} shell           Start the interactive shell
  ${PRIMARY_CLI_COMMAND} help            Show help
  ${PRIMARY_CLI_COMMAND} add <text>      Quick-create a topic note
  ${PRIMARY_CLI_COMMAND} list [type]     List topic notes or another object type
  ${PRIMARY_CLI_COMMAND} get [type] [id] Show one object as JSON
  ${PRIMARY_CLI_COMMAND} create [type]   Create an object with guided prompts
  ${PRIMARY_CLI_COMMAND} import [type] [dir]
                           Batch import Markdown notes from a directory
  ${PRIMARY_CLI_COMMAND} migrate-links [--dry-run|--apply]
                           Migrate legacy path-based note links to canonical UUID hrefs
  ${PRIMARY_CLI_COMMAND} update [type] [id-or-date]
                           Update an object with guided prompts
  ${PRIMARY_CLI_COMMAND} delete [type] [id-or-date]
                           Delete an object
  ${PRIMARY_CLI_COMMAND} browse [target] Browse notes, directories, files, or all objects

Sync:
  ${PRIMARY_CLI_COMMAND} sync            Sync notes, habits, and directories to local sync folder (one-shot)
  ${PRIMARY_CLI_COMMAND} sync --watch    Run background sync daemon (default interval: ${SYNC_INTERVAL_MINUTES_DEFAULT}m)
    [--interval [minutes]]    Override sync interval in minutes

Settings:
  ${PRIMARY_CLI_COMMAND} settings show   Show CLI-visible app settings
  ${PRIMARY_CLI_COMMAND} settings set root-folder [path]
                             Set sync root folder (default: ${DEFAULT_NOTES_ROOT} -> ${DEFAULT_LOCAL_STORAGE_DIR}/PuzzlePKM)

Object types:
  topic-note, daily-note, project, ref-material, habit, scripture, tag, link

Browse targets:
  all, notes, directories, files, <object-type>

Shell shortcuts:
  Ctrl+C / Ctrl+D           Exit the interactive shell
  Note content editing      Opens in $EDITOR (default: vi); use VIM commands
                             to edit (:w to save, :q to quit, :q! to discard)

Environment:
  ${PRIMARY_DB_ENV_VAR}      Optional absolute path to a ${PRIMARY_PRODUCT_NAME} SQLite database
`);
}

function createCommandContext(rl) {
  return {
    rl,
    PRIMARY_CLI_COMMAND,
    SYNC_INTERVAL_MINUTES_DEFAULT,
    HABIT_STATUS_PLANNED,
    randomUUID,
    normalize,
    withDb,
    resolveType,
    titleFromText,
    getIsoNow,
    localDateString,
    createTopicNoteRecord,
    createDailyNoteRecord,
    createProjectRecord,
    createRefMatRecord,
    createHabitRecord,
    updateTopicNoteRecord,
    updateDailyNoteRecord,
    updateProjectRecord,
    updateRefMatRecord,
    updateHabitRecord,
    deleteTopicNoteRecord,
    deleteDailyNoteRecord,
    deleteProjectRecord,
    deleteRefMatRecord,
    deleteHabitRecord,
    deleteTagRecord,
    deleteLinkRecord,
    listObjects,
    listMetaBundle,
    printRecords,
    formatCompact,
    getObject,
    createPromptInterface,
    createObjectInteractive,
    updateObjectInteractive,
    importNotesFromDirectory,
    getDailyNote,
    getTopicNote,
    getProject,
    getRefMat,
    getHabit,
    isDailyNoteDeleteEligible,
    hasKnownRemoteCopy,
    getSyncRootFolder,
    canonicalProjectSyncPath,
    canonicalRefMaterialSyncPath,
    dailyNoteSyncPath,
    topicNoteSyncPath,
    habitSyncPath,
    deleteSyncPath,
    browseTarget,
    getSettingsState,
    saveSyncRootFolder,
    prompt,
    runSync,
    runSyncWatch,
    runLegacyLinkMigration,
    listAuthors,
    createAuthor,
    deleteAuthor,
  };
}

async function executeTokens(tokens, context = {}) {
  const [command, ...args] = tokens;
  const action = normalize(command).toLowerCase();
  const rl = context.rl ?? null;

  if (!action || action === 'help' || action === '--help' || action === '-h' || action === '?') {
    printHelp();
    return;
  }

  if (action === 'exit' || action === 'quit') {
    console.log('Use Ctrl+C or Ctrl+D to exit the interactive shell.');
    return;
  }

  if (action === 'shell') {
    await startShell();
    return;
  }

  const commandContext = createCommandContext(rl);
  if (await handleNotesCommand(action, args, commandContext)) return;
  if (await handleObjectsCommand(action, args, commandContext)) return;
  if (await handleSettingsCommand(action, args, commandContext)) return;
  if (await handleSyncCommand(action, args, commandContext)) return;

  throw new Error(`Unknown command: ${command}`);
}

async function startShell() {
  const rl = createPromptInterface();
  let interrupted = false;

  rl.on('SIGINT', () => {
    interrupted = true;
    stdout.write(`\nLeaving ${PRIMARY_PRODUCT_NAME} shell.\n`);
    rl.close();
  });

  console.log(`${PRIMARY_PRODUCT_NAME} shell`);
  console.log(`Database: ${dbFile}`);
  console.log('Type help for commands. Exit with Ctrl+C or Ctrl+D.');

  try {
    for (;;) {
      let line;
      try {
        line = await rl.question(`${PRIMARY_CLI_COMMAND}> `);
      } catch {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        await executeTokens(tokenize(trimmed), { rl });
      } catch (error) {
        console.error(String(error instanceof Error ? error.message : error));
      }
    }
  } finally {
    rl.close();
    if (!interrupted) {
      console.log(`Leaving ${PRIMARY_PRODUCT_NAME} shell.`);
    }
  }
}

export async function main() {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) {
    await startShell();
    return;
  }

  try {
    await executeTokens(tokens);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

export const __testing = {
  openDb,
  runSync,
  saveSyncToken,
  saveSyncRootFolder,
  parseProjectMetaYaml,
  parseProjectSyncFolderEntry,
  parseRefMaterialMetaYaml,
  parseRefMaterialSyncFolderEntry,
  createDailyNoteRecord,
  createTopicNoteRecord,
  updateTopicNoteRecord,
  listDailyNotes,
  listTopicNotes,
  listProjects,
  listRefMats,
  listHabits,
  listScriptures,
  getDailyNote,
  getTopicNote,
  hasKnownRemoteCopy,
  getSyncState,
};
