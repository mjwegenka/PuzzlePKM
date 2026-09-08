/* eslint-env node */

// DEC-79: Word text extraction. Only the parts that carry prose are read —
// the document body, then headers/footers and foot/endnotes — because the
// point is search recall, not fidelity to Word's layout model.

import { decodeXmlEntities } from './ooxml.mjs';
import { readZipDirectory, readZipEntry } from './zip.mjs';

const MAIN_DOCUMENT_PART = 'word/document.xml';
const SUPPLEMENTARY_PART_PATTERN = /^word\/(?:footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/i;

// One pass over the markup: <w:t> runs contribute characters, and the
// structural tags around them contribute the whitespace that keeps words from
// running together once the tags are gone.
const WORD_TOKEN_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;

function wordXmlToText(xml) {
  let text = '';
  for (let match = WORD_TOKEN_PATTERN.exec(xml); match; match = WORD_TOKEN_PATTERN.exec(xml)) {
    const [token, runText] = match;
    if (runText !== undefined) {
      text += decodeXmlEntities(runText);
      continue;
    }
    if (token.startsWith('<w:tab') || token === '</w:tc>') {
      text += '\t';
      continue;
    }
    text += '\n';
  }
  return text;
}

function partSortKey(name) {
  // Body first, then the remaining parts in a stable, readable order.
  if (name === MAIN_DOCUMENT_PART) return `0:${name}`;
  return `1:${name.toLowerCase()}`;
}

/**
 * Extract readable text from a .docx/.docm buffer.
 * Throws when the buffer is not a Word package we can read.
 */
export function extractDocxText(buffer) {
  const entries = readZipDirectory(buffer);
  if (!entries.has(MAIN_DOCUMENT_PART)) {
    // .doc (OLE2), Pages exports and encrypted packages all land here.
    throw new Error('Not a Word document package (word/document.xml missing)');
  }

  const partNames = [...entries.keys()]
    .filter((name) => name === MAIN_DOCUMENT_PART || SUPPLEMENTARY_PART_PATTERN.test(name))
    .sort((a, b) => partSortKey(a).localeCompare(partSortKey(b)));

  const sections = [];
  for (const name of partNames) {
    let xml;
    try {
      xml = readZipEntry(buffer, entries.get(name)).toString('utf8');
    } catch (error) {
      // A damaged supplementary part should not cost us the body text.
      if (name === MAIN_DOCUMENT_PART) throw error;
      continue;
    }
    const text = wordXmlToText(xml).trim();
    if (text) sections.push(text);
  }

  return sections.join('\n\n');
}
