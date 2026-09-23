// Server-only runtime configuration.
//
// Everything the vault persists lives under a single data directory, chosen by
// environment variables so the same code runs on Windows during development and
// inside Termux on the Narzo 50A later.
//
//   VAULT_DATA_DIR  directory for the database and the stored file bodies
//   VAULT_DB_PATH   explicit path of the SQLite file (defaults inside DATA_DIR)
//
// No cloud credentials of any kind are required.

import { mkdirSync } from "node:fs";
import path from "node:path";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** Root of all vault state. Relative values resolve against the process CWD. */
export function dataDir(): string {
  const dir = env("VAULT_DATA_DIR") ?? path.join(process.cwd(), ".vault-data");
  const resolved = path.resolve(dir);
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

/** Location of the SQLite database file. */
export function dbPath(): string {
  const explicit = env("VAULT_DB_PATH");
  const file = explicit ? path.resolve(explicit) : path.join(dataDir(), "vault.db");
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/**
 * Directory holding the raw file bodies. Deliberately OUTSIDE public/ so no
 * stored file is ever reachable as a static asset.
 */
export function blobDir(): string {
  const dir = path.join(dataDir(), "blobs");
  mkdirSync(dir, { recursive: true });
  return dir;
}
