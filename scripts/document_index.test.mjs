/* eslint-env node */

// DEC-79: document text extraction and the searchable index built from project
// and reference-material folders. Fixtures are generated rather than checked in
// so the tests stay portable and the parsers get exercised on real bytes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocumentText } from '../cli/documents/index.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'cli.mjs');

// ── Fixture builders ────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** Build a zip archive with deflated members - enough to be a real .docx. */
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localParts.push(localHeader, nameBytes, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, central, end]);
}

function buildDocx(paragraphs) {
  const body = paragraphs
    .map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${paragraph}</w:t></w:r></w:p>`)
    .join('');
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
    {
      name: 'word/footnotes.xml',
      data: '<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Cited in the appendix.</w:t></w:r></w:p></w:footnotes>',
    },
  ]);
}

/** A plain, uncompressed PDF with a WinAnsi simple font. */
function buildSimplePdf(lines) {
  const content = `BT /F1 12 Tf 72 720 Td ${lines
    .map((line, index) => (index === 0 ? `(${line}) Tj` : `0 -14 Td (${line}) Tj`))
    .join(' ')} ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  objects.forEach((body, index) => {
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  pdf += 'trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n';
  return Buffer.from(pdf, 'latin1');
}

/**
 * A PDF shaped like modern exports: page objects packed into an object stream,
 * a deflated content stream, and a Type0 font whose bytes only become text
 * through its /ToUnicode CMap.
 */
function buildModernPdf(word) {
  const codes = word.split('').map((_, index) => index + 1);
  const bfchars = word
    .split('')
    .map((character, index) => `<${(index + 1).toString(16).padStart(4, '0')}> <${character.charCodeAt(0).toString(16).padStart(4, '0')}>`)
    .join('\n');
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${codes.length} beginbfchar
${bfchars}
endbfchar
endcmap
end
end`;

  const hexCodes = codes.map((code) => code.toString(16).padStart(4, '0')).join('');
  const content = `BT /F1 11 Tf 72 700 Td <${hexCodes}> Tj ET`;

  const packed = [
    { num: 2, body: '<< /Type /Catalog /Pages 3 0 R >>' },
    { num: 3, body: '<< /Type /Pages /Kids [4 0 R] /Count 1 >>' },
    { num: 4, body: '<< /Type /Page /Parent 3 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>' },
    { num: 5, body: '<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Times /Encoding /Identity-H /ToUnicode 7 0 R >>' },
  ];

  let payload = '';
  const header = [];
  for (const entry of packed) {
    header.push(`${entry.num} ${payload.length}`);
    payload += `${entry.body}\n`;
  }
  const headerText = `${header.join(' ')}\n`;
  const objStmData = deflateSync(Buffer.from(headerText + payload, 'latin1'));
  const contentData = deflateSync(Buffer.from(content, 'latin1'));
  const cmapData = deflateSync(Buffer.from(cmap, 'latin1'));

  const parts = [Buffer.from('%PDF-1.5\n', 'latin1')];
  const pushStream = (num, dict, data) => {
    parts.push(Buffer.from(`${num} 0 obj\n${dict}\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  };

  pushStream(1, `<< /Type /ObjStm /N ${packed.length} /First ${headerText.length} /Length ${objStmData.length} /Filter /FlateDecode >>`, objStmData);
  pushStream(6, `<< /Length ${contentData.length} /Filter /FlateDecode >>`, contentData);
  pushStream(7, `<< /Length ${cmapData.length} /Filter /FlateDecode >>`, cmapData);
  parts.push(Buffer.from('trailer\n<< /Root 2 0 R /Size 8 >>\n%%EOF\n', 'latin1'));

  return Buffer.concat(parts);
}

/**
 * A .pptx is a zip of DrawingML parts; only the slide and notes parts matter.
 */
function buildPptx(slides, notes = []) {
  const shapeXml = (lines) => lines
    .map((line) => `<p:sp><p:txBody><a:p><a:r><a:t>${line}</a:t></a:r></a:p></p:txBody></p:sp>`)
    .join('');
  const slidePart = (lines) => ({
    data: `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${shapeXml(lines)}</p:spTree></p:cSld></p:sld>`,
  });

  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  ];
  slides.forEach((lines, index) => {
    files.push({ name: `ppt/slides/slide${index + 1}.xml`, ...slidePart(lines) });
  });
  notes.forEach((lines, index) => {
    files.push({ name: `ppt/notesSlides/notesSlide${index + 1}.xml`, ...slidePart(lines) });
  });
  return buildZip(files);
}

/**
 * A Word 97 .doc: an OLE2 container holding a WordDocument stream and a table
 * stream whose piece table points back into it. Both streams are padded past
 * the 4096-byte mini-stream cutoff so they use ordinary sectors.
 *
 * The readers are also exercised against documents produced by Word itself;
 * this fixture is what keeps the test portable.
 */
function buildDoc(text) {
  const SECTOR_SIZE = 512;
  const STREAM_SECTORS = 9;
  const STREAM_SIZE = SECTOR_SIZE * STREAM_SECTORS;
  const END_OF_CHAIN = 0xfffffffe;
  const FAT_SECTOR = 0xfffffffd;
  const FREE_SECTOR = 0xffffffff;
  const TEXT_OFFSET = 0x800;

  const characters = Buffer.from(text, 'latin1');

  // Table stream: one piece, one byte per character, at TEXT_OFFSET.
  const pieceTable = Buffer.alloc(21);
  pieceTable[0] = 0x02;
  pieceTable.writeUInt32LE(16, 1);
  pieceTable.writeUInt32LE(0, 5);
  pieceTable.writeUInt32LE(characters.length, 9);
  pieceTable.writeUInt32LE((TEXT_OFFSET * 2) | 0x40000000, 15);

  const table = Buffer.alloc(STREAM_SIZE);
  pieceTable.copy(table, 0);

  const wordDocument = Buffer.alloc(STREAM_SIZE);
  wordDocument.writeUInt16LE(0xa5ec, 0x00);
  wordDocument.writeUInt16LE(193, 0x02);
  wordDocument.writeUInt16LE(0x0200, 0x0a);
  wordDocument.writeUInt32LE(TEXT_OFFSET, 0x18);
  wordDocument.writeUInt32LE(characters.length, 0x4c);
  wordDocument.writeUInt32LE(0, 0x01a2);
  wordDocument.writeUInt32LE(pieceTable.length, 0x01a6);
  characters.copy(wordDocument, TEXT_OFFSET);

  const header = Buffer.alloc(SECTOR_SIZE, 0);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(0x0003, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(END_OF_CHAIN, 0x3c);
  header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(END_OF_CHAIN, 0x44);
  header.writeUInt32LE(0, 0x48);
  for (let index = 0; index < 109; index++) {
    header.writeUInt32LE(index === 0 ? 0 : FREE_SECTOR, 0x4c + index * 4);
  }

  const wordStart = 2;
  const tableStart = wordStart + STREAM_SECTORS;
  const fat = Buffer.alloc(SECTOR_SIZE, 0xff);
  fat.writeUInt32LE(FAT_SECTOR, 0);
  fat.writeUInt32LE(END_OF_CHAIN, 4);
  for (let index = 0; index < STREAM_SECTORS; index++) {
    const isLast = index === STREAM_SECTORS - 1;
    fat.writeUInt32LE(isLast ? END_OF_CHAIN : wordStart + index + 1, (wordStart + index) * 4);
    fat.writeUInt32LE(isLast ? END_OF_CHAIN : tableStart + index + 1, (tableStart + index) * 4);
  }

  const directoryEntry = (name, type, startSector, size) => {
    const entry = Buffer.alloc(128, 0);
    const nameBytes = Buffer.from(name, 'utf16le');
    nameBytes.copy(entry, 0);
    entry.writeUInt16LE(nameBytes.length + 2, 0x40);
    entry[0x42] = type;
    entry.writeUInt32LE(0xffffffff, 0x44);
    entry.writeUInt32LE(0xffffffff, 0x48);
    entry.writeUInt32LE(0xffffffff, 0x4c);
    entry.writeUInt32LE(startSector, 0x74);
    entry.writeUInt32LE(size, 0x78);
    return entry;
  };

  const directory = Buffer.concat([
    directoryEntry('Root Entry', 5, END_OF_CHAIN, 0),
    directoryEntry('WordDocument', 2, wordStart, STREAM_SIZE),
    directoryEntry('1Table', 2, tableStart, STREAM_SIZE),
    Buffer.alloc(128, 0),
  ]);

  return Buffer.concat([header, fat, directory, wordDocument, table]);
}

/** A Pages document in its zipped form, given the members it should hold. */
function buildPagesArchive(files) {
  return buildZip(files);
}

// ── Extraction ──────────────────────────────────────────────────────────────

function writeFixture(directory, name, data) {
  const path = join(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

function withTempDir(run) {
  const directory = mkdtempSync(join(tmpdir(), 'puzzlepkm-documents-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('Word documents extract body text and footnotes', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'retreat.docx', buildDocx([
      'Ignatian discernment retreat',
      'The Second Week rules describe consolation without previous cause.',
    ]));

    const result = extractDocumentText(path);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Ignatian discernment retreat/);
    assert.match(result.text, /consolation without previous cause/);
    assert.match(result.text, /Cited in the appendix/);
  });
});

test('Word XML entities and escaped characters survive extraction', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'entities.docx', buildDocx(['Ratio Studiorum &amp; the 1599 plan &#8212; revised']));
    const result = extractDocumentText(path);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Ratio Studiorum & the 1599 plan — revised/);
  });
});

test('a simple PDF yields its text lines', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'plan.pdf', buildSimplePdf([
      'Vocation discernment plan',
      'Follow up with the novitiate in March',
    ]));

    const result = extractDocumentText(path);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Vocation discernment plan/);
    assert.match(result.text, /novitiate in March/);
  });
});

test('a PDF using object streams and an Identity-H font is decoded through its ToUnicode map', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'modern.pdf', buildModernPdf('Ignatius'));
    const result = extractDocumentText(path);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Ignatius/);
  });
});

test('a PDF with no text layer reports why instead of failing', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'scan.pdf', Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
      + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
      'latin1',
    ));

    const result = extractDocumentText(path);
    assert.equal(result.status, 'empty');
    assert.match(result.detail, /No text layer/);
  });
});

test('Markdown and plain text are indexed as written, and unknown formats are reported', () => {
  withTempDir((directory) => {
    const markdown = writeFixture(directory, 'reading-list.md', '# Reading list\n\n- The Spiritual Exercises\n');
    const markdownResult = extractDocumentText(markdown);
    assert.equal(markdownResult.status, 'ok');
    assert.match(markdownResult.text, /The Spiritual Exercises/);

    const plain = writeFixture(directory, 'packing.txt', 'Bring the breviary and the retreat notes.\n');
    const plainResult = extractDocumentText(plain);
    assert.equal(plainResult.status, 'ok');
    assert.match(plainResult.text, /Bring the breviary/);

    const keynote = writeFixture(directory, 'deck.key', 'binary-ish');
    assert.equal(extractDocumentText(keynote).status, 'unsupported');

    const spreadsheet = writeFixture(directory, 'budget.xlsx', 'binary-ish');
    assert.equal(extractDocumentText(spreadsheet).status, 'unsupported');
  });
});

test('plain text is decoded through byte-order marks and legacy code pages', () => {
  withTempDir((directory) => {
    const utf16 = writeFixture(
      directory,
      'utf16.txt',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Examen at the novitiate', 'utf16le')]),
    );
    assert.match(extractDocumentText(utf16).text, /Examen at the novitiate/);

    // 0x92 is a right single quote in Windows-1252 and invalid UTF-8.
    const legacy = writeFixture(
      directory,
      'legacy.txt',
      Buffer.concat([Buffer.from('The rector', 'latin1'), Buffer.from([0x92]), Buffer.from('s letter', 'latin1')]),
    );
    const legacyResult = extractDocumentText(legacy);
    assert.equal(legacyResult.status, 'ok');
    assert.match(legacyResult.text, /The rector\u2019s letter/);
  });
});

test('PowerPoint decks yield slide text in order, plus speaker notes', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'talk.pptx', buildPptx(
      [
        ['Discernment of spirits', 'Rules for the First Week'],
        ['Consolation and desolation'],
      ],
      [['Remember to mention the examen']],
    ));

    const result = extractDocumentText(path);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Slide 1/);
    assert.match(result.text, /Rules for the First Week/);
    assert.match(result.text, /Consolation and desolation/);
    assert.match(result.text, /Speaker notes/);
    assert.match(result.text, /Remember to mention the examen/);
    // Slide 1 before slide 2.
    assert.ok(result.text.indexOf('Discernment of spirits') < result.text.indexOf('Consolation and desolation'));
  });
});

test('a Word 97 .doc is read through its piece table', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'minutes.doc', buildDoc(
      'Superiors meeting minutes.\rThe novitiate visit is scheduled for March.\r',
    ));

    const result = extractDocumentText(path);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Superiors meeting minutes/);
    assert.match(result.text, /novitiate visit is scheduled for March/);
  });
});

test('a .doc that is not a Word document reports an error rather than throwing', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'broken.doc', Buffer.from('not a real OLE2 file', 'latin1'));
    const result = extractDocumentText(path);
    assert.equal(result.status, 'error');
    assert.match(result.detail, /compound file|Word/i);
  });
});

test('Pages documents are read from legacy XML, from a saved preview, or reported as unreadable', () => {
  withTempDir((directory) => {
    const legacy = writeFixture(directory, 'legacy.pages', buildPagesArchive([
      {
        name: 'index.xml',
        data: '<?xml version="1.0"?><sl:document xmlns:sf="http://developer.apple.com/namespaces/sf" xmlns:sl="http://developer.apple.com/namespaces/sl"><sf:text-body><sf:p>Retreat schedule for March</sf:p><sf:p>Second week begins Monday</sf:p></sf:text-body></sl:document>',
      },
    ]));
    const legacyResult = extractDocumentText(legacy);
    assert.equal(legacyResult.status, 'ok');
    assert.match(legacyResult.text, /Retreat schedule for March/);
    assert.match(legacyResult.text, /Second week begins Monday/);

    const withPreview = writeFixture(directory, 'preview.pages', buildPagesArchive([
      { name: 'Index/Document.iwa', data: Buffer.from([0x00, 0x01, 0x02, 0x03]) },
      { name: 'QuickLook/Preview.pdf', data: buildSimplePdf(['Chapter meeting agenda']) },
    ]));
    const previewResult = extractDocumentText(withPreview);
    assert.equal(previewResult.status, 'ok');
    assert.match(previewResult.text, /Chapter meeting agenda/);
    assert.match(previewResult.detail, /preview/i);

    const iwaOnly = writeFixture(directory, 'modern.pages', buildPagesArchive([
      { name: 'Index/Document.iwa', data: Buffer.from([0x00, 0x01, 0x02, 0x03]) },
    ]));
    const iwaResult = extractDocumentText(iwaOnly);
    assert.equal(iwaResult.status, 'empty');
    assert.match(iwaResult.detail, /proprietary compressed format/);
  });
});

test('a Pages package directory is read as one document', () => {
  withTempDir((directory) => {
    const packagePath = join(directory, 'bundle.pages');
    mkdirSync(join(packagePath, 'QuickLook'), { recursive: true });
    mkdirSync(join(packagePath, 'Index'), { recursive: true });
    writeFileSync(join(packagePath, 'QuickLook', 'Preview.pdf'), buildSimplePdf(['Formation report draft']));
    writeFileSync(join(packagePath, 'Index', 'Document.iwa'), Buffer.from([0x00]));

    const result = extractDocumentText(packagePath);
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Formation report draft/);
    // The fingerprint comes from the package contents, not the directory entry.
    assert.ok(result.size > 0);
  });
});

test('a damaged Word file reports an error rather than throwing', () => {
  withTempDir((directory) => {
    const path = writeFixture(directory, 'broken.docx', Buffer.from('PK not really a zip', 'latin1'));
    const result = extractDocumentText(path);
    assert.equal(result.status, 'error');
    assert.ok(result.detail.length > 0);
  });
});

// ── Index and search through the CLI ────────────────────────────────────────

function runCli(args, { env = {} }) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`CLI command failed: ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function parseJsonOutput(stdout) {
  const raw = String(stdout);
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
  if (start < 0 || end < start) throw new Error(`Expected JSON output:\n${stdout}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function withSandbox(run) {
  const sandboxDir = mkdtempSync(join(tmpdir(), 'puzzlepkm-document-index-'));
  const syncRoot = join(sandboxDir, 'sync-root');
  const env = {
    PUZZLEPKM_DB_PATH: join(sandboxDir, 'documents.sqlite'),
    PUZZLEPKM_SECRETS_PATH: join(sandboxDir, 'secrets.json'),
  };
  try {
    mkdirSync(syncRoot, { recursive: true });
    runCli(['settings', 'set', 'root-folder', syncRoot], { env });
    run({ sandboxDir, syncRoot, env });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }
}

const SEEDED_DOCUMENT_COUNT = 7;

function seedLibrary(sandboxDir) {
  const libraryDir = join(sandboxDir, 'external', 'ignatian-library');
  mkdirSync(join(libraryDir, 'talks', '2026'), { recursive: true });
  mkdirSync(join(libraryDir, 'archive'), { recursive: true });
  mkdirSync(join(libraryDir, 'drafts', 'Report.pages', 'QuickLook'), { recursive: true });

  writeFileSync(join(libraryDir, 'overview.md'), '# Overview\n\nAn index of magis materials.\n', 'utf8');
  writeFileSync(join(libraryDir, 'packing.txt'), 'Bring the breviary and the retreat notes.\n', 'utf8');
  writeFileSync(join(libraryDir, 'talks', 'retreat.docx'), buildDocx(['Notes on the examen and daily prayer']));
  writeFileSync(join(libraryDir, 'talks', 'deck.pptx'), buildPptx([['Rules for discernment'], ['Contemplatio ad amorem']]));
  writeFileSync(join(libraryDir, 'talks', '2026', 'plan.pdf'), buildSimplePdf(['Novitiate visit schedule', 'Culver City in March']));
  writeFileSync(join(libraryDir, 'archive', 'minutes.doc'), buildDoc('Provincial assembly minutes.\rQuaestiones were raised.\r'));
  // A package directory: one document to the user, a folder on disk.
  writeFileSync(
    join(libraryDir, 'drafts', 'Report.pages', 'QuickLook', 'Preview.pdf'),
    buildSimplePdf(['Formation report draft']),
  );
  return libraryDir;
}

test('sync indexes documents recursively and search finds their contents', () => {
  withSandbox(({ sandboxDir, env }) => {
    const libraryDir = seedLibrary(sandboxDir);
    runCli(['sources', 'add', libraryDir, '--type', 'ref-material', '--name', 'Ignatian Library'], { env });
    runCli(['sync'], { env });

    const status = parseJsonOutput(runCli(['documents', 'status', '--json'], { env }).stdout);
    assert.equal(status.documents, SEEDED_DOCUMENT_COUNT);

    // Nested three levels down, inside a PDF.
    const pdfHits = parseJsonOutput(runCli(['documents', 'search', 'Culver City', '--json'], { env }).stdout);
    assert.equal(pdfHits.length, 1);
    assert.equal(pdfHits[0].relativePath, 'talks/2026/plan.pdf');
    assert.equal(pdfHits[0].objectName, 'Ignatian Library');
    assert.match(pdfHits[0].snippet, /Culver City/);

    const docxHits = parseJsonOutput(runCli(['documents', 'search', 'examen', '--json'], { env }).stdout);
    assert.equal(docxHits.length, 1);
    assert.equal(docxHits[0].relativePath, 'talks/retreat.docx');

    const markdownHits = parseJsonOutput(runCli(['documents', 'search', 'magis', '--json'], { env }).stdout);
    assert.equal(markdownHits.length, 1);
    assert.equal(markdownHits[0].relativePath, 'overview.md');

    const pptxHits = parseJsonOutput(runCli(['documents', 'search', 'Contemplatio', '--json'], { env }).stdout);
    assert.equal(pptxHits.length, 1);
    assert.equal(pptxHits[0].relativePath, 'talks/deck.pptx');

    const docHits = parseJsonOutput(runCli(['documents', 'search', 'Quaestiones', '--json'], { env }).stdout);
    assert.equal(docHits.length, 1);
    assert.equal(docHits[0].relativePath, 'archive/minutes.doc');

    const textHits = parseJsonOutput(runCli(['documents', 'search', 'breviary', '--json'], { env }).stdout);
    assert.equal(textHits.length, 1);
    assert.equal(textHits[0].relativePath, 'packing.txt');

    // The package is one document, addressed by the package name rather than
    // by the preview file buried inside it.
    const pagesHits = parseJsonOutput(runCli(['documents', 'search', 'Formation report', '--json'], { env }).stdout);
    assert.equal(pagesHits.length, 1);
    assert.equal(pagesHits[0].relativePath, 'drafts/Report.pages');

    const missing = parseJsonOutput(runCli(['documents', 'search', 'unrelatedquery', '--json'], { env }).stdout);
    assert.equal(missing.length, 0);
  });
});

test('re-syncing skips unchanged files, re-reads edited ones, and drops deleted ones', () => {
  withSandbox(({ sandboxDir, env }) => {
    const libraryDir = seedLibrary(sandboxDir);
    runCli(['sources', 'add', libraryDir, '--type', 'project', '--name', 'Ignatian Library'], { env });
    runCli(['sync'], { env });

    const unchanged = parseJsonOutput(runCli(['documents', 'index', '--json'], { env }).stdout);
    assert.equal(unchanged.indexed, 0);
    assert.equal(unchanged.updated, 0);
    assert.equal(unchanged.unchanged, SEEDED_DOCUMENT_COUNT);

    writeFileSync(join(libraryDir, 'overview.md'), '# Overview\n\nRewritten around contemplation in action.\n', 'utf8');
    const rewritten = parseJsonOutput(runCli(['documents', 'index', '--json'], { env }).stdout);
    assert.equal(rewritten.updated, 1);
    assert.equal(
      parseJsonOutput(runCli(['documents', 'search', 'contemplation', '--json'], { env }).stdout).length,
      1,
    );
    assert.equal(
      parseJsonOutput(runCli(['documents', 'search', 'magis', '--json'], { env }).stdout).length,
      0,
    );

    unlinkSync(join(libraryDir, 'talks', 'retreat.docx'));
    const afterDelete = parseJsonOutput(runCli(['documents', 'index', '--json'], { env }).stdout);
    assert.equal(afterDelete.removed, 1);
    assert.equal(
      parseJsonOutput(runCli(['documents', 'search', 'examen', '--json'], { env }).stdout).length,
      0,
    );
  });
});

test('deleting the object clears its documents from the index', () => {
  withSandbox(({ sandboxDir, env }) => {
    const libraryDir = seedLibrary(sandboxDir);
    runCli(['sources', 'add', libraryDir, '--type', 'ref-material', '--name', 'Ignatian Library'], { env });
    runCli(['sync'], { env });

    const [refMaterial] = runCli(['list', 'ref-material'], { env }).stdout.trim().split('\n');
    const refMaterialId = refMaterial.split('\t')[0];
    runCli(['delete', 'ref-material', refMaterialId], { env });

    const status = parseJsonOutput(runCli(['documents', 'status', '--json'], { env }).stdout);
    assert.equal(status.documents, 0);
  });
});
