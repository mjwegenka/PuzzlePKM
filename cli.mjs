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
import { URL, pathToFileURL } from 'node:url';

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
  }

function defaultAppDataDir() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'puzzlepkm');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'puzzlepkm');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'puzzlepkm');
}

const appDataDir = defaultAppDataDir();

function secretsFilePath() {
  return join(appDataDir, 'secrets.json');
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
const MARKDOWN_LINK_REGEX = /\[([^]]+)]\(([^)]+)\)/g;

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

function openDb() {
  mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  ensureSchema(db);
  backfillMissingSyncPaths(db);
  backfillNoteBlocks(db);
  repairNoteBlocksIntegrity(db);
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
    const slug = slugify(row.name || row.id);
    db.prepare('UPDATE projects SET sync_path = ? WHERE id = ?').run(projectDirectoryPath(rootFolder, slug), row.id);
  }

  const missingRefMat = db.prepare("SELECT id, name, sync_path FROM ref_materials WHERE TRIM(COALESCE(sync_path, '')) = ''").all();
  for (const row of missingRefMat) {
    const slug = slugify(row.name || row.id);
    db.prepare('UPDATE ref_materials SET sync_path = ? WHERE id = ?').run(refMaterialDirectoryPath(rootFolder, slug), row.id);
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
    SELECT id, type, label, date, sync_path FROM (
      SELECT id, 'topic-note' AS type, title AS label, date, sync_path AS sync_path FROM topic_notes
      UNION ALL
      SELECT id, 'daily-note' AS type, date AS label, date, sync_path AS sync_path FROM daily_notes
      UNION ALL
      SELECT id, 'project' AS type, name AS label, '' AS date, sync_path AS sync_path FROM projects
      UNION ALL
      SELECT id, 'ref-material' AS type, name AS label, '' AS date, sync_path AS sync_path FROM ref_materials
      UNION ALL
      SELECT id, 'habit' AS type, text AS label, date, sync_path AS sync_path FROM habits
      UNION ALL
      SELECT id, 'scripture' AS type, reference AS label, '' AS date, '' AS sync_path FROM scriptures
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
  };
}

function parseMarkdownLinkHrefs(contentMarkdown) {
  const markdown = String(contentMarkdown ?? '');
  const matches = markdown.matchAll(/\[[^]]+]\(([^)]+)\)/g);
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

function ensureScriptureRecord(db, scriptureRef) {
  const existing = db.prepare('SELECT id FROM scriptures WHERE reference = ?').get(scriptureRef.reference);
  if (existing?.id) {
    db.prepare(`
      UPDATE scriptures
      SET book_name = ?, book_order = ?, passage_url = ?, updated_at = ?
      WHERE id = ?
    `).run(scriptureRef.bookName, scriptureRef.bookOrder, scriptureRef.passageUrl, getIsoNow(), existing.id);
    return existing.id;
  }
  const now = getIsoNow();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO scriptures (id, reference, book_name, book_order, passage_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, scriptureRef.reference, scriptureRef.bookName, scriptureRef.bookOrder, scriptureRef.passageUrl, now, now);
  return id;
}

function collectScriptureLinkTargets(db, scriptureRefs) {
  const targets = [];
  for (const scriptureRef of scriptureRefs ?? []) {
    const id = ensureScriptureRecord(db, scriptureRef);
    if (!id) continue;
    targets.push({ id, type: SCRIPTURE_TYPE });
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
  const existingLinks = db
    .prepare('SELECT source_id, target_id, target_type FROM object_links WHERE source_id = ? AND source_type = ?')
    .all(sourceId, sourceType);
  for (const link of existingLinks) {
    if (!targetIds.has(link.target_id)) {
      db.prepare('DELETE FROM object_links WHERE source_id = ? AND target_id = ?').run(link.source_id, link.target_id);
      if (link.target_type === 'daily-note') {
        removedDailyTargetIds.push(link.target_id);
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
  return removedDailyTargetIds;
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

function getTopicNote(db, id) {
  const row = db.prepare('SELECT * FROM topic_notes WHERE id = ?').get(id);
  if (!row) return null;
  const { blocks, contentMarkdown } = getCanonicalNoteContent(db, row.id, row.content_markdown);
  return {
    id: row.id,
    type: 'topic-note',
    title: row.title,
    date: row.date || '',
    syncPath: row.sync_path || '',
    content: safeJsonParse(row.content, {}),
    contentMarkdown,
    blocks,
    linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
    links: getRelatedObjects(db, row.id, 'forward'),
    backlinks: getRelatedObjects(db, row.id, 'backward'),
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTopicNotes(db) {
  const rows = db.prepare('SELECT id, title, date, content_markdown, sync_path, created_at, updated_at FROM topic_notes ORDER BY updated_at DESC').all();
  const contentByNoteId = getCanonicalNoteContentMap(db, rows);
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const contentMarkdown = contentByNoteId.get(row.id)?.contentMarkdown ?? (row.content_markdown ?? '');
    return {
      id: row.id,
      title: row.title,
      date: row.date || '',
      syncPath: row.sync_path || '',
      preview: contentMarkdown.slice(0, 80),
      tags: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function createTopicNoteRecord(db, input) {
  return withTransaction(db, () => {
    const now = input.createdAt ?? getIsoNow();
    const rootFolder = getSyncRootFolder();
    const syncPath = normalizeSyncPath(input.syncPath) || topicNoteSyncPath(rootFolder, input.title, input.id);
    // DEC-36, DEC-37, DEC-38: Use pre-parsed blocks if provided; otherwise parse from contentMarkdown.
    const blocks = Array.isArray(input.blocks) && input.blocks.length > 0
      ? input.blocks
      : parseBlocksFromMarkdown(input.contentMarkdown);
    const contentMarkdown = Array.isArray(blocks) && blocks.length > 0
      ? assembleMarkdownFromBlocks(blocks)
      : (input.contentMarkdown ?? '');
    const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
    const normalizedBlocks = normalizedScripture.blocks;
    const normalizedContentMarkdown = normalizedBlocks.length > 0 ? assembleMarkdownFromBlocks(normalizedBlocks) : '';
    const derivedLinks = deriveNoteLinksFromContent(db, input.id, syncPath, normalizedContentMarkdown);
    const dateLinks = collectDateLinkTargets(db, [input.date]);
    const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
    const mergedLinks = mergeLinkTargets(derivedLinks, dateLinks, scriptureLinks);
    db.prepare(`
      INSERT INTO topic_notes (id, title, date, content, linked_object_ids, sync_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.title,
      input.date || '',
      JSON.stringify(input.content ?? {}),
      JSON.stringify(mergedLinks.map((target) => target.id)),
      syncPath,
      input.createdAt,
      input.updatedAt,
    );
    syncObjectTags(db, input.id, 'topic-note', input.tags ?? []);
    persistNoteBlocks(db, input.id, 'topic-note', normalizedBlocks, now);
    syncNoteObjectLinks(db, input.id, 'topic-note', mergedLinks);
    return getTopicNote(db, input.id);
  });
}

function updateTopicNoteRecord(db, id, input) {
  const existing = getTopicNote(db, id);
  if (!existing) return null;
  const rootFolder = getSyncRootFolder();
  const updatedAt = input.updatedAt ?? getIsoNow();
  const fields = ['updated_at = ?'];
  const values = [updatedAt];
  const nextTitle = input.title ?? existing.title;
  const nextSyncPath =
    normalizeSyncPath(input.syncPath !== undefined ? input.syncPath : existing.syncPath)
    || topicNoteSyncPath(rootFolder, nextTitle, id);
  const nextDate = input.date !== undefined ? (input.date || '') : (existing.date || '');
  let derivedLinks;

  if (input.title !== undefined) {
    fields.push('title = ?');
    values.push(input.title);
  }
  if (input.date !== undefined) {
    fields.push('date = ?');
    values.push(input.date || '');
  }
  if (input.content !== undefined) {
    fields.push('content = ?');
    values.push(JSON.stringify(input.content));
  }
  // DEC-36, DEC-37, DEC-38: Use pre-parsed blocks if provided; otherwise parse from contentMarkdown.
  let updatedBlocks;
  if (Array.isArray(input.blocks) && input.blocks.length > 0) {
    updatedBlocks = input.blocks;
  } else if (input.contentMarkdown !== undefined) {
    updatedBlocks = parseBlocksFromMarkdown(input.contentMarkdown);
  } else if (Array.isArray(input.blocks) && input.blocks.length === 0) {
    updatedBlocks = [];
  }
  if (updatedBlocks !== undefined || input.date !== undefined) {
    const contentMarkdown = updatedBlocks !== undefined
      ? (
        Array.isArray(updatedBlocks) && updatedBlocks.length > 0
          ? assembleMarkdownFromBlocks(updatedBlocks)
          : (input.contentMarkdown ?? '')
      )
      : existing.contentMarkdown;
    const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
    updatedBlocks = normalizedScripture.blocks;
    const normalizedContentMarkdown = updatedBlocks.length > 0 ? assembleMarkdownFromBlocks(updatedBlocks) : '';
    const contentLinks = deriveNoteLinksFromContent(db, id, nextSyncPath, normalizedContentMarkdown);
    const dateLinks = collectDateLinkTargets(db, [nextDate]);
    const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
    derivedLinks = mergeLinkTargets(contentLinks, dateLinks, scriptureLinks);
    fields.push('linked_object_ids = ?');
    values.push(JSON.stringify(derivedLinks.map((target) => target.id)));
  }
  if (derivedLinks === undefined && input.linkedObjectIds !== undefined) {
    fields.push('linked_object_ids = ?');
    values.push(JSON.stringify(input.linkedObjectIds));
  }
  if (input.syncPath !== undefined || !normalizeSyncPath(existing.syncPath)) {
    fields.push('sync_path = ?');
    values.push(nextSyncPath);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE topic_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'topic-note', input.tags);
    }
    if (updatedBlocks !== undefined) {
      persistNoteBlocks(db, id, 'topic-note', updatedBlocks, updatedAt);
    }
    if (derivedLinks !== undefined) {
      const removedDailyNoteIds = syncNoteObjectLinks(db, id, 'topic-note', derivedLinks);
      cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
    }
    return getTopicNote(db, id);
  });
}

function deleteTopicNoteRecord(db, id) {
  return withTransaction(db, () => {
    const linkedDailyNoteIds = db
      .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
      .all(id)
      .map((row) => row.target_id);
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    db.prepare('DELETE FROM note_blocks WHERE note_id = ?').run(id);
    clearSyncState(db, 'topic-note', id);
    const result = db.prepare('DELETE FROM topic_notes WHERE id = ?').run(id);
    cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
    return result.changes > 0;
  });
}

function findDailyNoteRow(db, reference) {
  return db.prepare('SELECT * FROM daily_notes WHERE id = ? OR date = ?').get(reference, reference) ?? null;
}

function ensureDailyNoteForDate(db, date) {
  const normalizedDate = normalize(date);
  if (!isLocalDateString(normalizedDate)) return null;
  const existing = getDailyNote(db, normalizedDate);
  if (existing) return existing;
  const now = getIsoNow();
  return createDailyNoteRecordInternal(db, {
    id: randomUUID(),
    date: normalizedDate,
    content: {},
    contentMarkdown: '',
    blocks: [],
    linkedObjectIds: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
}

function stripEmbeddedBlockComments(markdown) {
  return String(markdown ?? '')
    .replace(/\s*<!--\s*blk-[a-f0-9]{12}\s*-->\s*$/gim, '')
    .trim();
}

function hasNonEmptyDailyNoteContent(db, row) {
  const blocks = getNoteBlocks(db, row.id);
  if (blocks.length > 0) {
    return blocks.some((block) => normalize(block.contentMarkdown));
  }
  return Boolean(stripEmbeddedBlockComments(row.content_markdown));
}

function isDailyNoteDeleteEligible(db, dailyNoteId) {
  const row = findDailyNoteRow(db, dailyNoteId);
  if (!row) return false;
  if (hasNonEmptyDailyNoteContent(db, row)) return false;
  if (db.prepare('SELECT 1 FROM object_tags WHERE object_id = ? LIMIT 1').get(row.id)) return false;
  if (db.prepare('SELECT 1 FROM object_links WHERE source_id = ? OR target_id = ? LIMIT 1').get(row.id, row.id)) return false;
  return true;
}

function forceDeleteDailyNoteRecord(db, dailyNoteId) {
  db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(dailyNoteId);
  db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(dailyNoteId, dailyNoteId);
  db.prepare('DELETE FROM note_blocks WHERE note_id = ?').run(dailyNoteId);
  clearSyncState(db, 'daily-note', dailyNoteId);
  const result = db.prepare('DELETE FROM daily_notes WHERE id = ?').run(dailyNoteId);
  return result.changes > 0;
}

function autoDeleteDailyNoteIfEligible(db, dailyNoteId) {
  const row = findDailyNoteRow(db, dailyNoteId);
  if (!row?.id || !isDailyNoteDeleteEligible(db, row.id)) return false;
  return forceDeleteDailyNoteRecord(db, row.id);
}

function cleanupDailyNotesIfEligible(db, dailyNoteIds) {
  const seen = new Set();
  for (const dailyNoteId of dailyNoteIds ?? []) {
    const id = normalize(dailyNoteId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    autoDeleteDailyNoteIfEligible(db, id);
  }
}

function mapDailyNote(db, row) {
  const { blocks, contentMarkdown } = getCanonicalNoteContent(db, row.id, row.content_markdown);
  return {
    id: row.id,
    type: 'daily-note',
    date: row.date,
    syncPath: row.sync_path || '',
    content: safeJsonParse(row.content, {}),
    contentMarkdown,
    blocks,
    linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
    links: getRelatedObjects(db, row.id, 'forward'),
    backlinks: getRelatedObjects(db, row.id, 'backward'),
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDailyNote(db, reference) {
  const row = findDailyNoteRow(db, reference);
  return row ? mapDailyNote(db, row) : null;
}

function listDailyNotes(db) {
  const rows = db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all();
  const contentByNoteId = getCanonicalNoteContentMap(db, rows);
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const contentMarkdown = contentByNoteId.get(row.id)?.contentMarkdown ?? (row.content_markdown ?? '');
    return {
      id: row.id,
      date: row.date,
      syncPath: row.sync_path || '',
      preview: contentMarkdown.slice(0, 80),
      tags: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function createDailyNoteRecordInternal(db, input) {
  const now = input.createdAt ?? getIsoNow();
  const rootFolder = getSyncRootFolder();
  const syncPath = normalizeSyncPath(input.syncPath) || dailyNoteSyncPath(rootFolder, input.date);
  // DEC-36, DEC-37, DEC-38: Use pre-parsed blocks if provided; otherwise parse from contentMarkdown.
  const blocks = Array.isArray(input.blocks) && input.blocks.length > 0
    ? input.blocks
    : parseBlocksFromMarkdown(input.contentMarkdown);
  const contentMarkdown = Array.isArray(blocks) && blocks.length > 0
    ? assembleMarkdownFromBlocks(blocks)
    : (input.contentMarkdown ?? '');
  const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
  const normalizedBlocks = normalizedScripture.blocks;
  const normalizedContentMarkdown = normalizedBlocks.length > 0 ? assembleMarkdownFromBlocks(normalizedBlocks) : '';
  const derivedLinks = deriveNoteLinksFromContent(db, input.id, syncPath, normalizedContentMarkdown);
  const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
  const mergedLinks = mergeLinkTargets(derivedLinks, scriptureLinks);
  db.prepare(`
      INSERT INTO daily_notes (id, date, content, linked_object_ids, sync_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
    input.id,
    input.date,
    JSON.stringify(input.content ?? {}),
    JSON.stringify(mergedLinks.map((target) => target.id)),
    syncPath,
    input.createdAt,
    input.updatedAt,
  );
  syncObjectTags(db, input.id, 'daily-note', input.tags ?? []);
  persistNoteBlocks(db, input.id, 'daily-note', normalizedBlocks, now);
  const removedDailyNoteIds = syncNoteObjectLinks(db, input.id, 'daily-note', mergedLinks);
  cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
  return getDailyNote(db, input.id);
}

function createDailyNoteRecord(db, input) {
  const existing = db.prepare('SELECT id FROM daily_notes WHERE date = ?').get(input.date);
  if (existing?.id) {
    throw new Error(`A daily note already exists for ${input.date}`);
  }

  return withTransaction(db, () => createDailyNoteRecordInternal(db, input));
}

function updateDailyNoteRecord(db, reference, input) {
  const existing = findDailyNoteRow(db, reference);
  if (!existing) return null;
  const rootFolder = getSyncRootFolder();
  const nextDate = input.date ?? existing.date;
  const duplicate = db.prepare('SELECT id FROM daily_notes WHERE date = ? AND id != ?').get(nextDate, existing.id);
  if (duplicate?.id) {
    throw new Error(`A daily note already exists for ${nextDate}`);
  }

  const updatedAt = input.updatedAt ?? getIsoNow();
  const fields = ['updated_at = ?'];
  const values = [updatedAt];
  const nextSyncPath =
    normalizeSyncPath(input.syncPath !== undefined ? input.syncPath : existing.sync_path)
    || dailyNoteSyncPath(rootFolder, nextDate);
  let derivedLinks;

  if (input.date !== undefined) {
    fields.push('date = ?');
    values.push(input.date);
  }
  if (input.content !== undefined) {
    fields.push('content = ?');
    values.push(JSON.stringify(input.content));
  }
  // DEC-36, DEC-37, DEC-38: Use pre-parsed blocks if provided; otherwise parse from contentMarkdown.
  let updatedBlocks;
  if (Array.isArray(input.blocks) && input.blocks.length > 0) {
    updatedBlocks = input.blocks;
  } else if (input.contentMarkdown !== undefined) {
    updatedBlocks = parseBlocksFromMarkdown(input.contentMarkdown);
  } else if (Array.isArray(input.blocks) && input.blocks.length === 0) {
    updatedBlocks = [];
  }
  if (updatedBlocks !== undefined) {
    const contentMarkdown = Array.isArray(updatedBlocks) && updatedBlocks.length > 0
      ? assembleMarkdownFromBlocks(updatedBlocks)
      : (input.contentMarkdown ?? '');
    const normalizedScripture = normalizeScriptureBlocks(parseBlocksFromMarkdown(contentMarkdown));
    updatedBlocks = normalizedScripture.blocks;
    const normalizedContentMarkdown = updatedBlocks.length > 0 ? assembleMarkdownFromBlocks(updatedBlocks) : '';
    const contentLinks = deriveNoteLinksFromContent(db, existing.id, nextSyncPath, normalizedContentMarkdown);
    const scriptureLinks = collectScriptureLinkTargets(db, normalizedScripture.references);
    derivedLinks = mergeLinkTargets(contentLinks, scriptureLinks);
    fields.push('linked_object_ids = ?');
    values.push(JSON.stringify(derivedLinks.map((target) => target.id)));
  }
  if (derivedLinks === undefined && input.linkedObjectIds !== undefined) {
    fields.push('linked_object_ids = ?');
    values.push(JSON.stringify(input.linkedObjectIds));
  }
  if (input.syncPath !== undefined || !normalizeSyncPath(existing.sync_path)) {
    fields.push('sync_path = ?');
    values.push(nextSyncPath);
  }

  values.push(existing.id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE daily_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, existing.id, 'daily-note', input.tags);
    }
    if (updatedBlocks !== undefined) {
      persistNoteBlocks(db, existing.id, 'daily-note', updatedBlocks, updatedAt);
    }
    if (derivedLinks !== undefined) {
      const removedDailyNoteIds = syncNoteObjectLinks(db, existing.id, 'daily-note', derivedLinks);
      cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
    }
    return getDailyNote(db, existing.id);
  });
}

function deleteDailyNoteRecord(db, reference) {
  const existing = findDailyNoteRow(db, reference);
  if (!existing) return false;
  if (!isDailyNoteDeleteEligible(db, existing.id)) {
    throw new Error(`Cannot delete daily note ${existing.date}: clear content/tags and remove links/backlinks first.`);
  }
  return withTransaction(db, () => {
    return forceDeleteDailyNoteRecord(db, existing.id);
  });
}

function getProject(db, id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: 'project',
    name: row.name,
    syncPath: row.sync_path,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listProjects(db) {
  const rows = db.prepare('SELECT * FROM projects ORDER BY name ASC').all();
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    syncPath: row.sync_path,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    tags: tagNamesByObjectId.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createProjectRecord(db, input) {
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO projects (id, name, sync_path, start_date, end_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.syncPath, input.startDate || null, input.endDate || null, input.createdAt, input.updatedAt);
    syncObjectTags(db, input.id, 'project', input.tags ?? []);
    syncNoteObjectLinks(db, input.id, 'project', collectDateLinkTargets(db, [input.startDate, input.endDate]));
    return getProject(db, input.id);
  });
}

function updateProjectRecord(db, id, input) {
  const existing = getProject(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];

  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.syncPath !== undefined) {
    fields.push('sync_path = ?');
    values.push(input.syncPath);
  }
  if (input.startDate !== undefined) {
    fields.push('start_date = ?');
    values.push(input.startDate || null);
  }
  if (input.endDate !== undefined) {
    fields.push('end_date = ?');
    values.push(input.endDate || null);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'project', input.tags);
    }
    const nextStartDate = input.startDate !== undefined ? input.startDate : existing.startDate;
    const nextEndDate = input.endDate !== undefined ? input.endDate : existing.endDate;
    const removedDailyNoteIds = syncNoteObjectLinks(db, id, 'project', collectDateLinkTargets(db, [nextStartDate, nextEndDate]));
    cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
    return getProject(db, id);
  });
}

function deleteProjectRecord(db, id) {
  return withTransaction(db, () => {
    const linkedDailyNoteIds = db
      .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
      .all(id)
      .map((row) => row.target_id);
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    clearSyncState(db, 'project', id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
    return result.changes > 0;
  });
}

function getRefMat(db, id) {
  const row = db.prepare('SELECT * FROM ref_materials WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: 'ref-material',
    name: row.name,
    author: typeof row.author === 'string' ? row.author : '',
    syncPath: row.sync_path,
    tags: getTagDisplayNames(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listRefMats(db) {
  const rows = db.prepare('SELECT * FROM ref_materials ORDER BY name ASC').all();
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    author: typeof row.author === 'string' ? row.author : '',
    syncPath: row.sync_path,
    tags: tagNamesByObjectId.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createRefMatRecord(db, input) {
  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO ref_materials (id, name, author, sync_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.author ?? null, input.syncPath, input.createdAt, input.updatedAt);
    syncObjectTags(db, input.id, 'ref-material', input.tags ?? []);
    return getRefMat(db, input.id);
  });
}

function updateRefMatRecord(db, id, input) {
  const existing = getRefMat(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];

  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.author !== undefined) {
    fields.push('author = ?');
    values.push(input.author || null);
  }
  if (input.syncPath !== undefined) {
    fields.push('sync_path = ?');
    values.push(input.syncPath);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE ref_materials SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'ref-material', input.tags);
    }
    return getRefMat(db, id);
  });
}

function deleteRefMatRecord(db, id) {
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    clearSyncState(db, 'ref-material', id);
    const result = db.prepare('DELETE FROM ref_materials WHERE id = ?').run(id);
    return result.changes > 0;
  });
}

function getHabit(db, id) {
  const row = db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
  if (!row) return null;
  const tags = getTagDisplayNames(db, row.id);
  return {
    id: row.id,
    type: 'habit',
    text: row.text,
    date: row.date,
    status: normalizeHabitStatus(row.status, HABIT_STATUS_PLANNED),
    syncPath: row.sync_path || '',
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listHabits(db) {
  const rows = db.prepare('SELECT * FROM habits ORDER BY date DESC, created_at ASC').all();
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    date: row.date,
    status: normalizeHabitStatus(row.status, HABIT_STATUS_PLANNED),
    syncPath: row.sync_path || '',
    tags: tagNamesByObjectId.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function sanitizeHabitText(text) {
  return text.length > MAX_HABIT_TEXT_LENGTH
    ? { text: text.slice(0, MAX_HABIT_TEXT_LENGTH), truncated: true }
    : { text, truncated: false };
}

function createHabitRecord(db, input) {
  const sanitized = sanitizeHabitText(input.text);
  const tags = normalizeHabitTagNames(input.tags);
  const status = normalizeHabitStatus(input.status, HABIT_STATUS_PLANNED);
  return withTransaction(db, () => {
    // DEC-21: Calculate syncPath from sync_path parameter or generate from date/tags/id
    const syncPath = input.syncPath || '';
    db.prepare(`
      INSERT INTO habits (id, text, date, status, sync_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, sanitized.text, input.date, status, syncPath, input.createdAt, input.updatedAt);
    syncObjectTags(db, input.id, 'habit', tags);
    syncNoteObjectLinks(db, input.id, 'habit', collectDateLinkTargets(db, [input.date]));
    return { ...getHabit(db, input.id), truncated: sanitized.truncated };
  });
}

function updateHabitRecord(db, id, input) {
  const existing = getHabit(db, id);
  if (!existing) return null;
  const fields = ['updated_at = ?'];
  const values = [input.updatedAt ?? getIsoNow()];
  let truncated = false;

  if (input.text !== undefined) {
    const sanitized = sanitizeHabitText(input.text);
    truncated = sanitized.truncated;
    fields.push('text = ?');
    values.push(sanitized.text);
  }
  if (input.date !== undefined) {
    fields.push('date = ?');
    values.push(input.date);
  }
  if (input.status !== undefined) {
    fields.push('status = ?');
    values.push(normalizeHabitStatus(input.status, existing.status));
  }
  if (input.syncPath !== undefined) {
    fields.push('sync_path = ?');
    values.push(input.syncPath);
  }

  values.push(id);

  return withTransaction(db, () => {
    db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (input.tags !== undefined) {
      syncObjectTags(db, id, 'habit', normalizeHabitTagNames(input.tags));
    }
    const nextDate = input.date ?? existing.date;
    const removedDailyNoteIds = syncNoteObjectLinks(db, id, 'habit', collectDateLinkTargets(db, [nextDate]));
    cleanupDailyNotesIfEligible(db, removedDailyNoteIds);
    return { ...getHabit(db, id), truncated };
  });
}

function deleteHabitRecord(db, id) {
  return withTransaction(db, () => {
    const linkedDailyNoteIds = db
      .prepare("SELECT target_id FROM object_links WHERE source_id = ? AND target_type = 'daily-note'")
      .all(id)
      .map((row) => row.target_id);
    db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(id);
    db.prepare('DELETE FROM object_links WHERE source_id = ? OR target_id = ?').run(id, id);
    clearSyncState(db, 'habit', id);
    const result = db.prepare('DELETE FROM habits WHERE id = ?').run(id);
    cleanupDailyNotesIfEligible(db, linkedDailyNoteIds);
    return result.changes > 0;
  });
}

function getTag(db, reference) {
  const row = db.prepare('SELECT * FROM tags WHERE id = ? OR name = ?').get(reference, reference.toLowerCase());
  if (!row) return null;
  return {
    id: row.id,
    type: 'tag',
    name: row.name,
    displayName: row.display_name,
    createdAt: row.created_at,
    objects: db.prepare(`
      SELECT object_id, object_type
      FROM object_tags
      WHERE tag_id = ?
      ORDER BY object_type ASC, object_id ASC
    `).all(row.id).map((entry) => ({ id: entry.object_id, type: entry.object_type })),
  };
}

function listTags(db) {
  return db.prepare(`
    SELECT t.id, t.name, t.display_name, t.created_at, COALESCE(ot_counts.object_count, 0) AS object_count
    FROM tags t
    LEFT JOIN (
      SELECT tag_id, COUNT(*) AS object_count
      FROM object_tags
      GROUP BY tag_id
    ) ot_counts ON ot_counts.tag_id = t.id
    ORDER BY t.name ASC
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    createdAt: row.created_at,
    objectCount: row.object_count ?? 0,
  }));
}

function createTagRecord(db, displayName) {
  const name = normalize(displayName).toLowerCase();
  if (!name) throw new Error('Tag display name is required');
  const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
  if (existing?.id) return getTag(db, existing.id);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO tags (id, name, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, name, displayName.trim(), getIsoNow());
  return getTag(db, id);
}

function updateTagRecord(db, reference, input) {
  const existing = getTag(db, reference);
  if (!existing) return null;
  const nextDisplayName = normalize(input.displayName);
  if (!nextDisplayName) throw new Error('Tag display name is required');
  const duplicate = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(nextDisplayName.toLowerCase(), existing.id);
  if (duplicate?.id) throw new Error(`Another tag already uses ${nextDisplayName}`);
  db.prepare('UPDATE tags SET name = ?, display_name = ? WHERE id = ?').run(nextDisplayName.toLowerCase(), nextDisplayName, existing.id);
  return getTag(db, existing.id);
}

function deleteTagRecord(db, reference) {
  const existing = getTag(db, reference);
  if (!existing) return false;
  return withTransaction(db, () => {
    db.prepare('DELETE FROM object_tags WHERE tag_id = ?').run(existing.id);
    const result = db.prepare('DELETE FROM tags WHERE id = ?').run(existing.id);
    return result.changes > 0;
  });
}

function getLinks(db, objectId) {
  const sql = objectId
    ? 'SELECT * FROM object_links WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM object_links ORDER BY created_at DESC';
  const rows = objectId ? db.prepare(sql).all(objectId, objectId) : db.prepare(sql).all();
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    sourceType: row.source_type,
    targetType: row.target_type,
    createdAt: row.created_at,
  }));
}

function createLinkRecord(db, input) {
  const existing = db.prepare('SELECT * FROM object_links WHERE source_id = ? AND target_id = ?').get(input.sourceId, input.targetId);
  if (existing) {
    return {
      id: existing.id,
      sourceId: existing.source_id,
      targetId: existing.target_id,
      sourceType: existing.source_type,
      targetType: existing.target_type,
      createdAt: existing.created_at,
    };
  }

  db.prepare(`
    INSERT INTO object_links (id, source_id, target_id, source_type, target_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.sourceId, input.targetId, input.sourceType, input.targetType, input.createdAt);
  return getLinks(db).find((link) => link.id === input.id) ?? null;
}

function deleteLinkRecord(db, id) {
  const result = db.prepare('DELETE FROM object_links WHERE id = ?').run(id);
  return result.changes > 0;
}

function getScriptureLinkedNotes(db, scriptureId) {
  const rows = db.prepare(`
    SELECT source_id AS note_id, source_type AS note_type
    FROM object_links
    WHERE target_id = ?
      AND target_type = ?
      AND source_type IN ('topic-note', 'daily-note')
    ORDER BY source_type ASC, source_id ASC
  `).all(scriptureId, SCRIPTURE_TYPE);
  const linkedNotes = [];
  for (const row of rows) {
    const summary = lookupObjectSummary(db, row.note_id, row.note_type);
    if (!summary) continue;
    linkedNotes.push(summary);
  }
  return sortRelatedObjectsStable(linkedNotes);
}

function getScripture(db, reference) {
  const row = db.prepare('SELECT * FROM scriptures WHERE id = ? OR reference = ?').get(reference, reference);
  if (!row) return null;
  return {
    id: row.id,
    type: SCRIPTURE_TYPE,
    reference: row.reference,
    bookName: row.book_name,
    bookOrder: row.book_order,
    passageUrl: row.passage_url,
    linkedNotes: getScriptureLinkedNotes(db, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listScriptures(db) {
  return db.prepare(`
    SELECT s.id, s.reference, s.book_name, s.book_order, s.passage_url, s.created_at, s.updated_at,
      COALESCE(link_counts.note_count, 0) AS note_count
    FROM scriptures s
    LEFT JOIN (
      SELECT target_id, COUNT(*) AS note_count
      FROM object_links
      WHERE target_type = ?
        AND source_type IN ('topic-note', 'daily-note')
      GROUP BY target_id
    ) link_counts ON link_counts.target_id = s.id
    ORDER BY s.book_order ASC, s.reference COLLATE NOCASE ASC
  `).all(SCRIPTURE_TYPE).map((row) => ({
    id: row.id,
    type: SCRIPTURE_TYPE,
    reference: row.reference,
    bookName: row.book_name,
    bookOrder: row.book_order,
    passageUrl: row.passage_url,
    noteCount: row.note_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

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
  const aliases = new Map([
    ['topic-note', 'topic-note'],
    ['topic-notes', 'topic-note'],
    ['note', 'topic-note'],
    ['notes', 'topic-note'],
    ['daily-note', 'daily-note'],
    ['daily-notes', 'daily-note'],
    ['daily', 'daily-note'],
    ['project', 'project'],
    ['projects', 'project'],
    ['ref-material', 'ref-material'],
    ['ref-materials', 'ref-material'],
    ['reference', 'ref-material'],
    ['references', 'ref-material'],
    ['reference-material', 'ref-material'],
    ['reference-materials', 'ref-material'],
    ['habit', 'habit'],
    ['habits', 'habit'],
    ['scripture', 'scripture'],
    ['scriptures', 'scripture'],
    ['tag', 'tag'],
    ['tags', 'tag'],
    ['link', 'link'],
    ['links', 'link'],
  ]);
  return aliases.get(value) ?? null;
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
        console.log(`${row.id}\t${listField(row.name)}\t${row.syncPath || '(no path)'}\t${row.startDate || ''}`);
        break;
      case 'ref-material':
        console.log(`${row.id}\t${listField(row.name)}\t${listField(row.author)}\t${row.syncPath || '(no path)'}`);
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

function projectMetaPath(rootFolder, slug) {
  return `${projectDirectoryPath(rootFolder, slug)}/meta.yaml`;
}

function refMaterialDirectoryPath(rootFolder, slug) {
  return `${refMaterialsFolderPath(rootFolder)}/${slug}`;
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

function dailyNoteToMarkdown(fields) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'daily-note',
    date: fields.date,
    syncPath: fields.syncPath || '',
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  // DEC-38: Prefer assembling from blocks so block IDs are always embedded in the file body.
  const body =
    Array.isArray(fields.blocks) && fields.blocks.length > 0
      ? assembleMarkdownFromBlocks(fields.blocks)
      : (fields.contentMarkdown ?? '');
  return body ? `${fm}\n\n${body}` : `${fm}\n`;
}

function topicNoteToMarkdown(fields) {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'topic-note',
    title: fields.title,
    date: fields.date || '',
    syncPath: fields.syncPath || '',
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  // DEC-38: Prefer assembling from blocks so block IDs are always embedded in the file body.
  const body =
    Array.isArray(fields.blocks) && fields.blocks.length > 0
      ? assembleMarkdownFromBlocks(fields.blocks)
      : (fields.contentMarkdown ?? '');
  return body ? `${fm}\n\n${body}` : `${fm}\n`;
}

function projectToMetaYaml(fields) {
  return serializeMetaYaml({
    id: fields.id,
    name: fields.name,
    syncPath: fields.syncPath,
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
    syncPath: fields.syncPath,
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
    syncPath: fields.syncPath || '',
    tags: normalizeHabitTagNames(fields.tagNames),
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  return `${fm}\n`;
}

function readSyncPathField(data) {
  if (typeof data.syncPath === 'string') return data.syncPath;
  if (typeof data.syncPath === 'string') return data.syncPath;
  return '';
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
    syncPath: readSyncPathField(data),
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
    syncPath: readSyncPathField(data),
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
    syncPath: readSyncPathField(data),
    startDate: typeof data.startDate === 'string' ? data.startDate : '',
    endDate: typeof data.endDate === 'string' ? data.endDate : '',
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
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
    syncPath: readSyncPathField(data),
    tagNames: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
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
    syncPath: readSyncPathField(data),
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
  if (!sameStringArrayAsSet(remote.tagNames, existing.tags)) return true;
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
  if (!sameStringArrayAsSet(remote.tagNames, existing.tags)) return true;
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

// ── Sync: note list helpers (include full content for upload) ─────────────────

function listDailyNotesForSync(db) {
  const rows = db.prepare('SELECT * FROM daily_notes ORDER BY date DESC').all();
  const contentByNoteId = getCanonicalNoteContentMap(db, rows);
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const canonical = contentByNoteId.get(row.id) ?? { blocks: [], contentMarkdown: row.content_markdown ?? '' };
    return {
      id: row.id,
      date: row.date,
      syncPath: row.sync_path || '',
      contentMarkdown: canonical.contentMarkdown,
      blocks: canonical.blocks,
      linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
      tagNames: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function listTopicNotesForSync(db) {
  const rows = db.prepare('SELECT * FROM topic_notes ORDER BY updated_at DESC').all();
  const contentByNoteId = getCanonicalNoteContentMap(db, rows);
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const canonical = contentByNoteId.get(row.id) ?? { blocks: [], contentMarkdown: row.content_markdown ?? '' };
    return {
      id: row.id,
      title: row.title,
      date: row.date || '',
      syncPath: row.sync_path || '',
      contentMarkdown: canonical.contentMarkdown,
      blocks: canonical.blocks,
      linkedObjectIds: safeJsonParse(row.linked_object_ids, []),
      tagNames: tagNamesByObjectId.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function listProjectsForSync(db) {
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    syncPath: row.sync_path,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    tagNames: tagNamesByObjectId.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function listRefMaterialsForSync(db) {
  const rows = db.prepare('SELECT * FROM ref_materials ORDER BY updated_at DESC').all();
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    author: typeof row.author === 'string' ? row.author : '',
    syncPath: row.sync_path,
    tagNames: tagNamesByObjectId.get(row.id) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function listHabitsForSync(db) {
  const rows = db.prepare('SELECT * FROM habits ORDER BY updated_at DESC').all();
  const tagNamesByObjectId = getTagDisplayNamesMap(db, rows.map((row) => row.id));
  return rows.map((row) => {
    const tags = tagNamesByObjectId.get(row.id) ?? [];
    return {
      id: row.id,
      text: row.text,
      date: row.date,
      status: normalizeHabitStatus(row.status, HABIT_STATUS_PLANNED),
      syncPath: row.sync_path || '',
      tagNames: normalizeHabitTagNames(tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
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
      const parsed = parseProjectMetaYaml(content);
      if (!parsed) return { _stub: true, slug: folder.name, folderPath: folder.path };
      return {
        ...parsed,
        slug: folder.name,
        folderPath: folder.path,
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
      const parsed = parseRefMaterialMetaYaml(content);
      if (!parsed) return { _stub: true, slug: folder.name, folderPath: folder.path };
      return {
        ...parsed,
        slug: folder.name,
        folderPath: folder.path,
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
           await syncUploadText(dailyNoteSyncPath(rootFolder, note.date), dailyNoteToMarkdown(note));
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
             await syncUploadText(dailyNoteSyncPath(rootFolder, note.date), dailyNoteToMarkdown(note));
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
           await syncUploadText(topicNoteSyncPath(rootFolder, note.title, note.id), topicNoteToMarkdown(note));
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
             await syncUploadText(topicNoteSyncPath(rootFolder, note.title, note.id), topicNoteToMarkdown(note));
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
          tags: fields.tagNames,
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
          await ensureSyncFolder(projectDirectoryPath(rootFolder, slug));
          await syncUploadText(projectMetaPath(rootFolder, slug), projectToMetaYaml(item));
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
            if (newSlug !== remoteSlug) {
              // Name changed; rename directory by moving to new slug
              await moveSyncFolder(projectDirectoryPath(rootFolder, remoteSlug), projectDirectoryPath(rootFolder, newSlug));
            }
            await syncUploadText(projectMetaPath(rootFolder, newSlug), projectToMetaYaml(item));
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
          tags: fields.tagNames,
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
          await ensureSyncFolder(refMaterialDirectoryPath(rootFolder, slug));
          await syncUploadText(refMaterialMetaPath(rootFolder, slug), refMaterialToMetaYaml(item));
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
            if (newSlug !== remoteSlug) {
              // Name changed; rename directory by moving to new slug
              await moveSyncFolder(refMaterialDirectoryPath(rootFolder, remoteSlug), refMaterialDirectoryPath(rootFolder, newSlug));
            }
            await syncUploadText(refMaterialMetaPath(rootFolder, newSlug), refMaterialToMetaYaml(item));
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
          await syncUploadText(dailyNoteSyncPath(rootFolder, parsed.date), dailyNoteToMarkdown(updated));
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
    return {
      imported: dailyResult.imported + topicResult.imported + projectResult.imported + refMaterialResult.imported + habitResult.imported + mobileNoteResult.imported + mobileHabitResult.imported,
      updated: dailyResult.updated + topicResult.updated + projectResult.updated + refMaterialResult.updated + habitResult.updated + mobileNoteResult.appended,
      uploaded: dailyResult.uploaded + topicResult.uploaded + projectResult.uploaded + refMaterialResult.uploaded + habitResult.uploaded,
      deleted: dailyResult.deleted + topicResult.deleted + projectResult.deleted + refMaterialResult.deleted + habitResult.deleted,
      warnings: [...dailyResult.warnings, ...topicResult.warnings, ...projectResult.warnings, ...refMaterialResult.warnings, ...habitResult.warnings],
      errors: [...dailyResult.errors, ...topicResult.errors, ...projectResult.errors, ...refMaterialResult.errors, ...habitResult.errors, ...mobileNoteResult.errors, ...mobileHabitResult.errors],
    };
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
    const createdAt = getIsoNow();
    const updatedAt = createdAt;

    switch (type) {
      case 'topic-note': {
        const title = await prompt(rl, 'Title', { required: true });
        const date = await prompt(rl, 'Date (optional, YYYY-MM-DD)', { defaultValue: '', showDefault: false, allowClear: true });
        const contentMarkdown = await promptMultiline(rl, 'Content');
        const linkedObjectIds = parseCsv(await prompt(rl, 'Linked object IDs (comma separated)'));
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createTopicNoteRecord(db, {
          id: randomUUID(),
          title,
          date,
          content: {},
          contentMarkdown,
          linkedObjectIds,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'daily-note': {
        const date = await prompt(rl, 'Date', { defaultValue: localDateString(), showDefault: true, required: true });
        const contentMarkdown = await promptMultiline(rl, 'Content');
        const linkedObjectIds = parseCsv(await prompt(rl, 'Linked object IDs (comma separated)'));
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createDailyNoteRecord(db, {
          id: randomUUID(),
          date,
          content: {},
          contentMarkdown,
          linkedObjectIds,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'project': {
        const name = await prompt(rl, 'Name', { required: true });
        const syncPath = await prompt(rl, 'Sync path');
        const startDate = await prompt(rl, 'Start date (YYYY-MM-DD)');
        const endDate = await prompt(rl, 'End date (YYYY-MM-DD)');
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createProjectRecord(db, {
          id: randomUUID(),
          name,
          syncPath,
          startDate,
          endDate,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'ref-material': {
        const name = await prompt(rl, 'Name', { required: true });
        const author = await prompt(rl, 'Author (optional)', { allowClear: true });
        const syncPath = await prompt(rl, 'Sync path');
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createRefMatRecord(db, {
          id: randomUUID(),
          name,
          author,
          syncPath,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'habit': {
        const text = await prompt(rl, 'Habit text', { required: true });
        const date = await prompt(rl, 'Date', { defaultValue: localDateString(), showDefault: true, required: true });
        const tags = parseCsv(await prompt(rl, 'Tags (comma separated)'));
        return createHabitRecord(db, {
          id: randomUUID(),
          text,
          date,
          tags,
          createdAt,
          updatedAt,
        });
      }
      case 'tag': {
        const displayName = await prompt(rl, 'Tag name', { required: true });
        return createTagRecord(db, displayName);
      }
      case 'link': {
        const sourceType = resolveType(await prompt(rl, 'Source type', { required: true }));
        const sourceId = await prompt(rl, 'Source id', { required: true });
        const targetType = resolveType(await prompt(rl, 'Target type', { required: true }));
        const targetId = await prompt(rl, 'Target id', { required: true });
        if (!sourceType || !targetType || sourceType === 'link' || targetType === 'link') {
          throw new Error('Links require valid non-link object types');
        }
        return createLinkRecord(db, {
          id: randomUUID(),
          sourceId,
          targetId,
          sourceType,
          targetType,
          createdAt,
        });
      }
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
      case 'topic-note': {
        const existing = getTopicNote(db, reference);
        if (!existing) return null;
        const title = await prompt(rl, 'Title', { defaultValue: existing.title, showDefault: true });
        const date = await prompt(rl, 'Date (optional, YYYY-MM-DD)', { defaultValue: existing.date ?? '', showDefault: true, allowClear: true });
        const contentMarkdown = await promptMultiline(rl, 'Content', existing.contentMarkdown);
        const linkedObjectIds = await promptList(rl, 'Linked object IDs (comma separated)', existing.linkedObjectIds);
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateTopicNoteRecord(db, existing.id, {
          title,
          date,
          content: existing.content,
          contentMarkdown,
          linkedObjectIds,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'daily-note': {
        const existing = getDailyNote(db, reference);
        if (!existing) return null;
        const date = await prompt(rl, 'Date', { defaultValue: existing.date, showDefault: true });
        const contentMarkdown = await promptMultiline(rl, 'Content', existing.contentMarkdown);
        const linkedObjectIds = await promptList(rl, 'Linked object IDs (comma separated)', existing.linkedObjectIds);
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateDailyNoteRecord(db, existing.id, {
          date,
          content: existing.content,
          contentMarkdown,
          linkedObjectIds,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'project': {
        const existing = getProject(db, reference);
        if (!existing) return null;
        const name = await prompt(rl, 'Name', { defaultValue: existing.name, showDefault: true });
        const syncPath = await prompt(rl, 'Sync path', { defaultValue: existing.syncPath, showDefault: Boolean(existing.syncPath), allowClear: true });
        const startDate = await prompt(rl, 'Start date (YYYY-MM-DD)', { defaultValue: existing.startDate, showDefault: Boolean(existing.startDate), allowClear: true });
        const endDate = await prompt(rl, 'End date (YYYY-MM-DD)', { defaultValue: existing.endDate, showDefault: Boolean(existing.endDate), allowClear: true });
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateProjectRecord(db, existing.id, {
          name,
          syncPath,
          startDate,
          endDate,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'ref-material': {
        const existing = getRefMat(db, reference);
        if (!existing) return null;
        const name = await prompt(rl, 'Name', { defaultValue: existing.name, showDefault: true });
        const author = await prompt(rl, 'Author (optional)', { defaultValue: existing.author ?? '', showDefault: Boolean(existing.author), allowClear: true });
        const syncPath = await prompt(rl, 'Sync path', { defaultValue: existing.syncPath, showDefault: Boolean(existing.syncPath), allowClear: true });
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateRefMatRecord(db, existing.id, {
          name,
          author,
          syncPath,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'habit': {
        const existing = getHabit(db, reference);
        if (!existing) return null;
        const text = await prompt(rl, 'Habit text', { defaultValue: existing.text, showDefault: true });
        const date = await prompt(rl, 'Date', { defaultValue: existing.date, showDefault: true });
        const tags = await promptList(rl, 'Tags (comma separated)', existing.tags);
        return updateHabitRecord(db, existing.id, {
          text,
          date,
          tags,
          updatedAt: getIsoNow(),
        });
      }
      case 'tag': {
        const existing = getTag(db, reference);
        if (!existing) return null;
        const displayName = await prompt(rl, 'Tag name', { defaultValue: existing.displayName, showDefault: true });
        return updateTagRecord(db, existing.id, { displayName });
      }
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

async function runSettings(args, rl) {
  const action = normalize(args[0]).toLowerCase();
  const target = normalize(args[1]).toLowerCase();

  if (!action || action === 'show') {
    console.log(formatCompact(getSettingsState()));
    return;
  }

  if (action === 'set' && target === 'root-folder') {
    let folder = normalize(args[2]);
    if (!folder && rl) {
      folder = await prompt(rl, 'Sync root folder path (e.g. /PuzzlePKM)', { required: true });
    }
    if (!folder) throw new Error('Root folder path is required.');
    saveSyncRootFolder(folder);
    console.log(formatCompact(getSettingsState()));
    return;
  }

  throw new Error('Unknown settings command');
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

  if (action === 'add') {
    const text = args.join(' ').trim();
    if (!text) throw new Error(`Please provide note text: ${PRIMARY_CLI_COMMAND} add <text>`);
    const created = withDb((db) => createTopicNoteRecord(db, {
      id: randomUUID(),
      title: titleFromText(text),
      content: {},
      contentMarkdown: text,
      linkedObjectIds: [],
      tags: [],
      createdAt: getIsoNow(),
      updatedAt: getIsoNow(),
    }));
    console.log(`Added topic note ${created.id}`);
    return;
  }

  if (action === 'list') {
    const type = resolveType(args[0] ?? 'topic-note');
    if (!type) throw new Error(`Unknown type: ${args[0]}`);
    printRecords(type, listObjects(type));
    return;
  }

  // DEC-18: Non-interactive write command for desktop UI integration.
  // Usage: puzzlepkm write <type> <json-string>
  // Creates or updates the object based on presence of a matching id/date.
  if (action === 'write') {
    const type = resolveType(args[0]);
    const jsonStr = args.slice(1).join(' ');
    if (!type || !jsonStr) throw new Error(`Usage: ${PRIMARY_CLI_COMMAND} write <type> <json>`);
    let input;
    try {
      input = JSON.parse(jsonStr);
    } catch {
      throw new Error('Invalid JSON input for write command');
    }
    const now = getIsoNow();
    const result = withDb((db) => {
      switch (type) {
        case 'topic-note': {
          const id = input.id;
          if (id && getTopicNote(db, id)) {
            return updateTopicNoteRecord(db, id, {
              title: input.title,
              date: input.date,
              contentMarkdown: input.contentMarkdown,
              blocks: input.blocks,
              linkedObjectIds: input.linkedObjectIds,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return createTopicNoteRecord(db, {
            id: id ?? randomUUID(),
            title: input.title ?? 'Untitled',
            date: input.date ?? '',
            content: {},
            contentMarkdown: input.contentMarkdown ?? '',
            blocks: input.blocks,
            linkedObjectIds: input.linkedObjectIds ?? [],
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'daily-note': {
          const date = input.date;
          if (!date) throw new Error('daily-note write requires a date field');
          const existingRow = db.prepare('SELECT id FROM daily_notes WHERE date = ?').get(date);
          const existingById = input.id ? getDailyNote(db, input.id) : null;
          if (existingById) {
            return updateDailyNoteRecord(db, input.id, {
              date: input.date,
              contentMarkdown: input.contentMarkdown,
              blocks: input.blocks,
              linkedObjectIds: input.linkedObjectIds,
              tags: input.tags,
              updatedAt: now,
            });
          }
          if (existingRow?.id) {
            throw new Error(`A daily note already exists for ${date}. Open that note instead of creating a new one.`);
          }
          return createDailyNoteRecord(db, {
            id: input.id ?? randomUUID(),
            date,
            content: {},
            contentMarkdown: input.contentMarkdown ?? '',
            blocks: input.blocks,
            linkedObjectIds: input.linkedObjectIds ?? [],
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'project': {
          const id = input.id;
          if (id && getProject(db, id)) {
            return updateProjectRecord(db, id, {
              name: input.name,
              syncPath: input.syncPath,
              startDate: input.startDate,
              endDate: input.endDate,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return createProjectRecord(db, {
            id: id ?? randomUUID(),
            name: input.name ?? 'Untitled',
            syncPath: input.syncPath ?? '',
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'ref-material': {
          const id = input.id;
          if (id && getRefMat(db, id)) {
            return updateRefMatRecord(db, id, {
              name: input.name,
              author: input.author,
              syncPath: input.syncPath,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return createRefMatRecord(db, {
            id: id ?? randomUUID(),
            name: input.name ?? 'Untitled',
            author: input.author ?? '',
            syncPath: input.syncPath ?? '',
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        case 'habit': {
          const id = input.id;
          if (id && getHabit(db, id)) {
            return updateHabitRecord(db, id, {
              text: input.text,
              date: input.date,
              status: input.status,
              tags: input.tags,
              updatedAt: now,
            });
          }
          return createHabitRecord(db, {
            id: id ?? randomUUID(),
            text: input.text ?? '',
            date: input.date ?? localDateString(),
            status: input.status ?? HABIT_STATUS_PLANNED,
            tags: input.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
        }
        default:
          throw new Error(`Unsupported type for write: ${type}`);
      }
    });
    console.log(formatCompact(result));
    return;
  }

  if (action === 'get') {
    const type = resolveType(args[0]);
    const reference = args[1];
    if (!type || !reference) throw new Error(`Usage: ${PRIMARY_CLI_COMMAND} get <type> <id-or-date>`);
    const record = getObject(type, reference);
    if (!record) throw new Error(`${type} not found: ${reference}`);
    console.log(formatCompact(record));
    return;
  }

  if (action === 'create') {
    const type = resolveType(args[0]);
    if (!type) throw new Error(`Usage: ${PRIMARY_CLI_COMMAND} create <type>`);
    const promptRl = rl ?? createPromptInterface();
    try {
      const created = await createObjectInteractive(type, promptRl);
      console.log(formatCompact(created));
    } finally {
      if (!rl) promptRl.close();
    }
    return;
  }

  if (action === 'import') {
    const type = resolveType(args[0]);
    const directory = args[1];
    if ((type !== 'daily-note' && type !== 'topic-note') || !directory) {
      throw new Error(`Usage: ${PRIMARY_CLI_COMMAND} import <daily-note|topic-note> <directory>`);
    }
    console.log(formatCompact(importNotesFromDirectory(type, directory)));
    return;
  }

  if (action === 'update') {
    const type = resolveType(args[0]);
    const reference = args[1];
    if (!type || !reference) throw new Error(`Usage: ${PRIMARY_CLI_COMMAND} update <type> <id-or-date>`);
    const promptRl = rl ?? createPromptInterface();
    try {
      const updated = await updateObjectInteractive(type, reference, promptRl);
      if (!updated) throw new Error(`${type} not found: ${reference}`);
      console.log(formatCompact(updated));
    } finally {
      if (!rl) promptRl.close();
    }
    return;
  }

  if (action === 'delete' || action === 'remove') {
    const type = action === 'remove' ? 'topic-note' : resolveType(args[0]);
    const reference = action === 'remove' ? args[0] : args[1];

    if (!type || !reference) {
      const usage = action === 'remove'
        ? `Usage: ${PRIMARY_CLI_COMMAND} remove <id> or ${PRIMARY_CLI_COMMAND} delete <type> <id-or-date>`
        : `Usage: ${PRIMARY_CLI_COMMAND} delete <type> <id-or-date>`;
      throw new Error(usage);
    }

    const remoteDeleteTarget = withDb((db) => {
      const rootFolder = getSyncRootFolder();
      switch (type) {
        case 'daily-note': {
          const existing = getDailyNote(db, reference);
          if (!existing) return null;
          if (!isDailyNoteDeleteEligible(db, existing.id)) {
            throw new Error(`Cannot delete daily note ${existing.date}: clear content/tags and remove links/backlinks first.`);
          }
          return {
            path: existing.syncPath || dailyNoteSyncPath(rootFolder, existing.date),
            requiresRemoteDelete: hasKnownRemoteCopy(db, 'daily-note', existing.id),
          };
        }
        case 'topic-note': {
          const existing = getTopicNote(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || topicNoteSyncPath(rootFolder, existing.title, existing.id),
            requiresRemoteDelete: hasKnownRemoteCopy(db, 'topic-note', existing.id),
          };
        }
        case 'habit': {
          const existing = getHabit(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || habitSyncPath(rootFolder, existing.id, existing.date, existing.tags ?? []),
            requiresRemoteDelete: hasKnownRemoteCopy(db, 'habit', existing.id),
          };
        }
        case 'project': {
          const existing = getProject(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || '',
            requiresRemoteDelete: hasKnownRemoteCopy(db, 'project', existing.id),
          };
        }
        case 'ref-material': {
          const existing = getRefMat(db, reference);
          if (!existing) return null;
          return {
            path: existing.syncPath || '',
            requiresRemoteDelete: hasKnownRemoteCopy(db, 'ref-material', existing.id),
          };
        }
        default:
          return null;
      }
    });

    if (remoteDeleteTarget?.path) {
      await deleteSyncPath(remoteDeleteTarget.path);
    }

    const deleted = withDb((db) => {
      switch (type) {
        case 'topic-note': return deleteTopicNoteRecord(db, reference);
        case 'daily-note': return deleteDailyNoteRecord(db, reference);
        case 'project': return deleteProjectRecord(db, reference);
        case 'ref-material': return deleteRefMatRecord(db, reference);
        case 'habit': return deleteHabitRecord(db, reference);
        case 'tag': return deleteTagRecord(db, reference);
        case 'link': return deleteLinkRecord(db, reference);
        default: throw new Error(`Unsupported type: ${type}`);
      }
    });

    if (!deleted) throw new Error(`${type} not found: ${reference}`);
    console.log(`Deleted ${type} ${reference}`);
    return;
  }

  if (action === 'browse') {
    browseTarget(args[0] ?? 'all', args[1]);
    return;
  }

  if (action === 'settings') {
    await runSettings(args, rl);
    return;
  }

  if (action === 'sync') {
    const watch = args.includes('--watch') || args.includes('--daemon');
    const intervalIdx = args.findIndex((a) => a === '--interval');
    const intervalMinutes = intervalIdx >= 0
      ? (parseInt(args[intervalIdx + 1], 10) || SYNC_INTERVAL_MINUTES_DEFAULT)
      : SYNC_INTERVAL_MINUTES_DEFAULT;

    if (watch) {
      await runSyncWatch(intervalMinutes);
      return;
    }

    console.log('Syncing with local folder...');
    const result = await runSync();
    console.log(`Sync complete — imported: ${result.imported}, updated: ${result.updated}, uploaded: ${result.uploaded}, deleted: ${result.deleted}, warnings: ${result.warnings.length}, errors: ${result.errors.length}`);
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.warn(`  [warning] ${warning}`);
      }
    }
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(`  [error] ${error}`);
      }
    }
    return;
  }

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

async function main() {
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

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

export const __testing = {
  openDb,
  runSync,
  saveSyncToken,
  saveSyncRootFolder,
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

if (isDirectExecution) {
  await main();
}
