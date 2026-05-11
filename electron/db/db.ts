import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import path from 'node:path';
import { schema } from './schema.js';

interface RunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

interface PreparedStatement {
  run(...params: unknown[]): RunResult;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}

export interface AppDatabase {
  prepare(sql: string): PreparedStatement;
  transaction<T>(fn: () => T): () => T;
  pragma(sql: string): void;
  close(): void;
}

class SqliteStatement implements PreparedStatement {
  constructor(private readonly statement: ReturnType<DatabaseSync['prepare']>) {}

  run(...params: unknown[]): RunResult {
    return (this.statement.run as (...args: unknown[]) => RunResult)(...params);
  }

  get<T = unknown>(...params: unknown[]): T | undefined {
    return (this.statement.get as (...args: unknown[]) => T | undefined)(...params);
  }

  all<T = unknown>(...params: unknown[]): T[] {
    return (this.statement.all as (...args: unknown[]) => T[])(...params);
  }
}

class SqliteDatabase implements AppDatabase {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): PreparedStatement {
    return new SqliteStatement(this.db.prepare(sql));
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec('BEGIN');
      try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  pragma(sql: string): void {
    this.db.exec(`PRAGMA ${sql}`);
  }

  close(): void {
    this.db.close();
  }
}

let _db: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (!_db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return _db;
}

export function initDb(): AppDatabase {
  if (_db) return _db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'dropith.sqlite');

  _db = new SqliteDatabase(new DatabaseSync(dbPath));
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Run schema (all statements)
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    _db.prepare(stmt).run();
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
