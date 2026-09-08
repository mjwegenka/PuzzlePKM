/* eslint-env node */

// DEC-79: OOXML containers (.docx) are ZIP archives, and the CLI has no npm
// dependencies, so the reader we need lives here. Only the two stored/deflated
// cases Word actually emits are supported; anything else reports itself as
// unsupported rather than silently returning garbage.

import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_RECORD_SIGNATURE = 0x06064b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - MAX_ZIP_COMMENT_LENGTH - END_OF_CENTRAL_DIRECTORY_SIZE);
  for (let offset = buffer.length - END_OF_CENTRAL_DIRECTORY_SIZE; offset >= earliest; offset--) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  return -1;
}

// Zip64 only matters for the directory locator here: a .docx large enough to
// need 64-bit member sizes is past the size cap long before we read it.
function resolveCentralDirectoryStart(buffer, endOffset) {
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount !== 0xffff && directoryOffset !== ZIP64_MARKER) {
    return { entryCount, directoryOffset };
  }

  const locatorOffset = endOffset - 20;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_LOCATOR_SIGNATURE) {
    return { entryCount, directoryOffset };
  }
  const recordOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
  if (!Number.isSafeInteger(recordOffset) || recordOffset < 0 || recordOffset + 56 > buffer.length) {
    return { entryCount, directoryOffset };
  }
  if (buffer.readUInt32LE(recordOffset) !== ZIP64_END_RECORD_SIGNATURE) {
    return { entryCount, directoryOffset };
  }
  return {
    entryCount: Number(buffer.readBigUInt64LE(recordOffset + 32)),
    directoryOffset: Number(buffer.readBigUInt64LE(recordOffset + 48)),
  };
}

/**
 * Read a zip archive's central directory.
 * Returns a Map of entry name to header metadata, in directory order.
 */
export function readZipDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new Error('Not a zip archive');
  }

  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw new Error('Zip end-of-central-directory record not found');

  const { entryCount, directoryOffset } = resolveCentralDirectoryStart(buffer, endOffset);
  const entries = new Map();

  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const headerOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    entries.set(name, { name, method, compressedSize, uncompressedSize, headerOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Inflate one entry read from `readZipDirectory`. */
export function readZipEntry(buffer, entry) {
  if (!entry) throw new Error('Zip entry is required');
  if (entry.headerOffset + 30 > buffer.length) throw new Error(`Zip entry out of range: ${entry.name}`);
  if (buffer.readUInt32LE(entry.headerOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`Zip local header not found: ${entry.name}`);
  }

  // Local headers may carry zeroed sizes when a data descriptor follows, so the
  // central directory stays the source of truth for the byte range.
  const nameLength = buffer.readUInt16LE(entry.headerOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.headerOffset + 28);
  const start = entry.headerOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new Error(`Zip entry truncated: ${entry.name}`);

  const raw = buffer.subarray(start, end);
  if (entry.method === METHOD_STORED) return Buffer.from(raw);
  if (entry.method === METHOD_DEFLATED) return inflateRawSync(raw);
  throw new Error(`Unsupported zip compression method ${entry.method}: ${entry.name}`);
}
