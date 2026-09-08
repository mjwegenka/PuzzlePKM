/* eslint-env node */

// DEC-79: Compound File Binary reader — the container Office used before the
// XML formats. A .doc is a little filesystem: sector-allocation tables, a
// directory of named streams, and a second "mini" allocation scheme for the
// small streams. Only reading is implemented, and only what is needed to pull
// one named stream out whole.

import { Buffer } from 'node:buffer';

const SIGNATURE = 'd0cf11e0a1b11ae1';
const HEADER_DIFAT_OFFSET = 0x4c;
const HEADER_DIFAT_ENTRIES = 109;
const DIRECTORY_ENTRY_SIZE = 128;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const MAX_CHAIN_LENGTH = 1 << 22;
const ENTRY_TYPE_STREAM = 2;
const ENTRY_TYPE_ROOT = 5;

export function isCompoundFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 512 && buffer.toString('hex', 0, 8) === SIGNATURE;
}

class CompoundFile {
  constructor(buffer) {
    if (!isCompoundFile(buffer)) throw new Error('Not a compound file (OLE2) container');
    this.buffer = buffer;
    this.sectorSize = 1 << buffer.readUInt16LE(0x1e);
    this.miniSectorSize = 1 << buffer.readUInt16LE(0x20);
    this.miniStreamCutoff = buffer.readUInt32LE(0x38);
    if (this.sectorSize < 128 || this.sectorSize > 1 << 20) throw new Error('Unsupported compound file sector size');

    this.fat = this.readFat();
    this.miniFat = this.readChainValues(buffer.readUInt32LE(0x3c), buffer.readUInt32LE(0x40));
    this.directory = this.readDirectory(buffer.readUInt32LE(0x30));
    this.root = this.directory.find((entry) => entry.type === ENTRY_TYPE_ROOT) ?? null;
  }

  sectorOffset(sector) {
    return (sector + 1) * this.sectorSize;
  }

  readSector(sector) {
    const start = this.sectorOffset(sector);
    return this.buffer.subarray(start, Math.min(start + this.sectorSize, this.buffer.length));
  }

  // The DIFAT lists the FAT's own sectors: 109 entries live in the header and
  // the rest chain through dedicated sectors.
  readFat() {
    const fatSectors = [];
    for (let index = 0; index < HEADER_DIFAT_ENTRIES; index++) {
      const sector = this.buffer.readUInt32LE(HEADER_DIFAT_OFFSET + index * 4);
      if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
      fatSectors.push(sector);
    }

    const entriesPerSector = this.sectorSize / 4;
    let difatSector = this.buffer.readUInt32LE(0x44);
    const difatCount = this.buffer.readUInt32LE(0x48);
    for (let visited = 0; visited < difatCount && difatSector !== END_OF_CHAIN && difatSector !== FREE_SECTOR; visited++) {
      const sector = this.readSector(difatSector);
      if (sector.length < this.sectorSize) break;
      for (let index = 0; index < entriesPerSector - 1; index++) {
        const value = sector.readUInt32LE(index * 4);
        if (value === FREE_SECTOR || value === END_OF_CHAIN) continue;
        fatSectors.push(value);
      }
      difatSector = sector.readUInt32LE((entriesPerSector - 1) * 4);
    }

    const fat = [];
    for (const fatSector of fatSectors) {
      const sector = this.readSector(fatSector);
      for (let index = 0; index * 4 + 4 <= sector.length; index++) {
        fat.push(sector.readUInt32LE(index * 4));
      }
    }
    return fat;
  }

  /** Sector numbers in a chain, following the FAT from `start`. */
  followChain(start) {
    const chain = [];
    let sector = start;
    while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && chain.length < MAX_CHAIN_LENGTH) {
      if (!Number.isInteger(sector) || sector < 0 || sector >= this.fat.length) break;
      chain.push(sector);
      sector = this.fat[sector];
    }
    return chain;
  }

  /** Read a chain of sectors as a table of 32-bit values (used for the miniFAT). */
  readChainValues(start, expectedSectors) {
    if (start === END_OF_CHAIN || start === FREE_SECTOR || expectedSectors === 0) return [];
    const values = [];
    for (const sector of this.followChain(start)) {
      const data = this.readSector(sector);
      for (let index = 0; index * 4 + 4 <= data.length; index++) values.push(data.readUInt32LE(index * 4));
    }
    return values;
  }

  readDirectory(start) {
    const entries = [];
    for (const sector of this.followChain(start)) {
      const data = this.readSector(sector);
      for (let offset = 0; offset + DIRECTORY_ENTRY_SIZE <= data.length; offset += DIRECTORY_ENTRY_SIZE) {
        const nameLength = data.readUInt16LE(offset + 0x40);
        const type = data[offset + 0x42];
        if (type !== ENTRY_TYPE_STREAM && type !== ENTRY_TYPE_ROOT) continue;
        // nameLength counts bytes including the UTF-16 terminator.
        const name = nameLength > 2
          ? data.toString('utf16le', offset, offset + Math.min(nameLength - 2, 0x40))
          : '';
        entries.push({
          name,
          type,
          startSector: data.readUInt32LE(offset + 0x74),
          size: Number(data.readBigUInt64LE(offset + 0x78) & 0xffffffffn),
        });
      }
    }
    return entries;
  }

  readFromChain(start, size, sectorSize, readSector) {
    const parts = [];
    let remaining = size;
    for (const sector of this.followChain(start)) {
      if (remaining <= 0) break;
      const data = readSector(sector);
      parts.push(data.subarray(0, Math.min(remaining, sectorSize)));
      remaining -= sectorSize;
    }
    return Buffer.concat(parts, Math.max(0, size - Math.max(0, remaining)));
  }

  /** The container holding every stream shorter than the mini-stream cutoff. */
  miniStream() {
    if (this.miniStreamCache) return this.miniStreamCache;
    if (!this.root) return Buffer.alloc(0);
    this.miniStreamCache = this.readFromChain(
      this.root.startSector,
      this.root.size,
      this.sectorSize,
      (sector) => this.readSector(sector),
    );
    return this.miniStreamCache;
  }

  readMiniSector(sector) {
    const container = this.miniStream();
    const start = sector * this.miniSectorSize;
    return container.subarray(start, Math.min(start + this.miniSectorSize, container.length));
  }

  followMiniChain(start) {
    const chain = [];
    let sector = start;
    while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && chain.length < MAX_CHAIN_LENGTH) {
      if (!Number.isInteger(sector) || sector < 0 || sector >= this.miniFat.length) break;
      chain.push(sector);
      sector = this.miniFat[sector];
    }
    return chain;
  }

  /** Read one named stream in full, or null when the container has no such stream. */
  readStream(name) {
    const entry = this.directory.find((candidate) => candidate.type === ENTRY_TYPE_STREAM && candidate.name === name);
    if (!entry || entry.size === 0) return null;

    if (entry.size < this.miniStreamCutoff) {
      const parts = [];
      let remaining = entry.size;
      for (const sector of this.followMiniChain(entry.startSector)) {
        if (remaining <= 0) break;
        const data = this.readMiniSector(sector);
        parts.push(data.subarray(0, Math.min(remaining, this.miniSectorSize)));
        remaining -= this.miniSectorSize;
      }
      return Buffer.concat(parts);
    }

    return this.readFromChain(entry.startSector, entry.size, this.sectorSize, (sector) => this.readSector(sector));
  }

  /** Names of every stream in the container, for diagnostics. */
  streamNames() {
    return this.directory.filter((entry) => entry.type === ENTRY_TYPE_STREAM).map((entry) => entry.name);
  }
}

export function readCompoundFile(buffer) {
  return new CompoundFile(buffer);
}
