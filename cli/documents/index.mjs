/* eslint-env node */

// DEC-79: one entry point for turning a file on disk into indexable text.
// Adding a format means adding an entry to DOCUMENT_EXTRACTORS; everything
// downstream (sync scan, storage, search) is format-agnostic.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { extractDocText } from './doc.mjs';
import { extractDocxText } from './docx.mjs';
import { decodeWindows1252 } from './encoding.mjs';
import { extractPagesText } from './pages.mjs';
import { extractPdfText } from './pdf.mjs';
import { extractPptxText } from './pptx.mjs';

/** Files larger than this are recorded as skipped rather than parsed. */
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

/** Upper bound on stored text per document, to keep the database sane. */
export const MAX_DOCUMENT_CHARACTERS = 2_000_000;

// Plain text arrives in whatever the author's editor wrote. UTF-8 is the
// common case, a byte-order mark settles the UTF-16 variants, and a file full
// of replacement characters is the signature of a legacy single-byte encoding.
function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return buffer.subarray(2).swap16().toString('utf16le');
  const body = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.subarray(3)
    : buffer;

  const utf8 = body.toString('utf8');
  const replacements = (utf8.match(/\ufffd/g) ?? []).length;
  if (replacements > 0 && replacements > utf8.length / 200) return decodeWindows1252(body);
  return utf8;
}

// A deck of photographs is a common and legitimate case, so it gets the same
// treatment as a scanned PDF: understood, empty, and said so.
function extractPresentationText(buffer) {
  const text = extractPptxText(buffer);
  return { text, detail: text.trim() ? '' : 'No text on the slides (an image-only deck)' };
}

function extractPlainText(buffer) {
  // Markdown is indexed as written: the punctuation is noise for search, but
  // stripping it would break phrases that legitimately contain it.
  return { text: decodeTextBuffer(buffer) };
}

const DOCUMENT_EXTRACTORS = new Map([
  ['.pdf', (buffer) => {
    const result = extractPdfText(buffer, { maxCharacters: MAX_DOCUMENT_CHARACTERS });
    return {
      text: result.text,
      truncated: result.truncated,
      detail: result.text.trim()
        ? ''
        : (result.encrypted
          ? 'No text layer (the PDF is encrypted)'
          : 'No text layer (scanned or image-only PDF)'),
    };
  }],
  ['.docx', (buffer) => ({ text: extractDocxText(buffer) })],
  ['.docm', (buffer) => ({ text: extractDocxText(buffer) })],
  ['.doc', (buffer) => ({ text: extractDocText(buffer) })],
  ['.pptx', extractPresentationText],
  ['.pptm', extractPresentationText],
  ['.pages', (buffer, context) => extractPagesText(
    context.isDirectory ? context.filePath : buffer,
    { isDirectory: context.isDirectory },
  )],
  ['.md', extractPlainText],
  ['.markdown', extractPlainText],
  ['.txt', extractPlainText],
]);

/**
 * Formats macOS may store as a package directory rather than a single file.
 * The walker hands these over whole instead of descending into them.
 */
export const PACKAGE_DOCUMENT_EXTENSIONS = new Set(['.pages']);

export function isPackageDocument(filePath) {
  return PACKAGE_DOCUMENT_EXTENSIONS.has(extname(String(filePath ?? '')).toLowerCase());
}

/** Extensions this build can read, lowercase and dot-prefixed. */
export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(DOCUMENT_EXTRACTORS.keys());

export function isSupportedDocument(filePath) {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(extname(String(filePath ?? '')).toLowerCase());
}

// Collapse the runs of spaces and blank lines that layout-driven formats
// produce, without losing the line structure that makes snippets readable.
function normalizeExtractedText(text, limit) {
  const normalized = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

/** Total size and newest modification time inside a package directory. */
function packageFingerprint(directory, directoryStats, depth = 0) {
  let size = 0;
  let modifiedMs = directoryStats.mtimeMs;
  if (depth > 3) return { size, modifiedMs };

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return { size, modifiedMs };
  }

  for (const entry of entries) {
    const childPath = join(directory, entry.name);
    let childStats;
    try {
      childStats = statSync(childPath);
    } catch {
      continue;
    }
    if (childStats.isDirectory()) {
      const nested = packageFingerprint(childPath, childStats, depth + 1);
      size += nested.size;
      modifiedMs = Math.max(modifiedMs, nested.modifiedMs);
      continue;
    }
    size += childStats.size;
    modifiedMs = Math.max(modifiedMs, childStats.mtimeMs);
  }
  return { size, modifiedMs };
}

/**
 * Size and modification time the index uses to decide whether a document needs
 * re-reading. Packages report their contents, so editing a file inside one is
 * seen even though the directory entry may not change.
 */
export function documentFingerprint(filePath) {
  const stats = statSync(filePath);
  const fingerprint = stats.isDirectory()
    ? packageFingerprint(filePath, stats)
    : { size: stats.size, modifiedMs: stats.mtimeMs };
  return { size: fingerprint.size, modifiedAt: new Date(fingerprint.modifiedMs).toISOString() };
}

/**
 * Read one file and return its indexable text.
 *
 * Never throws for content reasons: an unreadable or unsupported file comes
 * back with a status and a human-readable detail so the sync report can say
 * what happened instead of failing the whole pass.
 *
 * @returns {{status: 'ok'|'empty'|'unsupported'|'error', text: string, detail: string, truncated: boolean, size: number, modifiedAt: string}}
 */
export function extractDocumentText(filePath) {
  const extension = extname(filePath).toLowerCase();
  const base = { text: '', detail: '', truncated: false, size: 0, modifiedAt: '' };

  let stats;
  try {
    stats = statSync(filePath);
  } catch (error) {
    return { ...base, status: 'error', detail: `Could not read file: ${String(error?.message ?? error)}` };
  }

  // A package is a directory pretending to be a document, so its size and
  // modification time — which the index uses to decide what to re-read — have
  // to come from its contents rather than the directory entry.
  const isDirectory = stats.isDirectory();
  if (isDirectory && !PACKAGE_DOCUMENT_EXTENSIONS.has(extension)) {
    return { ...base, status: 'unsupported', detail: `${basename(filePath)} is a directory` };
  }
  const fingerprint = isDirectory ? packageFingerprint(filePath, stats) : { size: stats.size, modifiedMs: stats.mtimeMs };
  base.size = fingerprint.size;
  base.modifiedAt = new Date(fingerprint.modifiedMs).toISOString();

  const extractor = DOCUMENT_EXTRACTORS.get(extension);
  if (!extractor) {
    return { ...base, status: 'unsupported', detail: `No text extractor for ${extension || basename(filePath)}` };
  }
  if (fingerprint.size > MAX_DOCUMENT_BYTES) {
    return { ...base, status: 'unsupported', detail: `File is larger than the ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))}MB index limit` };
  }

  let result;
  try {
    result = extractor(isDirectory ? null : readFileSync(filePath), { filePath, isDirectory });
  } catch (error) {
    return { ...base, status: 'error', detail: String(error?.message ?? error) };
  }

  const text = normalizeExtractedText(result.text, MAX_DOCUMENT_CHARACTERS);
  if (!text) {
    return { ...base, status: 'empty', detail: result.detail || 'No readable text found' };
  }
  return {
    ...base,
    status: 'ok',
    text,
    truncated: Boolean(result.truncated) || text.length >= MAX_DOCUMENT_CHARACTERS,
    detail: result.detail ?? '',
  };
}
