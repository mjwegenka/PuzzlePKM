/* eslint-env node */

// DEC-79: PDF text extraction with Node built-ins only.
//
// This is a reader, not a renderer: it walks the object graph, decodes the
// content streams, and replays only the text-showing operators. Two details do
// most of the work for real-world files. First, objects are located by scanning
// for "N G obj" rather than by trusting the cross-reference table, because
// incrementally-saved and lightly-corrupted PDFs are common and a broken xref
// would otherwise cost us the whole document. Second, character codes are
// mapped through each font's /ToUnicode CMap; without that, anything Word or
// LaTeX produced with a subset Identity-H font indexes as glyph-id noise.
//
// Scanned PDFs hold pictures of text and yield nothing here — that needs OCR,
// which is out of scope.

import { Buffer } from 'node:buffer';
import { constants, inflateRawSync, inflateSync } from 'node:zlib';
import { macRomanByte, windows1252Byte } from './encoding.mjs';

const MAX_PAGES = 5000;
const IMAGE_FILTERS = new Set(['DCTDecode', 'JPXDecode', 'JBIG2Decode', 'CCITTFaxDecode']);

// ── Object model ────────────────────────────────────────────────────────────

class PdfName {
  constructor(name) {
    this.name = name;
  }
}

class PdfRef {
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
}

class PdfString {
  constructor(bytes) {
    this.bytes = bytes;
  }
}

class PdfStream {
  constructor(dict, raw) {
    this.dict = dict;
    this.raw = raw;
  }
}

function isDict(value) {
  return value instanceof Map;
}

function isWhitespace(byte) {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
}

function isDelimiter(byte) {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b
    || byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25;
}

function isRegular(byte) {
  return byte !== undefined && !isWhitespace(byte) && !isDelimiter(byte);
}

function isDigit(byte) {
  return byte >= 0x30 && byte <= 0x39;
}

// ── Lexer ───────────────────────────────────────────────────────────────────

class Lexer {
  constructor(buffer, position = 0, { allowRefs = true } = {}) {
    this.buffer = buffer;
    this.position = position;
    this.allowRefs = allowRefs;
  }

  atEnd() {
    return this.position >= this.buffer.length;
  }

  skipWhitespace() {
    while (this.position < this.buffer.length) {
      const byte = this.buffer[this.position];
      if (isWhitespace(byte)) {
        this.position++;
        continue;
      }
      if (byte === 0x25) {
        // Comment runs to end of line.
        while (this.position < this.buffer.length && this.buffer[this.position] !== 0x0a && this.buffer[this.position] !== 0x0d) {
          this.position++;
        }
        continue;
      }
      return;
    }
  }

  readRegularToken() {
    const start = this.position;
    while (isRegular(this.buffer[this.position])) this.position++;
    return this.buffer.toString('latin1', start, this.position);
  }

  readName() {
    this.position++; // consume '/'
    let name = '';
    while (isRegular(this.buffer[this.position])) {
      const byte = this.buffer[this.position];
      if (byte === 0x23 && isHexByte(this.buffer[this.position + 1]) && isHexByte(this.buffer[this.position + 2])) {
        name += String.fromCharCode(Number.parseInt(this.buffer.toString('latin1', this.position + 1, this.position + 3), 16));
        this.position += 3;
        continue;
      }
      name += String.fromCharCode(byte);
      this.position++;
    }
    return new PdfName(name);
  }

  readLiteralString() {
    this.position++; // consume '('
    const bytes = [];
    let depth = 1;
    while (this.position < this.buffer.length) {
      const byte = this.buffer[this.position++];
      if (byte === 0x5c) {
        const escaped = this.buffer[this.position++];
        switch (escaped) {
          case 0x6e: bytes.push(0x0a); break;
          case 0x72: bytes.push(0x0d); break;
          case 0x74: bytes.push(0x09); break;
          case 0x62: bytes.push(0x08); break;
          case 0x66: bytes.push(0x0c); break;
          case 0x0a: break;
          case 0x0d: if (this.buffer[this.position] === 0x0a) this.position++; break;
          default:
            if (escaped >= 0x30 && escaped <= 0x37) {
              let octal = escaped - 0x30;
              for (let digits = 0; digits < 2; digits++) {
                const next = this.buffer[this.position];
                if (next === undefined || next < 0x30 || next > 0x37) break;
                octal = octal * 8 + (next - 0x30);
                this.position++;
              }
              bytes.push(octal & 0xff);
            } else if (escaped !== undefined) {
              bytes.push(escaped);
            }
        }
        continue;
      }
      if (byte === 0x28) {
        depth++;
        bytes.push(byte);
        continue;
      }
      if (byte === 0x29) {
        depth--;
        if (depth === 0) break;
        bytes.push(byte);
        continue;
      }
      bytes.push(byte);
    }
    return new PdfString(Buffer.from(bytes));
  }

  readHexString() {
    this.position++; // consume '<'
    let digits = '';
    while (this.position < this.buffer.length) {
      const byte = this.buffer[this.position++];
      if (byte === 0x3e) break;
      if (isHexByte(byte)) digits += String.fromCharCode(byte);
    }
    if (digits.length % 2 === 1) digits += '0';
    return new PdfString(Buffer.from(digits, 'hex'));
  }

  readDictionary() {
    this.position += 2; // consume '<<'
    const dict = new Map();
    for (;;) {
      this.skipWhitespace();
      if (this.atEnd()) break;
      if (this.buffer[this.position] === 0x3e && this.buffer[this.position + 1] === 0x3e) {
        this.position += 2;
        break;
      }
      if (this.buffer[this.position] !== 0x2f) {
        // Malformed key: step over it rather than spinning.
        const before = this.position;
        const value = this.parseObject();
        if (this.position === before) this.position++;
        if (value === undefined) break;
        continue;
      }
      const key = this.readName().name;
      const value = this.parseObject();
      dict.set(key, value);
    }
    return dict;
  }

  readArray() {
    this.position++; // consume '['
    const items = [];
    for (;;) {
      this.skipWhitespace();
      if (this.atEnd()) break;
      if (this.buffer[this.position] === 0x5d) {
        this.position++;
        break;
      }
      const before = this.position;
      const value = this.parseObject();
      if (value === undefined) {
        if (this.position === before) this.position++;
        continue;
      }
      items.push(value);
    }
    return items;
  }

  /**
   * Parse one object. Returns `undefined` for keywords the caller handles
   * (operators, `endobj`, `stream`, …) — `peekKeyword` tells them apart.
   */
  parseObject() {
    this.skipWhitespace();
    if (this.atEnd()) return undefined;

    const byte = this.buffer[this.position];
    if (byte === 0x2f) return this.readName();
    if (byte === 0x28) return this.readLiteralString();
    if (byte === 0x5b) return this.readArray();
    if (byte === 0x3c) {
      if (this.buffer[this.position + 1] === 0x3c) return this.readDictionary();
      return this.readHexString();
    }
    if (byte === 0x5d || byte === 0x3e || byte === 0x29 || byte === 0x7b || byte === 0x7d) {
      this.position++;
      return undefined;
    }

    const start = this.position;
    const token = this.readRegularToken();
    if (!token) {
      this.position++;
      return undefined;
    }
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      const value = Number.parseFloat(token);
      if (this.allowRefs && /^\d+$/.test(token)) {
        const reference = this.tryReadReferenceTail(value);
        if (reference) return reference;
      }
      return value;
    }

    // A keyword: hand it back to the caller through the cursor.
    this.position = start;
    return undefined;
  }

  tryReadReferenceTail(num) {
    const savedPosition = this.position;
    this.skipWhitespace();
    const genStart = this.position;
    const genToken = this.readRegularToken();
    if (!/^\d+$/.test(genToken)) {
      this.position = savedPosition;
      return null;
    }
    this.skipWhitespace();
    const keyword = this.readRegularToken();
    if (keyword !== 'R') {
      this.position = savedPosition;
      return null;
    }
    void genStart;
    return new PdfRef(num, Number.parseInt(genToken, 10));
  }

  peekKeyword() {
    this.skipWhitespace();
    const savedPosition = this.position;
    const token = this.readRegularToken();
    this.position = savedPosition;
    return token;
  }

  consumeKeyword() {
    this.skipWhitespace();
    return this.readRegularToken();
  }
}

function isHexByte(byte) {
  return byte !== undefined && (isDigit(byte) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66));
}

// ── Stream filters ──────────────────────────────────────────────────────────

function inflateTolerant(raw) {
  const attempts = [
    () => inflateSync(raw),
    () => inflateSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }),
    () => inflateRawSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }),
  ];
  let firstError = null;
  for (const attempt of attempts) {
    try {
      const result = attempt();
      if (result.length > 0) return result;
    } catch (error) {
      firstError ??= error;
    }
  }
  // Some writers leave whitespace before the zlib header.
  let offset = 0;
  while (offset < raw.length && isWhitespace(raw[offset])) offset++;
  if (offset > 0) {
    try {
      return inflateSync(raw.subarray(offset), { finishFlush: constants.Z_SYNC_FLUSH });
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError ?? new Error('Flate stream could not be inflated');
}

function decodeAsciiHex(raw) {
  let digits = '';
  for (const byte of raw) {
    if (byte === 0x3e) break;
    if (isHexByte(byte)) digits += String.fromCharCode(byte);
  }
  if (digits.length % 2 === 1) digits += '0';
  return Buffer.from(digits, 'hex');
}

function decodeAscii85(raw) {
  const output = [];
  let tuple = 0;
  let count = 0;
  for (let index = 0; index < raw.length; index++) {
    const byte = raw[index];
    if (isWhitespace(byte)) continue;
    if (byte === 0x7e) break; // '~' begins the EOD marker
    if (byte === 0x7a && count === 0) {
      output.push(0, 0, 0, 0);
      continue;
    }
    if (byte < 0x21 || byte > 0x75) continue;
    tuple = tuple * 85 + (byte - 0x21);
    count++;
    if (count === 5) {
      output.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 0) {
    for (let pad = count; pad < 5; pad++) tuple = tuple * 85 + 84;
    const bytes = [(tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff];
    output.push(...bytes.slice(0, count - 1));
  }
  return Buffer.from(output);
}

function decodeRunLength(raw) {
  const output = [];
  let index = 0;
  while (index < raw.length) {
    const length = raw[index++];
    if (length === 128) break;
    if (length < 128) {
      for (let copied = 0; copied <= length; copied++) output.push(raw[index++] ?? 0);
      continue;
    }
    const byte = raw[index++] ?? 0;
    for (let repeat = 0; repeat < 257 - length; repeat++) output.push(byte);
  }
  return Buffer.from(output);
}

function decodeLzw(raw, earlyChange = 1) {
  const output = [];
  const dictionary = [];
  const resetDictionary = () => {
    dictionary.length = 0;
    for (let code = 0; code < 256; code++) dictionary.push([code]);
    dictionary.push(null, null); // clear + EOD placeholders
  };
  resetDictionary();

  let codeLength = 9;
  let previous = null;
  let bitBuffer = 0;
  let bitCount = 0;

  for (let index = 0; index < raw.length; index++) {
    bitBuffer = (bitBuffer << 8) | raw[index];
    bitCount += 8;
    while (bitCount >= codeLength) {
      const code = (bitBuffer >> (bitCount - codeLength)) & ((1 << codeLength) - 1);
      bitCount -= codeLength;

      if (code === 256) {
        resetDictionary();
        codeLength = 9;
        previous = null;
        continue;
      }
      if (code === 257) return Buffer.from(output);

      let entry;
      if (code < dictionary.length && dictionary[code]) {
        entry = dictionary[code];
      } else if (previous) {
        entry = [...previous, previous[0]];
      } else {
        return Buffer.from(output);
      }
      for (const byte of entry) output.push(byte);
      if (previous) dictionary.push([...previous, entry[0]]);
      previous = entry;

      const limit = dictionary.length + earlyChange;
      if (limit >= 512 && codeLength === 9) codeLength = 10;
      else if (limit >= 1024 && codeLength === 10) codeLength = 11;
      else if (limit >= 2048 && codeLength === 11) codeLength = 12;
    }
  }
  return Buffer.from(output);
}

function applyPredictor(data, parms, resolve) {
  if (!isDict(parms)) return data;
  const predictor = Number(resolve(parms.get('Predictor')) ?? 1);
  if (!Number.isFinite(predictor) || predictor <= 1) return data;

  const colors = Number(resolve(parms.get('Colors')) ?? 1);
  const bitsPerComponent = Number(resolve(parms.get('BitsPerComponent')) ?? 8);
  const columns = Number(resolve(parms.get('Columns')) ?? 1);
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((colors * bitsPerComponent * columns) / 8);
  // A malformed DecodeParms could otherwise produce a zero-length row and spin.
  if (!Number.isFinite(rowLength) || rowLength <= 0) return data;

  if (predictor === 2) {
    if (bitsPerComponent !== 8) return data;
    for (let offset = 0; offset < data.length; offset++) {
      if (offset % rowLength >= bytesPerPixel) data[offset] = (data[offset] + data[offset - bytesPerPixel]) & 0xff;
    }
    return data;
  }

  // PNG predictors carry a filter-type byte per row.
  const output = [];
  const previousRow = new Uint8Array(rowLength);
  for (let start = 0; start + 1 <= data.length; start += rowLength + 1) {
    const filterType = data[start];
    const row = new Uint8Array(rowLength);
    for (let index = 0; index < rowLength; index++) {
      const rawByte = data[start + 1 + index] ?? 0;
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previousRow[index];
      const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
      switch (filterType) {
        case 1: row[index] = (rawByte + left) & 0xff; break;
        case 2: row[index] = (rawByte + up) & 0xff; break;
        case 3: row[index] = (rawByte + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const nearest = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          row[index] = (rawByte + nearest) & 0xff;
          break;
        }
        default: row[index] = rawByte;
      }
    }
    for (const byte of row) output.push(byte);
    previousRow.set(row);
  }
  return Buffer.from(output);
}

// ── Character encodings ─────────────────────────────────────────────────────

// Glyph names for codes 32–126, used when a simple font remaps codes through
// an /Encoding /Differences array (common in LaTeX output).
const STANDARD_GLYPH_NAMES = [
  'space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quotesingle',
  'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'grave',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  'braceleft', 'bar', 'braceright', 'asciitilde',
];

const GLYPH_NAME_TO_TEXT = new Map(STANDARD_GLYPH_NAMES.map((name, index) => [name, String.fromCharCode(32 + index)]));
for (const [name, text] of [
  ['quoteleft', '‘'], ['quoteright', '’'], ['quotedblleft', '“'], ['quotedblright', '”'],
  ['quotesinglbase', '‚'], ['quotedblbase', '„'], ['endash', '–'], ['emdash', '—'],
  ['bullet', '•'], ['ellipsis', '…'], ['dagger', '†'], ['daggerdbl', '‡'],
  ['fi', 'fi'], ['fl', 'fl'], ['ff', 'ff'], ['ffi', 'ffi'], ['ffl', 'ffl'],
  ['germandbls', 'ß'], ['adieresis', 'ä'], ['odieresis', 'ö'], ['udieresis', 'ü'],
  ['Adieresis', 'Ä'], ['Odieresis', 'Ö'], ['Udieresis', 'Ü'],
  ['eacute', 'é'], ['egrave', 'è'], ['ecircumflex', 'ê'], ['agrave', 'à'],
  ['aacute', 'á'], ['ccedilla', 'ç'], ['ntilde', 'ñ'], ['oacute', 'ó'],
  ['uacute', 'ú'], ['iacute', 'í'], ['nbspace', ' '], ['space', ' '],
]) {
  GLYPH_NAME_TO_TEXT.set(name, text);
}

function glyphNameToText(name) {
  const known = GLYPH_NAME_TO_TEXT.get(name);
  if (known) return known;
  const uniMatch = /^uni([0-9A-Fa-f]{4,6})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uniMatch) {
    const code = Number.parseInt(uniMatch[1], 16);
    if (Number.isFinite(code)) return String.fromCodePoint(code);
  }
  return '';
}

// A simple font's bytes are one of these two code pages. macOS writers
// (Preview, Quartz, cupsfilter) commonly declare /MacRomanEncoding, where the
// byte that means an em dash there means a capital N-tilde in WinAnsi.
function simpleCodeToText(code, encoding) {
  return encoding === 'MacRoman' ? macRomanByte(code) : windows1252Byte(code);
}

function utf16BigEndianToString(bytes) {
  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  if (bytes.length === 1) text += String.fromCharCode(bytes[0]);
  return text;
}

const MAX_CMAP_RANGE = 65536;

/**
 * Parse the bfchar/bfrange sections of a /ToUnicode CMap into a code→text map.
 * Codespace ranges tell us how many bytes a character code occupies.
 */
function parseToUnicodeCMap(source) {
  const text = source.toString('latin1');
  const map = new Map();
  let codeByteLength = 0;

  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (codespace) {
    const firstCode = /<([0-9A-Fa-f]+)>/.exec(codespace[1]);
    if (firstCode) codeByteLength = Math.max(1, Math.ceil(firstCode[1].length / 2));
  }

  const charSectionPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  for (let section = charSectionPattern.exec(text); section; section = charSectionPattern.exec(text)) {
    const pairPattern = /<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\/([^\s/<>[\]]+))/g;
    for (let pair = pairPattern.exec(section[1]); pair; pair = pairPattern.exec(section[1])) {
      const code = Number.parseInt(pair[1], 16);
      if (!Number.isFinite(code)) continue;
      const value = pair[2] !== undefined
        ? utf16BigEndianToString(Buffer.from(pair[2].length % 2 ? `${pair[2]}0` : pair[2], 'hex'))
        : glyphNameToText(pair[3]);
      if (value) map.set(code, value);
    }
  }

  const rangeSectionPattern = /beginbfrange([\s\S]*?)endbfrange/g;
  for (let section = rangeSectionPattern.exec(text); section; section = rangeSectionPattern.exec(text)) {
    const rangePattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g;
    for (let range = rangePattern.exec(section[1]); range; range = rangePattern.exec(section[1])) {
      const low = Number.parseInt(range[1], 16);
      const high = Number.parseInt(range[2], 16);
      if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) continue;
      const span = Math.min(high - low, MAX_CMAP_RANGE);

      if (range[4] !== undefined) {
        const items = [...range[4].matchAll(/<([0-9A-Fa-f]*)>/g)];
        for (let offset = 0; offset <= span && offset < items.length; offset++) {
          const hex = items[offset][1];
          const value = utf16BigEndianToString(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex'));
          if (value) map.set(low + offset, value);
        }
        continue;
      }

      const hex = range[3].length % 2 ? `${range[3]}0` : range[3];
      const base = utf16BigEndianToString(Buffer.from(hex, 'hex'));
      if (!base) continue;
      const prefix = base.slice(0, -1);
      const lastUnit = base.charCodeAt(base.length - 1);
      for (let offset = 0; offset <= span; offset++) {
        map.set(low + offset, `${prefix}${String.fromCharCode(lastUnit + offset)}`);
      }
    }
  }

  return { map, codeByteLength };
}

// ── Document ────────────────────────────────────────────────────────────────

class PdfDocument {
  constructor(buffer) {
    this.buffer = buffer;
    this.objects = new Map();
    this.scanObjects();
    this.expandObjectStreams();
  }

  // Locate every "N G obj" in the file. Later definitions win, which matches
  // how incremental updates supersede earlier revisions.
  scanObjects() {
    const buffer = this.buffer;
    const offsets = new Map();
    for (let index = 0; index + 3 < buffer.length; index++) {
      if (buffer[index] !== 0x6f || buffer[index + 1] !== 0x62 || buffer[index + 2] !== 0x6a) continue;
      if (isRegular(buffer[index + 3])) continue;
      if (index > 0 && isRegular(buffer[index - 1])) continue;

      let cursor = index - 1;
      while (cursor >= 0 && isWhitespace(buffer[cursor])) cursor--;
      const genEnd = cursor + 1;
      while (cursor >= 0 && isDigit(buffer[cursor])) cursor--;
      const genStart = cursor + 1;
      if (genStart === genEnd) continue;

      if (cursor < 0 || !isWhitespace(buffer[cursor])) continue;
      while (cursor >= 0 && isWhitespace(buffer[cursor])) cursor--;
      const numEnd = cursor + 1;
      while (cursor >= 0 && isDigit(buffer[cursor])) cursor--;
      const numStart = cursor + 1;
      if (numStart === numEnd) continue;
      if (cursor >= 0 && isRegular(buffer[cursor])) continue;

      const num = Number.parseInt(buffer.toString('latin1', numStart, numEnd), 10);
      if (!Number.isFinite(num)) continue;
      offsets.set(num, index + 3);
    }

    for (const [num, offset] of offsets) {
      try {
        this.objects.set(num, this.parseObjectAt(offset));
      } catch {
        // A single unreadable object should not sink the document.
      }
    }
  }

  parseObjectAt(offset) {
    const lexer = new Lexer(this.buffer, offset);
    const value = lexer.parseObject();
    if (!isDict(value)) return value;
    if (lexer.peekKeyword() !== 'stream') return value;

    lexer.consumeKeyword();
    let start = lexer.position;
    if (this.buffer[start] === 0x0d) start++;
    if (this.buffer[start] === 0x0a) start++;

    const declaredLength = Number(this.resolve(value.get('Length')));
    let end = Number.isFinite(declaredLength) && declaredLength >= 0 ? start + declaredLength : -1;
    if (end < 0 || end > this.buffer.length || !this.looksLikeStreamEnd(end)) {
      end = this.buffer.indexOf('endstream', start, 'latin1');
      if (end < 0) end = this.buffer.length;
      while (end > start && isWhitespace(this.buffer[end - 1])) end--;
    }
    return new PdfStream(value, this.buffer.subarray(start, end));
  }

  looksLikeStreamEnd(end) {
    let cursor = end;
    let skipped = 0;
    while (cursor < this.buffer.length && isWhitespace(this.buffer[cursor]) && skipped < 4) {
      cursor++;
      skipped++;
    }
    return this.buffer.toString('latin1', cursor, cursor + 9) === 'endstream';
  }

  resolve(value) {
    let current = value;
    for (let hops = 0; current instanceof PdfRef && hops < 32; hops++) {
      current = this.objects.get(current.num);
    }
    return current instanceof PdfRef ? undefined : current;
  }

  dictValue(dict, key) {
    if (!isDict(dict)) return undefined;
    return this.resolve(dict.get(key));
  }

  nameOf(value) {
    const resolved = this.resolve(value);
    return resolved instanceof PdfName ? resolved.name : '';
  }

  // Objects packed into /ObjStm containers are invisible to the "N G obj" scan.
  expandObjectStreams() {
    for (const value of [...this.objects.values()]) {
      if (!(value instanceof PdfStream)) continue;
      if (this.nameOf(value.dict.get('Type')) !== 'ObjStm') continue;

      let data;
      try {
        data = this.streamData(value);
      } catch {
        continue;
      }
      if (!data) continue;

      const count = Number(this.dictValue(value.dict, 'N'));
      const first = Number(this.dictValue(value.dict, 'First'));
      if (!Number.isFinite(count) || !Number.isFinite(first)) continue;

      const headerLexer = new Lexer(data.subarray(0, first), 0, { allowRefs: false });
      const pairs = [];
      for (let index = 0; index < count; index++) {
        const num = headerLexer.parseObject();
        const offset = headerLexer.parseObject();
        if (typeof num !== 'number' || typeof offset !== 'number') break;
        pairs.push([num, offset]);
      }

      for (const [num, offset] of pairs) {
        // A direct definition of the same object number is a newer revision.
        if (this.objects.has(num)) continue;
        try {
          const lexer = new Lexer(data, first + offset);
          this.objects.set(num, lexer.parseObject());
        } catch {
          // Skip the entry, keep the rest of the container.
        }
      }
    }
  }

  streamData(stream) {
    if (!(stream instanceof PdfStream)) return null;
    let data = Buffer.from(stream.raw);

    const rawFilters = this.dictValue(stream.dict, 'Filter');
    const filters = rawFilters === undefined || rawFilters === null
      ? []
      : (Array.isArray(rawFilters) ? rawFilters : [rawFilters]).map((filter) => this.nameOf(filter));
    const rawParms = this.dictValue(stream.dict, 'DecodeParms') ?? this.dictValue(stream.dict, 'DP');
    const parmsList = Array.isArray(rawParms) ? rawParms : [rawParms];

    for (let index = 0; index < filters.length; index++) {
      const filter = filters[index];
      const parms = this.resolve(parmsList[index]);
      if (IMAGE_FILTERS.has(filter)) return null;
      switch (filter) {
        case 'FlateDecode':
        case 'Fl':
          data = applyPredictor(inflateTolerant(data), parms, (value) => this.resolve(value));
          break;
        case 'LZWDecode':
        case 'LZW': {
          const earlyChange = isDict(parms) ? Number(this.resolve(parms.get('EarlyChange')) ?? 1) : 1;
          data = applyPredictor(decodeLzw(data, earlyChange === 0 ? 0 : 1), parms, (value) => this.resolve(value));
          break;
        }
        case 'ASCIIHexDecode':
        case 'AHx':
          data = decodeAsciiHex(data);
          break;
        case 'ASCII85Decode':
        case 'A85':
          data = decodeAscii85(data);
          break;
        case 'RunLengthDecode':
        case 'RL':
          data = decodeRunLength(data);
          break;
        case '':
          break;
        default:
          // Crypt and anything else unknown: treat as opaque.
          return null;
      }
    }
    return data;
  }

  /** Pages in reading order, each with its inherited /Resources. */
  pages() {
    const catalogEntry = [...this.objects.values()].find(
      (value) => isDict(value) && this.nameOf(value.get('Type')) === 'Catalog',
    );
    const rootPages = catalogEntry ? this.dictValue(catalogEntry, 'Pages') : undefined;

    const pages = [];
    const seen = new Set();
    const walk = (node, inheritedResources, depth) => {
      if (!isDict(node) || pages.length >= MAX_PAGES || depth > 64) return;
      const resources = this.dictValue(node, 'Resources') ?? inheritedResources;
      const type = this.nameOf(node.get('Type'));
      const kids = this.dictValue(node, 'Kids');

      if (type === 'Page' || (!kids && node.has('Contents'))) {
        pages.push({ dict: node, resources });
        return;
      }
      if (!Array.isArray(kids)) return;
      for (const kidRef of kids) {
        const key = kidRef instanceof PdfRef ? kidRef.num : null;
        if (key !== null) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        walk(this.resolve(kidRef), resources, depth + 1);
      }
    };

    if (isDict(rootPages)) walk(rootPages, undefined, 0);

    if (pages.length === 0) {
      // No usable page tree: fall back to every /Type /Page in object order.
      for (const num of [...this.objects.keys()].sort((a, b) => a - b)) {
        const value = this.objects.get(num);
        if (!isDict(value) || this.nameOf(value.get('Type')) !== 'Page') continue;
        pages.push({ dict: value, resources: this.dictValue(value, 'Resources') });
        if (pages.length >= MAX_PAGES) break;
      }
    }

    return pages;
  }

  pageContent(page) {
    const contents = this.dictValue(page.dict, 'Contents');
    const streams = Array.isArray(contents) ? contents.map((item) => this.resolve(item)) : [contents];
    const parts = [];
    for (const stream of streams) {
      if (!(stream instanceof PdfStream)) continue;
      try {
        const data = this.streamData(stream);
        if (data && data.length > 0) parts.push(data);
      } catch {
        // Unreadable content stream: skip this piece of the page.
      }
    }
    if (parts.length === 0) return null;
    return Buffer.concat(parts.flatMap((part, index) => (index === 0 ? [part] : [Buffer.from('\n'), part])));
  }

  fontsForPage(page) {
    const fonts = new Map();
    const fontDict = this.dictValue(page.resources, 'Font');
    if (!isDict(fontDict)) return fonts;
    for (const [resourceName, ref] of fontDict) {
      const font = this.resolve(ref);
      if (!isDict(font)) continue;
      fonts.set(resourceName, this.buildFont(font));
    }
    return fonts;
  }

  buildFont(fontDict) {
    const subtype = this.nameOf(fontDict.get('Subtype'));
    let byteLength = subtype === 'Type0' ? 2 : 1;

    let toUnicode = null;
    const toUnicodeStream = this.dictValue(fontDict, 'ToUnicode');
    if (toUnicodeStream instanceof PdfStream) {
      try {
        const data = this.streamData(toUnicodeStream);
        if (data) {
          const parsed = parseToUnicodeCMap(data);
          toUnicode = parsed.map;
          if (parsed.codeByteLength > 0) byteLength = parsed.codeByteLength;
        }
      } catch {
        // Font stays unmapped; simple-font fallbacks below still apply.
      }
    }

    const differences = new Map();
    const encoding = this.dictValue(fontDict, 'Encoding');
    const encodingName = encoding instanceof PdfName
      ? encoding.name
      : (isDict(encoding) ? this.nameOf(encoding.get('BaseEncoding')) : '');
    const baseEncoding = encodingName.startsWith('MacRoman') ? 'MacRoman' : 'WinAnsi';
    if (isDict(encoding)) {
      const list = this.dictValue(encoding, 'Differences');
      if (Array.isArray(list)) {
        let code = 0;
        for (const item of list) {
          const resolved = this.resolve(item);
          if (typeof resolved === 'number') {
            code = resolved;
            continue;
          }
          if (resolved instanceof PdfName) {
            const text = glyphNameToText(resolved.name);
            if (text) differences.set(code, text);
            code++;
          }
        }
      }
    }

    return { byteLength, toUnicode, differences, encoding: baseEncoding };
  }
}

// ── Text replay ─────────────────────────────────────────────────────────────

// A TJ array's numbers are kerning offsets in thousandths of an em; a large
// negative one is how PDFs usually encode a word space.
const WORD_SPACE_THRESHOLD = 140;
const LINE_MOVE_EPSILON = 0.1;

function decodePdfString(value, font) {
  if (!(value instanceof PdfString)) return '';
  const bytes = value.bytes;

  if (font && font.byteLength === 2) {
    let text = '';
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      const code = (bytes[index] << 8) | bytes[index + 1];
      // Without a ToUnicode map these codes are glyph ids, so dropping them
      // keeps the index clean rather than filling it with mojibake.
      text += font.toUnicode?.get(code) ?? '';
    }
    return text;
  }

  let text = '';
  for (const byte of bytes) {
    const mapped = font?.toUnicode?.get(byte) ?? font?.differences?.get(byte);
    text += mapped ?? simpleCodeToText(byte, font?.encoding ?? 'WinAnsi');
  }
  return text;
}

function skipInlineImage(lexer) {
  const buffer = lexer.buffer;
  for (let index = lexer.position; index + 1 < buffer.length; index++) {
    if (buffer[index] !== 0x45 || buffer[index + 1] !== 0x49) continue; // 'EI'
    if (index > 0 && !isWhitespace(buffer[index - 1])) continue;
    if (isRegular(buffer[index + 2])) continue;
    lexer.position = index + 2;
    return;
  }
  lexer.position = buffer.length;
}

function extractContentText(content, fonts, sink) {
  const lexer = new Lexer(content, 0, { allowRefs: false });
  let operands = [];
  let font = null;
  let lastLineY = null;

  const show = (value) => sink.push(decodePdfString(value, font));

  while (!lexer.atEnd() && !sink.full()) {
    lexer.skipWhitespace();
    if (lexer.atEnd()) break;

    const before = lexer.position;
    const value = lexer.parseObject();
    if (value !== undefined) {
      if (operands.length > 64) operands.shift();
      operands.push(value);
      continue;
    }
    if (lexer.position !== before) continue;

    const operator = lexer.consumeKeyword();
    if (!operator) {
      lexer.position++;
      continue;
    }

    switch (operator) {
      case 'BT':
        lastLineY = null;
        break;
      case 'ET':
        sink.push('\n');
        break;
      case 'Tf': {
        const name = operands[operands.length - 2];
        font = name instanceof PdfName ? fonts.get(name.name) ?? null : null;
        break;
      }
      case 'Tj':
        show(operands[operands.length - 1]);
        break;
      case "'":
        sink.push('\n');
        show(operands[operands.length - 1]);
        break;
      case '"':
        sink.push('\n');
        show(operands[operands.length - 1]);
        break;
      case 'TJ': {
        const array = operands[operands.length - 1];
        if (Array.isArray(array)) {
          for (const item of array) {
            if (item instanceof PdfString) show(item);
            else if (typeof item === 'number' && item <= -WORD_SPACE_THRESHOLD) sink.push(' ');
          }
        }
        break;
      }
      case 'Td':
      case 'TD': {
        const ty = operands[operands.length - 1];
        sink.push(typeof ty === 'number' && Math.abs(ty) > LINE_MOVE_EPSILON ? '\n' : ' ');
        break;
      }
      case 'T*':
        sink.push('\n');
        break;
      case 'Tm': {
        const ty = operands[operands.length - 1];
        if (typeof ty === 'number') {
          if (lastLineY !== null && Math.abs(ty - lastLineY) > LINE_MOVE_EPSILON) sink.push('\n');
          lastLineY = ty;
        }
        break;
      }
      case 'BI':
        skipInlineImage(lexer);
        break;
      default:
        break;
    }
    operands = [];
  }
}

class TextSink {
  constructor(limit) {
    this.limit = limit;
    this.parts = [];
    this.length = 0;
    this.truncated = false;
  }

  push(text) {
    if (!text || this.full()) return;
    const remaining = this.limit - this.length;
    if (text.length > remaining) {
      this.parts.push(text.slice(0, remaining));
      this.length = this.limit;
      this.truncated = true;
      return;
    }
    this.parts.push(text);
    this.length += text.length;
  }

  full() {
    return this.length >= this.limit;
  }

  toString() {
    return this.parts.join('');
  }
}

function looksLikePdf(buffer) {
  // Some files carry junk before the header; the spec allows the offset.
  return buffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1');
}

/**
 * Extract readable text from a PDF buffer.
 * Throws when the buffer is not a PDF at all; returns an empty string for
 * PDFs that genuinely carry no text layer (scans, image-only exports).
 */
export function extractPdfText(buffer, { maxCharacters = 2_000_000 } = {}) {
  if (!Buffer.isBuffer(buffer) || !looksLikePdf(buffer)) {
    throw new Error('Not a PDF file');
  }

  const encrypted = buffer.includes('/Encrypt', 0, 'latin1');
  const document = new PdfDocument(buffer);
  const pages = document.pages();
  const sink = new TextSink(maxCharacters);

  for (const page of pages) {
    if (sink.full()) break;
    let content;
    try {
      content = document.pageContent(page);
    } catch {
      continue;
    }
    if (!content) continue;
    try {
      extractContentText(content, document.fontsForPage(page), sink);
    } catch {
      // Keep whatever the earlier pages produced.
    }
    sink.push('\n\n');
  }

  return {
    text: sink.toString(),
    pageCount: pages.length,
    truncated: sink.truncated,
    encrypted,
  };
}
