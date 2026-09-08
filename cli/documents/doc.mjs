/* eslint-env node */

// DEC-79: Word 97-2004 (.doc) text extraction.
//
// The text of a .doc is not one contiguous run. Word records it as a piece
// table in the table stream: a list of character-position boundaries plus, for
// each piece, where its bytes live in the WordDocument stream and whether they
// are one byte per character (Windows-1252) or two (UTF-16LE). Fast-saved
// documents can hold dozens of pieces in file order that has nothing to do with
// reading order, which is why walking the table is the only correct way in.

import { readCompoundFile } from './cfb.mjs';
import { decodeWindows1252 } from './encoding.mjs';

const WORD_DOCUMENT_STREAM = 'WordDocument';
const FIB_FLAGS_OFFSET = 0x0a;
const FIB_WHICH_TABLE_STREAM = 0x0200;
const FIB_FC_MIN_OFFSET = 0x18;
const FIB_CCP_TEXT_OFFSET = 0x4c;
const FIB_FC_CLX_OFFSET = 0x01a2;
const FIB_LCB_CLX_OFFSET = 0x01a6;
const CLX_PRC = 0x01;
const CLX_PIECE_TABLE = 0x02;
const PIECE_DESCRIPTOR_SIZE = 8;
const PIECE_COMPRESSED_FLAG = 0x40000000;
const PIECE_FC_MASK = 0x3fffffff;

// Word's in-band control characters. Everything not listed is dropped.
const FIELD_BEGIN = 0x13;
const FIELD_SEPARATOR = 0x14;
const FIELD_END = 0x15;

function controlCharacterToText(code) {
  switch (code) {
    case 0x07: // cell / row mark
    case 0x0b: // line break
    case 0x0c: // page break
    case 0x0d: // paragraph mark
      return '\n';
    case 0x09:
      return '\t';
    case 0x1e: // non-breaking hyphen
      return '-';
    case 0xa0:
      return ' ';
    default:
      return code >= 0x20 ? null : '';
  }
}

/**
 * Strip Word's control characters, and drop field instructions — the
 * `HYPERLINK "http://…"` half of a field — while keeping the result text a
 * reader actually sees.
 */
function cleanWordText(raw) {
  let text = '';
  let inFieldInstruction = false;

  for (const character of raw) {
    const code = character.codePointAt(0);
    if (code === FIELD_BEGIN) {
      inFieldInstruction = true;
      continue;
    }
    if (code === FIELD_SEPARATOR) {
      inFieldInstruction = false;
      continue;
    }
    if (code === FIELD_END) {
      inFieldInstruction = false;
      text += ' ';
      continue;
    }
    if (inFieldInstruction) continue;

    const replacement = controlCharacterToText(code);
    text += replacement === null ? character : replacement;
  }
  return text;
}

function readPieceTable(table, fcClx, lcbClx) {
  if (!table || lcbClx <= 0 || fcClx < 0 || fcClx + lcbClx > table.length) return null;
  const clx = table.subarray(fcClx, fcClx + lcbClx);

  // Property modifiers come first and are sized in place; the piece table is
  // whatever follows them.
  let offset = 0;
  while (offset < clx.length && clx[offset] === CLX_PRC) {
    if (offset + 3 > clx.length) return null;
    offset += 3 + clx.readUInt16LE(offset + 1);
  }
  if (offset >= clx.length || clx[offset] !== CLX_PIECE_TABLE) return null;
  if (offset + 5 > clx.length) return null;

  const byteLength = clx.readUInt32LE(offset + 1);
  const body = clx.subarray(offset + 5, offset + 5 + byteLength);
  const pieceCount = Math.floor((body.length - 4) / (4 + PIECE_DESCRIPTOR_SIZE));
  if (pieceCount <= 0) return null;

  const descriptorStart = (pieceCount + 1) * 4;
  const pieces = [];
  for (let index = 0; index < pieceCount; index++) {
    const characterStart = body.readUInt32LE(index * 4);
    const characterEnd = body.readUInt32LE((index + 1) * 4);
    const descriptor = descriptorStart + index * PIECE_DESCRIPTOR_SIZE;
    if (descriptor + PIECE_DESCRIPTOR_SIZE > body.length) break;

    const rawPosition = body.readUInt32LE(descriptor + 2);
    const compressed = (rawPosition & PIECE_COMPRESSED_FLAG) !== 0;
    const position = compressed ? (rawPosition & PIECE_FC_MASK) / 2 : rawPosition & PIECE_FC_MASK;
    const characterCount = characterEnd - characterStart;
    if (characterCount <= 0) continue;

    pieces.push({ position, characterCount, compressed });
  }
  return pieces.length > 0 ? pieces : null;
}

function readPieces(wordDocument, pieces) {
  let text = '';
  for (const piece of pieces) {
    const byteLength = piece.compressed ? piece.characterCount : piece.characterCount * 2;
    const start = piece.position;
    if (!Number.isFinite(start) || start < 0 || start >= wordDocument.length) continue;
    const bytes = wordDocument.subarray(start, Math.min(start + byteLength, wordDocument.length));
    text += piece.compressed ? decodeWindows1252(bytes) : bytes.toString('utf16le');
  }
  return text;
}

/**
 * Extract readable text from a Word 97-2004 .doc buffer.
 * Throws when the buffer is not a Word binary document.
 */
export function extractDocText(buffer) {
  const container = readCompoundFile(buffer);
  const wordDocument = container.readStream(WORD_DOCUMENT_STREAM);
  if (!wordDocument || wordDocument.length < FIB_LCB_CLX_OFFSET + 4) {
    // Excel and PowerPoint binaries are the same container with other streams.
    throw new Error('Not a Word 97-2004 document (WordDocument stream missing)');
  }

  const flags = wordDocument.readUInt16LE(FIB_FLAGS_OFFSET);
  const preferredTable = (flags & FIB_WHICH_TABLE_STREAM) !== 0 ? '1Table' : '0Table';
  const table = container.readStream(preferredTable)
    ?? container.readStream(preferredTable === '1Table' ? '0Table' : '1Table');

  const pieces = readPieceTable(
    table,
    wordDocument.readUInt32LE(FIB_FC_CLX_OFFSET),
    wordDocument.readUInt32LE(FIB_LCB_CLX_OFFSET),
  );
  if (pieces) return cleanWordText(readPieces(wordDocument, pieces));

  // Word 6/95 and documents with an unreadable piece table still keep the body
  // as one run starting at fcMin.
  const start = wordDocument.readUInt32LE(FIB_FC_MIN_OFFSET);
  const characterCount = wordDocument.readUInt32LE(FIB_CCP_TEXT_OFFSET);
  if (!Number.isFinite(start) || start <= 0 || characterCount <= 0 || start >= wordDocument.length) {
    throw new Error('Word document has no readable text stream');
  }
  const bytes = wordDocument.subarray(start, Math.min(start + characterCount, wordDocument.length));
  return cleanWordText(decodeWindows1252(bytes));
}
