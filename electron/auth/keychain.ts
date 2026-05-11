import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

interface SecretStoreEntry {
  payload: string;
  encrypted: boolean;
}

interface SecretStoreFile {
  version: 1;
  encrypted?: boolean;
  values: Record<string, string | SecretStoreEntry>;
}

const STORE_FILE_NAME = 'secrets.json';
const FALLBACK: Map<string, string> = new Map();

function getStorePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE_NAME);
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encodeValue(value: string): { encrypted: boolean; payload: string } {
  if (canEncrypt()) {
    const encrypted = safeStorage.encryptString(value);
    return { encrypted: true, payload: encrypted.toString('base64') };
  }

  return {
    encrypted: false,
    payload: Buffer.from(value, 'utf8').toString('base64'),
  };
}

function decodeValue(payload: string, encrypted: boolean): string {
  const buffer = Buffer.from(payload, 'base64');
  if (encrypted && canEncrypt()) {
    return safeStorage.decryptString(buffer);
  }

  return buffer.toString('utf8');
}

async function readStore(): Promise<Map<string, string>> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as SecretStoreFile;
    const values = Object.entries(parsed.values ?? {}).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, decodeValue(value, parsed.encrypted ?? false)] as const;
      }
      return [key, decodeValue(value.payload, value.encrypted)] as const;
    });
    return new Map(values);
  } catch {
    return new Map(FALLBACK);
  }
}

async function writeStore(values: Map<string, string>): Promise<void> {
  const entries = Array.from(values.entries()).map(([key, value]) => {
    const encoded = encodeValue(value);
    return [key, encoded.payload, encoded.encrypted] as const;
  });

  const file: SecretStoreFile = {
    version: 1,
    values: Object.fromEntries(entries.map(([key, payload, entryEncrypted]) => [
      key,
      { payload, encrypted: entryEncrypted },
    ])),
  };

  await fs.mkdir(path.dirname(getStorePath()), { recursive: true });
  await fs.writeFile(getStorePath(), JSON.stringify(file, null, 2), 'utf8');
  FALLBACK.clear();
  for (const [key, value] of values.entries()) {
    FALLBACK.set(key, value);
  }
}

export async function getSecret(key: string): Promise<string | null> {
  const store = await readStore();
  return store.get(key) ?? null;
}

export async function setSecret(key: string, value: string): Promise<void> {
  const store = await readStore();
  store.set(key, value);
  await writeStore(store);
}

export async function deleteSecret(key: string): Promise<void> {
  const store = await readStore();
  store.delete(key);
  await writeStore(store);
}
