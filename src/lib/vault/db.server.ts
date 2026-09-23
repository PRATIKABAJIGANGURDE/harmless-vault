// SQLite access layer.
//
// The whole vault runs on one local SQLite file through Node's built-in
// `node:sqlite` driver — no native build step, which matters on Termux where
// compiling native modules is painful. The rest of the server only sees the
// small `all/get/run/tx` helpers below, so swapping the driver (better-sqlite3,
// libsql, ...) means changing this file alone.

import { dbPath } from "./config.server";

type Statement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => { changes: number };
};

type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  parent_id      TEXT REFERENCES folders(id) ON DELETE CASCADE,
  pin_hash       TEXT,
  pin_salt       TEXT,
  pin_iterations INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id);
CREATE INDEX IF NOT EXISTS folders_name_idx ON folders(lower(name));

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  folder_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
  storage_key   TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'uploading',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_folder_idx ON files(folder_id);
CREATE INDEX IF NOT EXISTS files_status_idx ON files(status);
CREATE INDEX IF NOT EXISTS files_name_idx ON files(lower(name));

CREATE TABLE IF NOT EXISTS folder_unlock_sessions (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unlock_sessions_folder_idx
  ON folder_unlock_sessions(folder_id, expires_at);

CREATE TABLE IF NOT EXISTS folder_unlock_attempts (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  succeeded  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unlock_attempts_idx
  ON folder_unlock_attempts(folder_id, client_key, created_at);

-- Short-lived capabilities that let the browser stream a body in or out
-- without the API ever buffering it. Only the hash of the token is stored.
CREATE TABLE IF NOT EXISTS storage_tickets (
  token_hash  TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL,
  mode        TEXT NOT NULL,
  file_name   TEXT,
  mime_type   TEXT,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS storage_tickets_expiry_idx ON storage_tickets(expires_at);
`;

let instance: Db | null = null;

async function open(): Promise<Db> {
  // Computed specifier: keeps bundlers from trying to resolve a Node builtin
  // that only exists in the Node/Termux runtime this server targets.
  const moduleName = "node:sqlite";
  const { DatabaseSync } = (await import(/* @vite-ignore */ moduleName)) as {
    DatabaseSync: new (path: string) => Db;
  };
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}

/** Opens (and on first call initialises/migrates) the local database. */
export async function getDb(): Promise<Db> {
  if (!instance) instance = await open();
  return instance;
}

export async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.prepare(sql).all(...params) as T[];
}

export async function get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const db = await getDb();
  return (db.prepare(sql).get(...params) as T | undefined) ?? null;
}

export async function run(sql: string, params: unknown[] = []): Promise<number> {
  const db = await getDb();
  return db.prepare(sql).run(...params).changes;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Builds `(?, ?, ?)` placeholders for an IN clause. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
