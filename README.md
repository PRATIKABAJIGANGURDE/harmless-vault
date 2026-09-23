# Harmless Vault

A private file vault with PIN-protected folders. Files are stored on the
machine that runs the server — a local SQLite database for metadata and a
plain directory for the file bodies. No cloud account, no API keys.

```
React / TanStack Start  →  server API  →  SQLite  →  local filesystem
```

## Requirements

- Node.js 22.5 or newer (the server uses the built-in `node:sqlite`, so there
  is no native module to compile — this matters on Windows and on Termux).
- npm (or bun/pnpm).

## Run it locally

```sh
npm install
npm run dev
```

The app is then on http://localhost:8080. On first start it creates
`./.vault-data/` containing `vault.db` and a `blobs/` directory. Nothing else
is required — there are **no** Supabase or other cloud credentials.

Production build and serve (self-hosted Node.js — Windows, Linux, Termux):

```sh
npm run build:node   # builds a plain Node server into dist/
npm start            # node dist/server/index.mjs
```

`npm run build` is the hosted/edge build and is **not** usable for self-hosting:
the vault server uses `node:sqlite` and the local filesystem, which only exist
on a Node runtime. Always use `build:node` on your own machine or the phone.

## Configuration

All optional; copy `.env.example` to `.env` to change anything.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VAULT_DATA_DIR` | `./.vault-data` | Where the database and stored files live |
| `VAULT_DB_PATH` | `<VAULT_DATA_DIR>/vault.db` | Explicit database file path |
| `VITE_API_BASE_URL` | empty (same origin) | Where the frontend sends API calls |

Examples:

```sh
# Windows
VAULT_DATA_DIR=D:\vault-data

# Android / Termux
VAULT_DATA_DIR=/data/data/com.termux/files/home/vault-data

# Frontend hosted separately, API on the phone
VITE_API_BASE_URL=http://192.168.1.42:3000
```

File bodies are always stored outside `public/`, under random names, so they
are never served statically and filenames can never escape the data directory.

## Running on the Narzo 50A (Termux)

```sh
pkg install nodejs-lts git
git clone <this-repository-url> && cd <repository-name>
npm install
export VAULT_DATA_DIR=$HOME/vault-data
npm run build && npm start
```

Reach it from other devices on the same Wi‑Fi at `http://<phone-ip>:8080`.
Keep `VAULT_DATA_DIR` on internal storage — Android's shared-storage mounts do
not support the file locking SQLite needs.

If you replace this server with your own Express implementation, follow
[`docs/API.md`](docs/API.md): it documents every endpoint, the database schema
and the security rules, and the frontend needs only `VITE_API_BASE_URL` to
point at it.

## Backups

Stop the server and copy the whole `VAULT_DATA_DIR` — `vault.db` plus `blobs/`
are the complete vault.

## Tests

```sh
npx vitest run            # filename / PIN sanitisation unit tests
npm run dev               # in one terminal, then:
npx tsx scripts/api-e2e.ts    # full API flow against the running server
```

The end-to-end script covers folders, nesting, PIN lock/unlock, upload,
listing, download, rename, move, delete and error codes.

## Project layout

```
src/components/vault   UI
src/services           the only place the frontend talks HTTP
src/routes/api         the REST API
src/lib/vault          repository (SQLite), storage service, PIN hashing
```

Storage and persistence sit behind small interfaces (`storage.server.ts`,
`repo.server.ts`), so swapping the filesystem for something else does not touch
the UI.
