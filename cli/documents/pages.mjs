/* eslint-env node */

// DEC-79: Apple Pages documents.
//
// Pages has had three shapes. Pages '09 wrote an `index.xml` (sometimes
// gzipped) that reads like any other XML document. Pages 5 and later write
// `Index/*.iwa` — Snappy-compressed protocol buffers with no published schema,
// which this reader does not attempt. In between sits the practical case: a
// document saved with a preview carries a full-text PDF of itself, and that
// PDF is what we read. A document with none of the three is reported as
// unreadable with the reason, rather than indexed as mysteriously empty.
//
// Both the single-file (zip) and package-directory forms are handled, because
// macOS has written .pages as both.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeXmlEntities } from './ooxml.mjs';
import { extractPdfText } from './pdf.mjs';
import { readZipDirectory, readZipEntry } from './zip.mjs';

const LEGACY_XML_PARTS = ['index.xml', 'index.xml.gz'];
const PREVIEW_PDF_PARTS = ['QuickLook/Preview.pdf', 'preview.pdf', 'Preview.pdf'];
const IWA_PATTERN = /(^|\/)Index\/.+\.iwa$/i;

const IWA_MESSAGE = 'Pages 5+ documents store text in a proprietary compressed format. '
  + 'Save the document with a preview, or export it to PDF or Word, to make it searchable.';

// Tags are metadata; the text nodes between them are the document.
const PAGES_TOKEN_PATTERN = /<sf:(?:br|lnbr|crbr|pgbr)\b[^>]*\/?>|<sf:tab\b[^>]*\/?>|<\/sf:p>|<[^>]+>|([^<]+)/g;

function legacyXmlToText(xml) {
  let text = '';
  for (let match = PAGES_TOKEN_PATTERN.exec(xml); match; match = PAGES_TOKEN_PATTERN.exec(xml)) {
    const [token, textNode] = match;
    if (textNode !== undefined) {
      text += decodeXmlEntities(textNode);
      continue;
    }
    if (token.startsWith('<sf:tab')) {
      text += '\t';
      continue;
    }
    if (token === '</sf:p>' || token.startsWith('<sf:br') || token.startsWith('<sf:lnbr')
      || token.startsWith('<sf:crbr') || token.startsWith('<sf:pgbr')) {
      text += '\n';
    }
  }
  return text;
}

function decodeLegacyPart(name, data) {
  return legacyXmlToText((name.endsWith('.gz') ? gunzipSync(data) : data).toString('utf8'));
}

function textFromPreviewPdf(data) {
  const result = extractPdfText(data);
  return result.text;
}

function readPackage({ read, has, names }) {
  for (const part of LEGACY_XML_PARTS) {
    if (!has(part)) continue;
    const text = decodeLegacyPart(part, read(part)).trim();
    if (text) return { text };
  }

  for (const part of PREVIEW_PDF_PARTS) {
    if (!has(part)) continue;
    const text = textFromPreviewPdf(read(part)).trim();
    if (text) return { text, detail: 'Read from the preview saved inside the document' };
  }

  if (names().some((name) => IWA_PATTERN.test(name))) {
    return { text: '', detail: IWA_MESSAGE };
  }
  throw new Error('Not a Pages document (no index.xml, preview, or Index/*.iwa)');
}

function readPagesZip(buffer) {
  const entries = readZipDirectory(buffer);
  return readPackage({
    has: (name) => entries.has(name),
    read: (name) => readZipEntry(buffer, entries.get(name)),
    names: () => [...entries.keys()],
  });
}

// A .pages package directory: the same member names, on disk.
function readPagesDirectory(directory) {
  const listed = [];
  const walk = (current, prefix, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), relative, depth + 1);
        continue;
      }
      listed.push(relative);
    }
  };
  walk(directory, '', 0);

  return readPackage({
    has: (name) => existsSync(join(directory, name)) && statSync(join(directory, name)).isFile(),
    read: (name) => readFileSync(join(directory, name)),
    names: () => listed,
  });
}

/**
 * Extract readable text from a .pages document, in either its single-file or
 * package-directory form. Returns `{ text, detail }`; an empty `text` with a
 * `detail` means the document was understood but holds no readable text.
 */
export function extractPagesText(source, { isDirectory = false } = {}) {
  return isDirectory ? readPagesDirectory(source) : readPagesZip(source);
}
