# Harmless Vault — API contract

The frontend never touches a database or a storage provider. It speaks only the
HTTP contract below, through `src/services/*`. Any server that implements this
contract can replace the bundled one — including a Node.js/Express + SQLite +
local filesystem server running under Termux on the Narzo 50A.

Base URL: `VITE_API_BASE_URL` (empty = same origin).

## Conventions

- All responses are JSON. Errors look like:
  `{ "error": { "code": "FOLDER_LOCKED", "message": "…", "folderId": "…" } }`
- Codes / statuses: `VALIDATION` 400, `INVALID_PIN` 401, `NOT_FOUND` 404,
  `FOLDER_LOCKED` 423, `RATE_LIMITED` 429, `SERVER_ERROR` 500.
- Unlock tickets travel in the `x-vault-unlock` header as a comma-separated
  list of hex tokens. Never in the URL.
- `:id` may be the literal `root` wherever a folder id is expected, meaning the
  top level.
- Access rule for every endpoint: if the target folder or **any ancestor** is
  PIN-protected and no valid unlock ticket is presented, respond `423` and do
  nothing else.

## Folders

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/folders` | `?parentId=` | `{ folder, breadcrumbs, folders }` |
| POST | `/api/folders` | `{ name, parentId, pin? }` | `201 { folder }` |
| PATCH | `/api/folders/:id` | `{ name? , pin? }` (`pin: null` removes it) | `{ ok: true }` |
| DELETE | `/api/folders/:id` | — | `{ ok: true }` (recursive, purges stored objects) |
| POST | `/api/folders/:id/unlock` | `{ pin }` | `{ token, expiresAt }` |
| POST | `/api/folders/:id/lock` | — | `{ ok: true }` (revokes all sessions) |
| GET | `/api/folders/:id/files` | `?search=&sort=name\|size\|created&direction=asc\|desc` | `{ folder, breadcrumbs, folders, files }` |
| GET | `/api/folders/tree` | — | `{ folders: [{ id, name }] }` (paths; locked subtrees omitted) |

## Files

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| POST | `/api/files/upload` | `{ folderId, name, size, mimeType }` | `201 { fileId, url, method, headers }` |
| POST | `/api/files/:id/complete` | `{ size }` | `{ file }` |
| DELETE | `/api/files/:id/complete` | — | `{ ok: true }` (discard cancelled upload) |
| GET | `/api/files/:id/download` | — | `{ url, name, size, mimeType }` |
| PATCH | `/api/files/:id` | `{ name }` | `{ ok: true, name }` |
| POST | `/api/files/:id/move` | `{ folderId }` | `{ ok: true }` |
| DELETE | `/api/files/:id` | — | `{ ok: true }` |
| GET | `/api/files/search` | `?q=&sort=&direction=` | `{ files }` |
| GET | `/api/stats` | — | `{ fileCount, folderCount, totalSize, unlockedCount }` |

## Streaming endpoint (bundled backend)

| Method | Path | Purpose |
| --- | --- | --- |
| PUT | `/api/storage/:token` | Streams a request body to disk (upload ticket) |
| GET | `/api/storage/:token` | Streams a file body from disk, honours `Range` (download / preview ticket) |

Tickets are opaque, single-purpose, stored hashed with an expiry (upload 12 h,
download / preview 5 min). A different backend may expose its own equivalent
path — the frontend only follows the `url` it is handed.

### Upload / download are two-step by design

`POST /api/files/upload` returns a short-lived ticket; the browser streams the
body straight to `url` with `method` and `headers`, then confirms with
`/complete`. No bytes pass through the API, so there is no application-level
size ceiling and nothing large is buffered in the page.

A filesystem backend implements the same shape: return a URL to its own
streaming endpoint (e.g. `PUT /storage/<opaque-token>`) that pipes the request
body to disk. Downloads mirror this with a signed streaming URL.

## Data model

`folders(id, name, parent_id → folders.id ON DELETE CASCADE, pin_hash,
pin_salt, pin_iterations, created_at, updated_at)`
Indexes: `parent_id`, `lower(name)`.

`files(id, folder_id → folders.id ON DELETE CASCADE, name, original_name, size,
mime_type, storage_key UNIQUE, status, created_at, updated_at)`
Indexes: `folder_id`, `status`, `lower(name)`.

`folder_unlock_sessions(id, folder_id, token_hash UNIQUE, expires_at, created_at)`
`folder_unlock_attempts(id, folder_id, client_key, succeeded, created_at)`

## Security rules the server must enforce

- PIN: exactly 4 digits; stored only as PBKDF2-SHA256, 210 000 iterations, with
  a random 16-byte per-folder salt. Verification uses a constant-time compare.
  The hash and salt are never sent to the client.
- Unlock ticket: 32 random bytes, stored **hashed**, valid 30 minutes.
- Rate limit: 5 failed unlocks per folder per client per 5 minutes → `429`.
- Storage keys are random, never derived from user input; user-supplied names
  are sanitised (control characters, `/`, `\`, `..` removed, length capped).
  Path traversal is therefore structurally impossible.
- Never log PINs, tokens, or file contents.

## Swapping in the Narzo 50A backend

1. Implement the table above with Express + SQLite; keep the same JSON shapes.
2. Store bytes under a fixed directory, named by the random `storage_key`.
3. Set `VITE_API_BASE_URL=http://192.168.x.x:3000` and rebuild the frontend —
   no application code changes.
4. Enable CORS for the frontend origin, allowing the `x-vault-unlock` header.
