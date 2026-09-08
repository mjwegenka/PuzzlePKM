/* eslint-env node */

// DEC-79: PowerPoint text extraction. A deck's words live in the slides, the
// speaker notes, and — for anything built from an outline — the slide masters'
// placeholder text, which is boilerplate and deliberately skipped. Slides are
// read in presentation order so a snippet reads like the deck.

import { compareNumberedParts, decodeXmlEntities } from './ooxml.mjs';
import { readZipDirectory, readZipEntry } from './zip.mjs';

const SLIDE_PART_PATTERN = /^ppt\/slides\/slide\d+\.xml$/i;
const NOTES_PART_PATTERN = /^ppt\/notesSlides\/notesSlide\d+\.xml$/i;

// DrawingML: <a:t> holds the characters, <a:p> the paragraphs, and a table
// closes cells with </a:tc>.
const DRAWING_TOKEN_PATTERN = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>|<\/a:p>|<\/a:tc>/g;

function drawingXmlToText(xml) {
  let text = '';
  for (let match = DRAWING_TOKEN_PATTERN.exec(xml); match; match = DRAWING_TOKEN_PATTERN.exec(xml)) {
    const [token, runText] = match;
    if (runText !== undefined) {
      text += decodeXmlEntities(runText);
      continue;
    }
    text += token === '</a:tc>' ? '\t' : '\n';
  }
  return text;
}

function readPart(buffer, entries, name) {
  try {
    return readZipEntry(buffer, entries.get(name)).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Extract readable text from a .pptx/.pptm buffer.
 * Throws when the buffer is not a PowerPoint package we can read.
 */
export function extractPptxText(buffer) {
  const entries = readZipDirectory(buffer);
  const slideNames = [...entries.keys()].filter((name) => SLIDE_PART_PATTERN.test(name)).sort(compareNumberedParts);
  const notesNames = [...entries.keys()].filter((name) => NOTES_PART_PATTERN.test(name)).sort(compareNumberedParts);

  if (slideNames.length === 0 && notesNames.length === 0) {
    // .ppt renamed, a template with no slides, or an encrypted package.
    throw new Error('Not a PowerPoint package (no slides found)');
  }

  const sections = [];
  slideNames.forEach((name, index) => {
    const text = drawingXmlToText(readPart(buffer, entries, name)).trim();
    if (text) sections.push(`Slide ${index + 1}\n${text}`);
  });

  const notes = notesNames
    .map((name) => drawingXmlToText(readPart(buffer, entries, name)).trim())
    .filter(Boolean);
  if (notes.length > 0) sections.push(`Speaker notes\n${notes.join('\n\n')}`);

  return sections.join('\n\n');
}
