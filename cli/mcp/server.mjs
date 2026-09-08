#!/usr/bin/env node
/**
 * PuzzlePKM MCP server.
 *
 * Exposes the local PuzzlePKM knowledge base over the Model Context Protocol
 * so an assistant can search notes, walk the link graph, read scripture
 * citations, and review habit history without anything leaving the machine.
 *
 * Everything routes through `mcpInternals` in cli/app.mjs, which is the same
 * repository and service layer the CLI and desktop UI use. That matters most
 * for writes: block persistence, reciprocal backlinks, scripture extraction,
 * and folder sync paths are all invariants owned by those repositories, and a
 * server that talked to SQLite directly would silently break them.
 *
 * Writes are off unless PUZZLEPKM_MCP_ALLOW_WRITES is truthy.
 *
 * Transport is newline-delimited JSON-RPC 2.0 over stdio. This is implemented
 * inline rather than via @modelcontextprotocol/sdk to keep PuzzlePKM's
 * dependency tree unchanged — the protocol surface an stdio server needs is
 * small and stable.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import process, { stdin, stdout, stderr } from 'node:process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { mcpInternals } from '../app.mjs';

const {
  PRIMARY_PRODUCT_NAME,
  HABIT_STATUS_PLANNED,
  HABIT_STATUS_ACCOMPLISHED,
  SCRIPTURE_TYPE,
  dbFile,
  withDb,
  getIsoNow,
  localDateString,
  resolveType,
  getSyncRootFolder,
  objectTypeAliasMap,
  listObjects,
  getObject,
  getRelatedObjects,
  createTopicNoteRecord,
  updateTopicNoteRecord,
  getTopicNote,
  listTopicNotes,
  ensureDailyNoteForDate,
  updateDailyNoteRecord,
  getDailyNote,
  createHabitRecord,
  updateHabitRecord,
  getHabit,
  listHabits,
  listTags,
  listScriptures,
  getScripture,
  searchDocuments,
  listIndexedDocuments,
  getIndexedDocument,
  documentIndexStatus,
  runSync,
} = mcpInternals;

const SERVER_NAME = 'puzzlepkm';
const SERVER_VERSION = '1.0.0';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const NOTE_TYPES = new Set(['topic-note', 'daily-note']);
const MAX_SNIPPET_LENGTH = 240;
const DEFAULT_SEARCH_LIMIT = 25;
const DEFAULT_LIST_LIMIT = 50;
const MAX_GRAPH_DEPTH = 3;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ALLOW_WRITES = /^(1|true|yes|on)$/i.test(String(process.env.PUZZLEPKM_MCP_ALLOW_WRITES ?? '').trim());

// Checked once, before anything opens a handle: node:sqlite creates the file on
// open, so after the first query a wrong path is indistinguishable from an
// empty knowledge base.
const databaseExistedAtStartup = existsSync(dbFile);

// The repositories and sync routines log progress with console.log. On an stdio
// transport stdout is the protocol channel, so anything printed there corrupts
// the stream. Redirect the console to stderr before any handler can run.
function redirectConsoleToStderr() {
  const write = (args) => {
    const line = args
      .map((value) => (typeof value === 'string' ? value : safeStringify(value)))
      .join(' ');
    stderr.write(`${line}\n`);
  };
  console.log = (...args) => write(args);
  console.info = (...args) => write(args);
  console.warn = (...args) => write(args);
  console.debug = (...args) => write(args);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── Small shared helpers ────────────────────────────────────────────────────

function requireWrites(toolName) {
  if (ALLOW_WRITES) return;
  throw new Error(
    `${toolName} is disabled. ${PRIMARY_PRODUCT_NAME} MCP writes are off by default; turn on "Allow writes" in the extension settings (or set PUZZLEPKM_MCP_ALLOW_WRITES=true) and restart to enable it.`,
  );
}

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function clampLimit(value, fallback, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function requireLocalDate(value, label) {
  const normalized = normalizeString(value);
  if (!LOCAL_DATE_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a YYYY-MM-DD date (received "${value ?? ''}").`);
  }
  return normalized;
}

function requireKind(value) {
  const resolved = resolveType(value);
  if (!resolved) {
    const known = Array.from(new Set(objectTypeAliasMap.values())).join(', ');
    throw new Error(`Unknown object kind "${value}". Known kinds: ${known}.`);
  }
  return resolved;
}

function snippetAround(haystack, needle) {
  const source = String(haystack ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const index = source.toLowerCase().indexOf(String(needle ?? '').toLowerCase());
  if (index < 0) return source.slice(0, MAX_SNIPPET_LENGTH);
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + MAX_SNIPPET_LENGTH - 60);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

function likePattern(query) {
  // Escape LIKE wildcards so a query such as "50%" is matched literally.
  return `%${String(query).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function shiftDate(date, deltaDays) {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function summarizeObject(row, kind) {
  switch (kind) {
    case 'topic-note':
      return { id: row.id, kind, title: row.title, date: row.date, tags: row.tags, updatedAt: row.updatedAt };
    case 'daily-note':
      return { id: row.id, kind, date: row.date, tags: row.tags, updatedAt: row.updatedAt };
    case 'habit':
      return { id: row.id, kind, text: row.text, date: row.date, status: row.status, tags: row.tags };
    case 'project':
    case 'ref-material':
      return { id: row.id, kind, name: row.name, author: row.author, tags: row.tags, updatedAt: row.updatedAt };
    case 'scripture':
      return { id: row.id, kind, reference: row.reference, bookName: row.book_name ?? row.bookName, noteCount: row.note_count ?? row.noteCount };
    case 'tag':
      return { id: row.id, kind, displayName: row.displayName ?? row.display_name, usageCount: row.usageCount };
    default:
      return { ...row, kind };
  }
}

// ── Read tools ──────────────────────────────────────────────────────────────

function searchKnowledgeBase({ query, kinds, limit }) {
  const needle = normalizeString(query);
  if (!needle) throw new Error('query is required.');
  const max = clampLimit(limit, DEFAULT_SEARCH_LIMIT);
  const wanted = Array.isArray(kinds) && kinds.length > 0
    // 'document' is not an object type — it is the file text index of DEC-79 —
    // so it bypasses object-kind resolution.
    ? new Set(kinds.map((kind) => (normalizeString(kind) === 'document' ? 'document' : requireKind(kind))))
    : null;
  const wants = (kind) => !wanted || wanted.has(kind);
  const pattern = likePattern(needle);

  return withDb((db) => {
    const results = [];

    if (wants('topic-note')) {
      const rows = db.prepare(`
        SELECT id, title, date, updated_at FROM topic_notes
        WHERE title LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC LIMIT ?
      `).all(pattern, max);
      for (const row of rows) {
        results.push({
          kind: 'topic-note',
          id: row.id,
          matchedOn: 'title',
          title: row.title,
          date: row.date || '',
          snippet: snippetAround(row.title, needle),
          updatedAt: row.updated_at,
        });
      }
    }

    // Block-level hits are the useful ones for a PKM: they point at the exact
    // paragraph, and block ids are addressable elsewhere in the app.
    const blockRows = db.prepare(`
      SELECT b.note_id, b.block_id, b.note_type, b.position, b.content_markdown, b.updated_at,
             t.title AS topic_title, d.date AS daily_date
      FROM note_blocks b
      LEFT JOIN topic_notes t ON t.id = b.note_id
      LEFT JOIN daily_notes d ON d.id = b.note_id
      WHERE b.content_markdown LIKE ? ESCAPE '\\'
      ORDER BY b.updated_at DESC
      LIMIT ?
    `).all(pattern, max * 2);
    for (const row of blockRows) {
      const kind = row.note_type;
      if (!NOTE_TYPES.has(kind) || !wants(kind)) continue;
      results.push({
        kind,
        id: row.note_id,
        matchedOn: 'block',
        blockId: row.block_id,
        position: row.position,
        title: kind === 'topic-note' ? row.topic_title : row.daily_date,
        date: kind === 'daily-note' ? row.daily_date : '',
        snippet: snippetAround(row.content_markdown, needle),
        updatedAt: row.updated_at,
      });
    }

    if (wants('project')) {
      for (const row of db.prepare(`SELECT id, name, updated_at FROM projects WHERE name LIKE ? ESCAPE '\\' LIMIT ?`).all(pattern, max)) {
        results.push({ kind: 'project', id: row.id, matchedOn: 'name', title: row.name, updatedAt: row.updated_at });
      }
    }

    if (wants('ref-material')) {
      for (const row of db.prepare(`
        SELECT id, name, author, updated_at FROM ref_materials
        WHERE name LIKE ? ESCAPE '\\' OR COALESCE(author, '') LIKE ? ESCAPE '\\' LIMIT ?
      `).all(pattern, pattern, max)) {
        results.push({ kind: 'ref-material', id: row.id, matchedOn: 'name/author', title: row.name, author: row.author ?? '', updatedAt: row.updated_at });
      }
    }

    if (wants('habit')) {
      for (const row of db.prepare(`SELECT id, text, date, status FROM habits WHERE text LIKE ? ESCAPE '\\' ORDER BY date DESC LIMIT ?`).all(pattern, max)) {
        results.push({ kind: 'habit', id: row.id, matchedOn: 'text', title: row.text, date: row.date, status: row.status });
      }
    }

    if (wants('scripture')) {
      for (const row of db.prepare(`
        SELECT id, reference, book_name FROM scriptures
        WHERE reference LIKE ? ESCAPE '\\' OR book_name LIKE ? ESCAPE '\\'
        ORDER BY book_order, reference LIMIT ?
      `).all(pattern, pattern, max)) {
        results.push({ kind: 'scripture', id: row.id, matchedOn: 'reference', title: row.reference, bookName: row.book_name });
      }
    }

    if (wants('tag')) {
      for (const row of db.prepare(`SELECT id, display_name FROM tags WHERE display_name LIKE ? ESCAPE '\\' LIMIT ?`).all(pattern, max)) {
        results.push({ kind: 'tag', id: row.id, matchedOn: 'name', title: row.display_name });
      }
    }

    // DEC-79: the text inside project and reference-material documents, which
    // is where a lot of a knowledge base actually lives.
    if (wants('document')) {
      for (const match of searchDocuments(needle, { limit: max })) {
        results.push({
          kind: 'document',
          id: match.id,
          matchedOn: 'content',
          title: match.fileName,
          snippet: match.snippet,
          parent: { kind: match.objectType, id: match.objectId, name: match.objectName },
          relativePath: match.relativePath,
          filePath: match.filePath,
        });
      }
    }

    return {
      query: needle,
      matchCount: Math.min(results.length, max),
      truncated: results.length > max,
      results: results.slice(0, max),
    };
  });
}

/**
 * DEC-79: the file text index. Search here when the answer is likely to be in
 * a PDF, Word document or Markdown file rather than in a note.
 */
function searchDocumentsTool({ query, limit, parent_id: parentId, parent_kind: parentKind }) {
  const needle = normalizeString(query);
  if (!needle) throw new Error('query is required.');
  const matches = searchDocuments(needle, {
    limit: clampLimit(limit, DEFAULT_SEARCH_LIMIT),
    objectId: normalizeString(parentId) || undefined,
    objectType: parentKind ? requireKind(parentKind) : undefined,
  });
  return { query: needle, matchCount: matches.length, results: matches };
}

function getDocumentTextTool({ id, max_characters: maxCharacters }) {
  const reference = normalizeString(id);
  if (!reference) throw new Error('id is required.');
  const document = getIndexedDocument(reference, { maxCharacters: Number.parseInt(maxCharacters, 10) || 0 });
  if (!document) throw new Error(`No indexed document found for "${reference}". Use search_documents to find one.`);
  return document;
}

function listDocumentsTool({ parent_id: parentId, limit }) {
  const documents = listIndexedDocuments({
    objectId: normalizeString(parentId) || undefined,
    limit: clampLimit(limit, DEFAULT_LIST_LIMIT),
  });
  return { total: documents.length, index: documentIndexStatus(), documents };
}

function listObjectsTool({ kind, limit, offset }) {
  const resolved = requireKind(kind);
  const max = clampLimit(limit, DEFAULT_LIST_LIMIT);
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);
  const rows = listObjects(resolved);
  return {
    kind: resolved,
    total: rows.length,
    offset: start,
    returned: Math.min(max, Math.max(0, rows.length - start)),
    objects: rows.slice(start, start + max).map((row) => summarizeObject(row, resolved)),
  };
}

function getObjectTool({ kind, id }) {
  const resolved = requireKind(kind);
  const reference = normalizeString(id);
  if (!reference) throw new Error('id is required.');
  const object = getObject(resolved, reference);
  if (!object) throw new Error(`No ${resolved} found for "${reference}".`);
  return object;
}

/**
 * The note-centric view: the note's own content plus everything hanging off it.
 * This is the tool to reach for before answering a question about a note, since
 * one call replaces get_object + get_backlinks + a tag lookup.
 */
function getNoteContext({ id, include_block_text: includeBlockText = true }) {
  const reference = normalizeString(id);
  if (!reference) throw new Error('id is required.');
  return withDb((db) => {
    const note = getTopicNote(db, reference) ?? getDailyNote(db, reference);
    if (!note) throw new Error(`No topic note or daily note found for "${reference}". Daily notes may be referenced by date.`);
    const backlinks = getRelatedObjects(db, note.id, 'backward');
    const links = getRelatedObjects(db, note.id, 'forward');
    const scriptures = links.filter((item) => item.type === SCRIPTURE_TYPE);
    return {
      note: {
        id: note.id,
        kind: note.type,
        title: note.title ?? note.date,
        date: note.date ?? '',
        tags: note.tags ?? [],
        syncPath: note.syncPath ?? '',
        contentMarkdown: note.contentMarkdown ?? '',
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
      blocks: includeBlockText
        ? (note.blocks ?? []).map((block) => ({ blockId: block.id ?? block.blockId, markdown: block.contentMarkdown ?? block.markdown ?? '' }))
        : (note.blocks ?? []).length,
      outboundLinks: links,
      backlinks,
      scripturesCited: scriptures,
      counts: { outbound: links.length, backlinks: backlinks.length, scriptures: scriptures.length },
    };
  });
}

function getDailyNoteTool({ date }) {
  const target = date ? requireLocalDate(date, 'date') : localDateString();
  return withDb((db) => {
    const note = getDailyNote(db, target);
    if (!note) return { date: target, exists: false, hint: 'Use append_to_daily_note to create it (requires writes enabled).' };
    return {
      date: target,
      exists: true,
      id: note.id,
      tags: note.tags ?? [],
      contentMarkdown: note.contentMarkdown ?? '',
      links: note.links ?? [],
      backlinks: note.backlinks ?? [],
      updatedAt: note.updatedAt,
    };
  });
}

function getBacklinks({ id }) {
  const reference = normalizeString(id);
  if (!reference) throw new Error('id is required.');
  return withDb((db) => ({
    id: reference,
    backlinks: getRelatedObjects(db, reference, 'backward'),
    outboundLinks: getRelatedObjects(db, reference, 'forward'),
  }));
}

/**
 * Breadth-first walk of object_links in both directions. PuzzlePKM's graph view
 * is a headline feature; this is the text equivalent, so an assistant can reason
 * about how an idea connects rather than fetching notes one at a time.
 */
function getGraphNeighborhood({ id, depth }) {
  const rootId = normalizeString(id);
  if (!rootId) throw new Error('id is required.');
  const maxDepth = Math.min(MAX_GRAPH_DEPTH, Math.max(1, Number.parseInt(depth, 10) || 1));

  return withDb((db) => {
    const nodes = new Map();
    const edges = [];
    const edgeKeys = new Set();
    let frontier = [rootId];
    const visited = new Set([rootId]);

    for (let level = 1; level <= maxDepth; level += 1) {
      const nextFrontier = [];
      for (const nodeId of frontier) {
        for (const direction of ['forward', 'backward']) {
          for (const related of getRelatedObjects(db, nodeId, direction)) {
            const edgeKey = direction === 'forward' ? `${nodeId}->${related.id}` : `${related.id}->${nodeId}`;
            if (!edgeKeys.has(edgeKey)) {
              edgeKeys.add(edgeKey);
              edges.push(direction === 'forward'
                ? { from: nodeId, to: related.id, toKind: related.type }
                : { from: related.id, to: nodeId, fromKind: related.type });
            }
            if (visited.has(related.id)) continue;
            visited.add(related.id);
            nodes.set(related.id, { ...related, distance: level });
            nextFrontier.push(related.id);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return {
      rootId,
      depth: maxDepth,
      nodeCount: nodes.size,
      edgeCount: edges.length,
      nodes: Array.from(nodes.values()),
      edges,
    };
  });
}

/**
 * Scriptures are derived objects — PuzzlePKM extracts them from note bodies —
 * so the interesting question is always "where have I written about this
 * passage", which is what linkedNotes answers.
 */
function listScriptureReferences({ book, reference, limit }) {
  const max = clampLimit(limit, DEFAULT_LIST_LIMIT);
  const bookFilter = normalizeString(book).toLowerCase();
  const referenceFilter = normalizeString(reference).toLowerCase();

  return withDb((db) => {
    let rows = listScriptures(db);
    if (bookFilter) rows = rows.filter((row) => String(row.book_name ?? row.bookName ?? '').toLowerCase().includes(bookFilter));
    if (referenceFilter) rows = rows.filter((row) => String(row.reference ?? '').toLowerCase().includes(referenceFilter));
    const selected = rows.slice(0, max);
    return {
      total: rows.length,
      returned: selected.length,
      scriptures: selected.map((row) => {
        const detail = getScripture(db, row.id);
        return {
          id: row.id,
          reference: row.reference,
          bookName: row.book_name ?? row.bookName,
          passageUrl: row.passage_url ?? row.passageUrl,
          noteCount: row.note_count ?? detail?.linkedNotes?.length ?? 0,
          linkedNotes: detail?.linkedNotes ?? [],
        };
      }),
    };
  });
}

/**
 * Habit history with streaks computed per habit text, which is how a person
 * actually thinks about a habit ("did I keep up morning prayer?") even though
 * the schema stores one row per habit per day.
 */
function getHabitLog({ from, to, tag, limit }) {
  const today = localDateString();
  const toDate = to ? requireLocalDate(to, 'to') : today;
  const fromDate = from ? requireLocalDate(from, 'from') : shiftDate(toDate, -29);
  if (daysBetween(fromDate, toDate) < 0) throw new Error('"from" must be on or before "to".');
  const tagFilter = normalizeString(tag).toLowerCase();
  const max = clampLimit(limit, 500, 2000);

  return withDb((db) => {
    let rows = listHabits(db).filter((row) => row.date >= fromDate && row.date <= toDate);
    if (tagFilter) {
      rows = rows.filter((row) => (row.tags ?? []).some((name) => String(name).toLowerCase() === tagFilter));
    }
    rows = rows.slice(0, max);

    const byText = new Map();
    for (const row of rows) {
      const key = row.text;
      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(row);
    }

    const habits = Array.from(byText.entries()).map(([habitText, entries]) => {
      const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
      const accomplished = sorted.filter((entry) => entry.status === HABIT_STATUS_ACCOMPLISHED);
      // Current streak: consecutive accomplished days ending at the most recent
      // entry, allowing the run to start either today or yesterday.
      let streak = 0;
      let cursor = sorted[0]?.date ?? null;
      if (cursor && (cursor === toDate || cursor === shiftDate(toDate, -1))) {
        const statusByDate = new Map(sorted.map((entry) => [entry.date, entry.status]));
        while (statusByDate.get(cursor) === HABIT_STATUS_ACCOMPLISHED) {
          streak += 1;
          cursor = shiftDate(cursor, -1);
        }
      }
      return {
        text: habitText,
        tags: sorted[0]?.tags ?? [],
        tracked: sorted.length,
        accomplished: accomplished.length,
        planned: sorted.length - accomplished.length,
        completionRate: sorted.length ? Number((accomplished.length / sorted.length).toFixed(2)) : 0,
        currentStreak: streak,
        lastDate: sorted[0]?.date ?? null,
        entries: sorted.map((entry) => ({ id: entry.id, date: entry.date, status: entry.status })),
      };
    }).sort((a, b) => b.tracked - a.tracked);

    return { range: { from: fromDate, to: toDate }, distinctHabits: habits.length, totalEntries: rows.length, habits };
  });
}

function listTagsTool({ limit }) {
  const max = clampLimit(limit, 200, 1000);
  return withDb((db) => {
    const usage = db.prepare(`
      SELECT tag_id, object_type, COUNT(*) AS uses
      FROM object_tags GROUP BY tag_id, object_type
    `).all();
    const usageByTag = new Map();
    for (const row of usage) {
      if (!usageByTag.has(row.tag_id)) usageByTag.set(row.tag_id, { total: 0, byKind: {} });
      const entry = usageByTag.get(row.tag_id);
      entry.total += row.uses;
      entry.byKind[row.object_type] = row.uses;
    }
    const tags = listTags(db).map((tag) => {
      const entry = usageByTag.get(tag.id) ?? { total: 0, byKind: {} };
      return { id: tag.id, displayName: tag.displayName ?? tag.display_name, usageCount: entry.total, usageByKind: entry.byKind };
    }).sort((a, b) => b.usageCount - a.usageCount);
    return { total: tags.length, tags: tags.slice(0, max) };
  });
}

/**
 * Health check for the knowledge base. Beyond raw counts this surfaces the
 * things that quietly rot in a PKM: notes with no links, notes sitting in
 * Inbox, and objects that have never been written to the sync folder.
 */
function getStatus() {
  return withDb((db) => {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const counts = {
      'topic-note': count('topic_notes'),
      'daily-note': count('daily_notes'),
      project: count('projects'),
      'ref-material': count('ref_materials'),
      habit: count('habits'),
      scripture: count('scriptures'),
      tag: count('tags'),
      link: count('object_links'),
      block: count('note_blocks'),
      document: count('document_texts'),
    };

    const orphanNotes = db.prepare(`
      SELECT COUNT(*) AS n FROM topic_notes t
      WHERE NOT EXISTS (SELECT 1 FROM object_links l WHERE l.source_id = t.id OR l.target_id = t.id)
    `).get().n;
    const untagged = db.prepare(`
      SELECT COUNT(*) AS n FROM topic_notes t
      WHERE NOT EXISTS (SELECT 1 FROM object_tags o WHERE o.object_id = t.id)
    `).get().n;
    const inbox = db.prepare(`
      SELECT COUNT(*) AS n FROM object_tags o
      JOIN tags g ON g.id = o.tag_id
      WHERE g.name = 'inbox'
    `).get().n;
    const neverSynced = db.prepare(`
      SELECT COUNT(*) AS n FROM topic_notes t
      LEFT JOIN sync_state s ON s.object_id = t.id
      WHERE s.object_id IS NULL OR s.has_remote_copy = 0
    `).get().n;
    const latestTopic = db.prepare('SELECT title, updated_at FROM topic_notes ORDER BY updated_at DESC LIMIT 1').get();
    const latestDaily = db.prepare('SELECT date, updated_at FROM daily_notes ORDER BY date DESC LIMIT 1').get();
    const pendingHabits = db.prepare(`SELECT COUNT(*) AS n FROM habits WHERE status = ? AND date <= ?`).get(HABIT_STATUS_PLANNED, localDateString()).n;

    return {
      product: PRIMARY_PRODUCT_NAME,
      databasePath: dbFile,
      // Opening a database creates it when absent, so an empty knowledge base
      // and a misconfigured path look identical without this flag.
      databaseExistedBeforeThisSession: databaseExistedAtStartup,
      syncRootFolder: getSyncRootFolder(),
      writesEnabled: ALLOW_WRITES,
      today: localDateString(),
      counts,
      attention: {
        topicNotesWithNoLinks: orphanNotes,
        untaggedTopicNotes: untagged,
        objectsTaggedInbox: inbox,
        topicNotesNotInSyncFolder: neverSynced,
        habitsPlannedAndDue: pendingHabits,
      },
      mostRecent: {
        topicNote: latestTopic ? { title: latestTopic.title, updatedAt: latestTopic.updated_at } : null,
        dailyNote: latestDaily ? { date: latestDaily.date, updatedAt: latestDaily.updated_at } : null,
      },
    };
  });
}

/**
 * Notes not touched in a while, which is the "resurface what I forgot" query a
 * PKM is for. Excludes daily notes, which are expected to go stale by design.
 */
function findStaleNotes({ older_than_days: olderThanDays, limit }) {
  const days = Math.max(1, Number.parseInt(olderThanDays, 10) || 90);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const max = clampLimit(limit, 25);
  return withDb((db) => {
    const rows = db.prepare(`
      SELECT t.id, t.title, t.date, t.updated_at,
             (SELECT COUNT(*) FROM object_links l WHERE l.source_id = t.id OR l.target_id = t.id) AS link_count
      FROM topic_notes t
      WHERE t.updated_at < ?
      ORDER BY t.updated_at ASC
      LIMIT ?
    `).all(cutoff, max);
    const tagsById = new Map(listTopicNotes(db).map((note) => [note.id, note.tags ?? []]));
    return {
      olderThanDays: days,
      cutoff,
      returned: rows.length,
      notes: rows.map((row) => ({
        id: row.id,
        title: row.title,
        date: row.date || '',
        tags: tagsById.get(row.id) ?? [],
        linkCount: row.link_count,
        updatedAt: row.updated_at,
        daysSinceUpdate: Math.floor((Date.now() - Date.parse(row.updated_at)) / 86_400_000),
      })),
    };
  });
}

// ── Write tools (gated) ─────────────────────────────────────────────────────

function createTopicNote({ title, markdown, tags, date }) {
  requireWrites('create_topic_note');
  const noteTitle = normalizeString(title);
  if (!noteTitle) throw new Error('title is required.');
  const noteDate = date ? requireLocalDate(date, 'date') : '';
  const now = getIsoNow();
  return withDb((db) => createTopicNoteRecord(db, {
    id: randomUUID(),
    title: noteTitle,
    date: noteDate,
    content: {},
    contentMarkdown: String(markdown ?? ''),
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag)) : [],
    linkedObjectIds: [],
    createdAt: now,
    updatedAt: now,
  }));
}

function updateTopicNote({ id, title, markdown, tags }) {
  requireWrites('update_topic_note');
  const noteId = normalizeString(id);
  if (!noteId) throw new Error('id is required.');
  const patch = {};
  if (title !== undefined) patch.title = normalizeString(title);
  if (markdown !== undefined) patch.contentMarkdown = String(markdown);
  if (Array.isArray(tags)) patch.tags = tags.map((tag) => String(tag));
  if (Object.keys(patch).length === 0) throw new Error('Provide at least one of title, markdown, or tags.');
  return withDb((db) => {
    const updated = updateTopicNoteRecord(db, noteId, patch);
    if (!updated) throw new Error(`No topic note found for "${noteId}".`);
    return updated;
  });
}

/**
 * Append rather than replace: a daily note is a running log, and an assistant
 * overwriting the day's entry is the one destructive mistake worth designing out.
 */
function appendToDailyNote({ date, markdown }) {
  requireWrites('append_to_daily_note');
  const body = String(markdown ?? '').trim();
  if (!body) throw new Error('markdown is required.');
  const target = date ? requireLocalDate(date, 'date') : localDateString();
  return withDb((db) => {
    const existing = ensureDailyNoteForDate(db, target);
    if (!existing) throw new Error(`Could not open or create the daily note for ${target}.`);
    const previous = existing.contentMarkdown ?? '';
    const combined = previous.trim() ? `${previous.trimEnd()}\n\n${body}` : body;
    const updated = updateDailyNoteRecord(db, existing.id, { contentMarkdown: combined });
    return {
      date: target,
      id: existing.id,
      created: !previous.trim(),
      appendedCharacters: body.length,
      contentMarkdown: updated?.contentMarkdown ?? combined,
    };
  });
}

function setHabit({ id, text: habitText, date, status, tag }) {
  requireWrites('set_habit');
  const normalizedStatus = normalizeString(status).toLowerCase();
  if (normalizedStatus && normalizedStatus !== HABIT_STATUS_PLANNED && normalizedStatus !== HABIT_STATUS_ACCOMPLISHED) {
    throw new Error(`status must be "${HABIT_STATUS_PLANNED}" or "${HABIT_STATUS_ACCOMPLISHED}".`);
  }
  return withDb((db) => {
    const habitId = normalizeString(id);
    if (habitId) {
      const patch = { updatedAt: getIsoNow() };
      if (habitText !== undefined) patch.text = String(habitText);
      if (normalizedStatus) patch.status = normalizedStatus;
      if (date !== undefined) patch.date = requireLocalDate(date, 'date');
      const updated = updateHabitRecord(db, habitId, patch);
      if (!updated) throw new Error(`No habit found for "${habitId}".`);
      return { action: 'updated', habit: getHabit(db, habitId) };
    }
    const body = normalizeString(habitText);
    if (!body) throw new Error('text is required when creating a habit.');
    const now = getIsoNow();
    // Habits accept at most one tag (DEC-45); the repository enforces this too.
    const created = createHabitRecord(db, {
      id: randomUUID(),
      text: body,
      date: date ? requireLocalDate(date, 'date') : localDateString(),
      status: normalizedStatus || HABIT_STATUS_PLANNED,
      tags: normalizeString(tag) ? [normalizeString(tag)] : [],
      createdAt: now,
      updatedAt: now,
    });
    return { action: 'created', habit: created };
  });
}

async function syncNow() {
  requireWrites('sync_now');
  const result = await runSync();
  return { syncRootFolder: getSyncRootFolder(), ...result };
}

// ── Tool registry ───────────────────────────────────────────────────────────

const KIND_ENUM = ['topic-note', 'daily-note', 'project', 'ref-material', 'habit', 'scripture', 'tag', 'link'];
// Documents are indexed file text rather than an object type, so they widen
// search without becoming a listable/gettable kind.
const SEARCH_KIND_ENUM = [...KIND_ENUM, 'document'];

const TOOLS = [
  {
    name: 'search_knowledge_base',
    description: 'Substring search across the whole PuzzlePKM database — note titles, individual note blocks, project and reference-material names, habit text, scripture references, tags, and the text inside indexed documents (PDF, Word, PowerPoint, Pages, Markdown, plain text). Block matches include the block id and a surrounding snippet. Start here when you do not already know an object id.',
    write: false,
    handler: searchKnowledgeBase,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to look for. Case-insensitive substring match.' },
        kinds: { type: 'array', items: { type: 'string', enum: SEARCH_KIND_ENUM }, description: 'Restrict the search to these object kinds. "document" covers file text inside project and reference-material folders. Omit to search everything.' },
        limit: { type: 'integer', description: `Maximum results to return (default ${DEFAULT_SEARCH_LIMIT}, max 200).` },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_documents',
    description: 'Full-text search inside the files stored in project and reference-material folders — PDFs, Word documents (.doc/.docx), PowerPoint decks, Pages documents, Markdown and plain text, indexed recursively on every sync. Returns the containing object, the path within its folder, and a snippet around the match. Use this when the answer lives in an attachment rather than in a note.',
    write: false,
    handler: searchDocumentsTool,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words or a phrase to look for inside the documents.' },
        parent_id: { type: 'string', description: 'Restrict to one project or reference material by id.' },
        parent_kind: { type: 'string', enum: ['project', 'ref-material'], description: 'Restrict to documents held by projects or by reference materials.' },
        limit: { type: 'integer', description: `Maximum matches to return (default ${DEFAULT_SEARCH_LIMIT}, max 200).` },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_document_text',
    description: 'Read the extracted text of one indexed document by its document id (from search_documents or list_documents). Use it to quote or summarize a PDF or Word file without leaving the machine.',
    write: false,
    handler: getDocumentTextTool,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id from search_documents or list_documents.' },
        max_characters: { type: 'integer', description: 'Truncate the returned text to this many characters. Omit for the whole document.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_documents',
    description: 'List indexed documents with their status, newest first, plus index totals. Good for checking what is searchable — including files that yielded no text, such as scanned PDFs.',
    write: false,
    handler: listDocumentsTool,
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: 'Only documents inside this project or reference material.' },
        limit: { type: 'integer', description: `Maximum documents to return (default ${DEFAULT_LIST_LIMIT}, max 200).` },
      },
    },
  },
  {
    name: 'list_objects',
    description: 'List every object of one kind, newest first, with paging. Use for inventory questions ("how many projects do I have"); use search_knowledge_base to find something specific.',
    write: false,
    handler: listObjectsTool,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KIND_ENUM, description: 'Object kind. Aliases such as "notes" or "topic-notes" are accepted.' },
        limit: { type: 'integer', description: `Maximum objects to return (default ${DEFAULT_LIST_LIMIT}, max 200).` },
        offset: { type: 'integer', description: 'Number of objects to skip, for paging.' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'get_object',
    description: 'Fetch one object in full by kind and id. Daily notes, scriptures, and tags may also be addressed by date, reference string, or name respectively.',
    write: false,
    handler: getObjectTool,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KIND_ENUM, description: 'Object kind.' },
        id: { type: 'string', description: 'Object id, or a natural key: YYYY-MM-DD for a daily note, "John 3:16" for a scripture.' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'get_note_context',
    description: 'Everything around one note in a single call: its markdown, its blocks, its tags, the objects it links out to, the objects that link back to it, and the scriptures it cites. Prefer this over get_object when you need to reason about a note rather than just read it.',
    write: false,
    handler: getNoteContext,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Topic note id, daily note id, or a YYYY-MM-DD date for a daily note.' },
        include_block_text: { type: 'boolean', description: 'Include the markdown of each block. Set false for a lighter response on long notes. Defaults to true.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_daily_note',
    description: "Read the daily note for a date, defaulting to today. Reports exists:false rather than failing when there is no entry for that date.",
    write: false,
    handler: getDailyNoteTool,
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' } },
    },
  },
  {
    name: 'get_backlinks',
    description: 'The objects linking to and from one object. Works for any object kind, not just notes — useful for "what mentions this tag/scripture/project".',
    write: false,
    handler: getBacklinks,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Object id.' } },
      required: ['id'],
    },
  },
  {
    name: 'get_graph_neighborhood',
    description: `Walk the link graph outward from one object, following links in both directions, and return the nodes and edges found. Use to answer "how does this connect to that" or to gather a cluster of related notes. Depth is capped at ${MAX_GRAPH_DEPTH}.`,
    write: false,
    handler: getGraphNeighborhood,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Object id to start from.' },
        depth: { type: 'integer', description: `How many hops to traverse (1-${MAX_GRAPH_DEPTH}, default 1).` },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_scripture_references',
    description: 'Scripture references PuzzlePKM extracted from note bodies, each with the notes that cite it and a passage URL. Filter by book or by reference substring. Scriptures are derived automatically and cannot be created directly.',
    write: false,
    handler: listScriptureReferences,
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', description: 'Filter by book name, e.g. "Romans".' },
        reference: { type: 'string', description: 'Filter by reference substring, e.g. "3:16".' },
        limit: { type: 'integer', description: `Maximum references to return (default ${DEFAULT_LIST_LIMIT}).` },
      },
    },
  },
  {
    name: 'get_habit_log',
    description: 'Habit history over a date range, grouped by habit text, with completion rate and current streak per habit. Defaults to the last 30 days.',
    write: false,
    handler: getHabitLog,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to 29 days before "to".' },
        to: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to today.' },
        tag: { type: 'string', description: 'Only include habits carrying this tag.' },
        limit: { type: 'integer', description: 'Maximum habit entries to consider (default 500).' },
      },
    },
  },
  {
    name: 'list_tags',
    description: 'Every tag with how many objects carry it, broken down by object kind and sorted by usage. Good for understanding how the knowledge base is organized before searching it.',
    write: false,
    handler: listTagsTool,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Maximum tags to return (default 200).' } },
    },
  },
  {
    name: 'find_stale_notes',
    description: 'Topic notes not updated in a while, oldest first, with their link counts — for resurfacing forgotten material. Daily notes are excluded since they are expected to age.',
    write: false,
    handler: findStaleNotes,
    inputSchema: {
      type: 'object',
      properties: {
        older_than_days: { type: 'integer', description: 'Age threshold in days (default 90).' },
        limit: { type: 'integer', description: 'Maximum notes to return (default 25).' },
      },
    },
  },
  {
    name: 'get_status',
    description: 'Health of the knowledge base: database path, sync root folder, whether writes are enabled, object counts, most recent entries, and things needing attention (unlinked notes, untagged notes, Inbox backlog, notes missing from the sync folder, habits still planned and due).',
    write: false,
    handler: getStatus,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_topic_note',
    description: 'Create a topic note from markdown. Wiki-style links, scripture references, and tags in the body are parsed the same way as a note written in the app, so backlinks and scripture objects are created automatically. Requires writes to be enabled.',
    write: true,
    handler: createTopicNote,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title.' },
        markdown: { type: 'string', description: 'Note body as markdown. Scripture references such as "Romans 3:16" are extracted and linked automatically.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag display names. Created if they do not exist.' },
        date: { type: 'string', description: 'Optional YYYY-MM-DD date to associate with the note; links it to that daily note.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_topic_note',
    description: 'Update a topic note title, body, or tags. Supplying markdown replaces the whole body and re-derives links, backlinks, and scripture references. Requires writes to be enabled.',
    write: true,
    handler: updateTopicNote,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Topic note id.' },
        title: { type: 'string', description: 'New title.' },
        markdown: { type: 'string', description: 'Replacement body. Read the note first — this overwrites existing content.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'append_to_daily_note',
    description: "Append markdown to a day's daily note, creating the note if it does not exist yet. Always appends and never overwrites, so it is safe to call repeatedly. Requires writes to be enabled.",
    write: true,
    handler: appendToDailyNote,
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Markdown to append.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'set_habit',
    description: 'Create a habit for a date, or update an existing one by id — including marking it accomplished. Habits carry at most one tag. Requires writes to be enabled.',
    write: true,
    handler: setHabit,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing habit id. Omit to create a new habit.' },
        text: { type: 'string', description: 'Habit text. Required when creating.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today when creating.' },
        status: { type: 'string', enum: [HABIT_STATUS_PLANNED, HABIT_STATUS_ACCOMPLISHED], description: 'Habit status.' },
        tag: { type: 'string', description: 'Single tag display name (habits accept one tag).' },
      },
    },
  },
  {
    name: 'sync_now',
    description: 'Run a one-shot reconciliation between the database and the sync folder on disk, importing filesystem-created projects and reference materials and writing note files out. Returns counts of what was imported and exported. Requires writes to be enabled.',
    write: true,
    handler: syncNow,
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

function toolDescriptors() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.write && !ALLOW_WRITES
      ? `${tool.description} (Currently DISABLED: writes are turned off in this server's settings.)`
      : tool.description,
    inputSchema: tool.inputSchema,
  }));
}

// ── JSON-RPC plumbing ───────────────────────────────────────────────────────

function send(message) {
  stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function negotiateProtocolVersion(requested) {
  const version = normalizeString(requested);
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version) ? version : DEFAULT_PROTOCOL_VERSION;
}

async function handleToolCall(params) {
  const name = normalizeString(params?.name);
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  const args = params?.arguments ?? {};
  const result = await tool.handler(args);
  return text(result);
}

async function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: [
          `${PRIMARY_PRODUCT_NAME} is a local-first personal knowledge base of notes, daily journal entries, habits, projects, reference materials, tags, and automatically extracted scripture references, all connected by a link graph.`,
          'Start with search_knowledge_base or get_status when you do not have an object id. Use get_note_context rather than get_object when reasoning about a note, since it returns backlinks and citations in the same call. The text of PDFs, Word documents, PowerPoint decks, Pages documents, Markdown and plain text inside project and reference-material folders is indexed too: search_documents finds it, and get_document_text reads one in full.',
          ALLOW_WRITES
            ? 'Writes are enabled. append_to_daily_note is always safe; update_topic_note replaces a note body, so read it first.'
            : 'This server is read-only right now. Write tools will refuse until "Allow writes" is turned on in its settings.',
        ].join('\n\n'),
      });
      return;

    case 'ping':
      sendResult(id, {});
      return;

    case 'tools/list':
      sendResult(id, { tools: toolDescriptors() });
      return;

    case 'tools/call':
      try {
        sendResult(id, await handleToolCall(params));
      } catch (error) {
        // Tool failures are reported in-band so the model can read and recover
        // from them, per the MCP spec, rather than as protocol errors.
        sendResult(id, { ...text(`Error: ${error instanceof Error ? error.message : String(error)}`), isError: true });
      }
      return;

    case 'resources/list':
      sendResult(id, { resources: [] });
      return;

    case 'prompts/list':
      sendResult(id, { prompts: [] });
      return;

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

export async function startServer() {
  redirectConsoleToStderr();
  stderr.write(`[${SERVER_NAME}] ready — database ${dbFile}, writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'}\n`);
  if (!databaseExistedAtStartup) {
    stderr.write(`[${SERVER_NAME}] WARNING: no database file at ${dbFile}. An empty one will be created, so every tool will report an empty knowledge base. If ${PRIMARY_PRODUCT_NAME} already has data, either clear the "Database file" setting to use the default location, or point it at the real file.\n`);
  }

  const reader = createInterface({ input: stdin });
  // Requests are handled in arrival order. The SQLite handle is opened and
  // closed per call by withDb, so overlapping handlers would be safe, but
  // serializing keeps write ordering predictable.
  let queue = Promise.resolve();

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      sendError(null, -32700, 'Parse error');
      continue;
    }

    // Notifications carry no id and expect no response.
    if (message.id === undefined || message.id === null) continue;

    queue = queue.then(() => handleRequest(message)).catch((error) => {
      sendError(message.id, -32603, error instanceof Error ? error.message : String(error));
    });
  }

  await queue;
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  startServer().catch((error) => {
    stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
