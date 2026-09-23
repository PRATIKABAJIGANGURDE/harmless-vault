// Server-only data layer. Every rule (PIN checks, lock enforcement, cascade
// deletes, rate limiting) lives here, so no client can bypass it: the database
// is a local SQLite file the browser cannot reach at all.
//
// Backing store: SQLite (node:sqlite) + local filesystem storage. The same
// contract is what a Node.js/Express deployment on the Narzo 50A runs.
// See docs/API.md.

import { all, get, newId, nowIso, placeholders, run } from "./db.server";
import { hashPin, hashToken, randomHex, verifyPin } from "./pin.server";
import { isValidPin, sanitizeFileName, sanitizeFolderName } from "./sanitize";
import { getStorageService } from "./storage.server";
import type {
  BreadcrumbEntry,
  FolderView,
  SortDirection,
  SortKey,
  UploadTarget,
  VaultFile,
  VaultFolder,
  VaultStats,
} from "./types";
import { fileKind, VaultError, VaultLockedError } from "./types";

const UNLOCK_TTL_MINUTES = 30;
const UNLOCK_WINDOW_MINUTES = 5;
const UNLOCK_MAX_FAILURES = 5;
const PREVIEW_TTL_SECONDS = 300;
const MAX_PREVIEWS_PER_VIEW = 40;
const SEARCH_LIMIT = 200;

type FolderRow = {
  id: string;
  name: string;
  parent_id: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_iterations: number | null;
  created_at: string;
  updated_at: string;
};

type FileRow = {
  id: string;
  folder_id: string | null;
  name: string;
  original_name: string | null;
  size: number;
  mime_type: string;
  storage_key: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function notFound(what: string): VaultError {
  return new VaultError("NOT_FOUND", `That ${what} no longer exists.`, 404);
}

function invalid(message: string): VaultError {
  return new VaultError("VALIDATION", message, 400);
}

function assertPin(pin: string) {
  if (!isValidPin(pin)) throw invalid("The PIN must be exactly 4 digits.");
}

function folderName(name: string) {
  const clean = sanitizeFolderName(name);
  if (!String(name ?? "").trim()) throw invalid("Please enter a name.");
  return clean;
}

/** SQL LIKE is used for search; escape the wildcards a user could type. */
function likeTerm(value: string): string {
  return `%${value.replace(/[%_\\]/g, "")}%`;
}

async function getFolderRow(id: string): Promise<FolderRow> {
  const row = await get<FolderRow>("SELECT * FROM folders WHERE id = ?", [id]);
  if (!row) throw notFound("folder");
  return row;
}

/** Folder ids from the root down to (and including) `id`. */
async function ancestorChain(id: string): Promise<FolderRow[]> {
  const chain: FolderRow[] = [];
  let current: string | null = id;
  const guard = new Set<string>();
  while (current) {
    if (guard.has(current)) break;
    guard.add(current);
    const row: FolderRow = await getFolderRow(current);
    chain.unshift(row);
    current = row.parent_id;
  }
  return chain;
}

async function validTokenFolderIds(tokens: string[]): Promise<Set<string>> {
  const unlocked = new Set<string>();
  const clean = tokens.filter(Boolean);
  if (clean.length === 0) return unlocked;
  const hashes = await Promise.all(clean.map((t) => hashToken(t)));
  const rows = await all<{ folder_id: string }>(
    `SELECT folder_id FROM folder_unlock_sessions
      WHERE token_hash IN (${placeholders(hashes.length)}) AND expires_at > ?`,
    [...hashes, nowIso()],
  );
  for (const row of rows) unlocked.add(row.folder_id);
  return unlocked;
}

/**
 * Throws if `folderId` (or any of its ancestors) is PIN-protected and no valid
 * unlock session was supplied. Root (null) is always accessible.
 */
async function assertAccess(folderId: string | null, tokens: string[]): Promise<FolderRow[]> {
  if (!folderId) return [];
  const chain = await ancestorChain(folderId);
  const protectedIds = chain.filter((f) => f.pin_hash).map((f) => f.id);
  if (protectedIds.length === 0) return chain;
  const unlocked = await validTokenFolderIds(tokens);
  for (const id of protectedIds) {
    if (!unlocked.has(id)) throw new VaultLockedError(id);
  }
  return chain;
}

async function hasAccess(folderId: string | null, tokens: string[]): Promise<boolean> {
  try {
    await assertAccess(folderId, tokens);
    return true;
  } catch {
    return false;
  }
}

async function countsFor(folderIds: string[]) {
  const counts = new Map<string, { files: number; folders: number; size: number }>();
  for (const id of folderIds) counts.set(id, { files: 0, folders: 0, size: 0 });
  if (folderIds.length === 0) return counts;

  const marks = placeholders(folderIds.length);
  const [files, subs] = await Promise.all([
    all<{ folder_id: string; size: number }>(
      `SELECT folder_id, size FROM files WHERE folder_id IN (${marks}) AND status = 'ready'`,
      folderIds,
    ),
    all<{ parent_id: string }>(
      `SELECT parent_id FROM folders WHERE parent_id IN (${marks})`,
      folderIds,
    ),
  ]);

  for (const f of files) {
    const entry = counts.get(f.folder_id);
    if (entry) {
      entry.files += 1;
      entry.size += Number(f.size ?? 0);
    }
  }
  for (const s of subs) {
    const entry = counts.get(s.parent_id);
    if (entry) entry.folders += 1;
  }
  return counts;
}

function toFolder(
  row: FolderRow,
  unlocked: Set<string>,
  counts: Map<string, { files: number; folders: number; size: number }>,
): VaultFolder {
  const c = counts.get(row.id) ?? { files: 0, folders: 0, size: 0 };
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    isProtected: Boolean(row.pin_hash),
    isLocked: Boolean(row.pin_hash) && !unlocked.has(row.id),
    fileCount: c.files,
    folderCount: c.folders,
    totalSize: c.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFile(row: FileRow, previewUrl: string | null = null): VaultFile {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    originalName: row.original_name ?? row.name,
    size: Number(row.size),
    mimeType: row.mime_type,
    kind: fileKind(row.mime_type),
    previewUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Short-lived inline URLs for image files only. */
async function withPreviews(rows: FileRow[]): Promise<VaultFile[]> {
  const storage = getStorageService();
  const images = rows
    .filter((r) => r.mime_type.startsWith("image/"))
    .slice(0, MAX_PREVIEWS_PER_VIEW);
  const previews = new Map<string, string>();
  await Promise.all(
    images.map(async (row) => {
      try {
        previews.set(row.id, await storage.createPreviewUrl(row.storage_key, PREVIEW_TTL_SECONDS));
      } catch {
        // A missing preview must never break the listing.
      }
    }),
  );
  return rows.map((row) => toFile(row, previews.get(row.id) ?? null));
}

function sortFiles(files: VaultFile[], sort: SortKey, direction: SortDirection): VaultFile[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name) * factor;
    if (sort === "size") return (a.size - b.size) * factor;
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * factor;
  });
}

/* ------------------------------ read paths ------------------------------ */

export async function getFolderView(
  folderId: string | null,
  tokens: string[],
  options: { search?: string; sort?: SortKey; direction?: SortDirection } = {},
): Promise<FolderView> {
  const chain = await assertAccess(folderId, tokens);
  const unlocked = await validTokenFolderIds(tokens);
  const search = (options.search ?? "").trim();

  const parentClause = folderId ? "parent_id = ?" : "parent_id IS NULL";
  const folderParams: unknown[] = folderId ? [folderId] : [];
  const fileClause = folderId ? "folder_id = ?" : "folder_id IS NULL";
  const fileParams: unknown[] = folderId ? [folderId] : [];

  const [folderRows, fileRows] = await Promise.all([
    all<FolderRow>(
      `SELECT * FROM folders WHERE ${parentClause}${search ? " AND name LIKE ?" : ""}`,
      search ? [...folderParams, likeTerm(search)] : folderParams,
    ),
    all<FileRow>(
      `SELECT * FROM files WHERE ${fileClause} AND status = 'ready'${
        search ? " AND name LIKE ?" : ""
      }`,
      search ? [...fileParams, likeTerm(search)] : fileParams,
    ),
  ]);

  const counts = await countsFor(folderRows.map((r) => r.id));
  const current = chain.length ? chain[chain.length - 1]! : null;
  const currentCounts = current ? await countsFor([current.id]) : new Map();

  const breadcrumbs: BreadcrumbEntry[] = chain.map((f) => ({ id: f.id, name: f.name }));
  const files = await withPreviews(fileRows);

  return {
    folder: current ? toFolder(current, unlocked, currentCounts) : null,
    breadcrumbs,
    folders: folderRows
      .map((r) => toFolder(r, unlocked, counts))
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: sortFiles(files, options.sort ?? "created", options.direction ?? "desc"),
  };
}

/** Search across the whole vault; files inside locked folders are excluded. */
export async function searchFiles(input: {
  query: string;
  tokens: string[];
  sort?: SortKey;
  direction?: SortDirection;
}): Promise<VaultFile[]> {
  const term = input.query.trim();
  if (!term) return [];
  const rows = await all<FileRow>(
    "SELECT * FROM files WHERE status = 'ready' AND name LIKE ? LIMIT ?",
    [likeTerm(term), SEARCH_LIMIT],
  );

  const folderIds = Array.from(new Set(rows.map((r) => r.folder_id).filter(Boolean))) as string[];
  const allowed = new Set<string>();
  await Promise.all(
    folderIds.map(async (id) => {
      if (await hasAccess(id, input.tokens)) allowed.add(id);
    }),
  );
  const visible = rows.filter((r) => !r.folder_id || allowed.has(r.folder_id));
  const files = await withPreviews(visible);
  return sortFiles(files, input.sort ?? "created", input.direction ?? "desc");
}

/* ------------------------------ folder ops ------------------------------ */

export async function createFolder(input: {
  name: string;
  parentId: string | null;
  pin?: string | null | undefined;
  tokens: string[];
}): Promise<VaultFolder> {
  const name = folderName(input.name);
  await assertAccess(input.parentId, input.tokens);

  let pin: { hash: string; salt: string; iterations: number } | null = null;
  if (input.pin) {
    assertPin(input.pin);
    pin = await hashPin(input.pin);
  }

  const id = newId();
  const ts = nowIso();
  await run(
    `INSERT INTO folders (id, name, parent_id, pin_hash, pin_salt, pin_iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, input.parentId, pin?.hash ?? null, pin?.salt ?? null, pin?.iterations ?? null, ts, ts],
  );
  return toFolder(await getFolderRow(id), new Set(), new Map());
}

export async function renameFolder(input: { folderId: string; name: string; tokens: string[] }) {
  const name = folderName(input.name);
  await assertAccess(input.folderId, input.tokens);
  await run("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?", [
    name,
    nowIso(),
    input.folderId,
  ]);
  return { ok: true };
}

/** Collects the folder and every descendant, so storage objects can be purged. */
async function collectSubtree(folderId: string): Promise<string[]> {
  const found = [folderId];
  let frontier = [folderId];
  while (frontier.length) {
    const rows = await all<{ id: string }>(
      `SELECT id FROM folders WHERE parent_id IN (${placeholders(frontier.length)})`,
      frontier,
    );
    frontier = rows.map((r) => r.id);
    found.push(...frontier);
  }
  return found;
}

export async function deleteFolder(input: { folderId: string; tokens: string[] }) {
  await assertAccess(input.folderId, input.tokens);
  const ids = await collectSubtree(input.folderId);
  const files = await all<{ storage_key: string }>(
    `SELECT storage_key FROM files WHERE folder_id IN (${placeholders(ids.length)})`,
    ids,
  );
  const keys = files.map((f) => f.storage_key);
  if (keys.length) await getStorageService().remove(keys);
  // ON DELETE CASCADE removes descendants, their files and unlock sessions.
  await run("DELETE FROM folders WHERE id = ?", [input.folderId]);
  return { ok: true };
}

/* --------------------------------- PINs --------------------------------- */

export async function setFolderPin(input: { folderId: string; pin: string; tokens: string[] }) {
  assertPin(input.pin);
  const row = await getFolderRow(input.folderId);
  // Changing an existing PIN requires the folder to be unlocked first.
  if (row.pin_hash) await assertAccess(input.folderId, input.tokens);
  const { hash, salt, iterations } = await hashPin(input.pin);
  await run(
    "UPDATE folders SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, updated_at = ? WHERE id = ?",
    [hash, salt, iterations, nowIso(), input.folderId],
  );
  await revokeSessions(input.folderId);
  return { ok: true };
}

export async function removeFolderPin(input: { folderId: string; tokens: string[] }) {
  await assertAccess(input.folderId, input.tokens);
  await run(
    "UPDATE folders SET pin_hash = NULL, pin_salt = NULL, pin_iterations = NULL, updated_at = ? WHERE id = ?",
    [nowIso(), input.folderId],
  );
  await revokeSessions(input.folderId);
  return { ok: true };
}

async function revokeSessions(folderId: string) {
  await run("DELETE FROM folder_unlock_sessions WHERE folder_id = ?", [folderId]);
}

/** Throttles brute force without revealing whether the folder is protected. */
async function assertUnlockAllowed(folderId: string, clientKey: string) {
  const since = new Date(Date.now() - UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
  const row = await get<{ failures: number }>(
    `SELECT COUNT(*) AS failures FROM folder_unlock_attempts
      WHERE folder_id = ? AND client_key = ? AND succeeded = 0 AND created_at > ?`,
    [folderId, clientKey, since],
  );
  if ((row?.failures ?? 0) >= UNLOCK_MAX_FAILURES) {
    throw new VaultError(
      "RATE_LIMITED",
      `Too many attempts. Try again in ${UNLOCK_WINDOW_MINUTES} minutes.`,
      429,
    );
  }
}

async function recordAttempt(folderId: string, clientKey: string, succeeded: boolean) {
  await run(
    `INSERT INTO folder_unlock_attempts (id, folder_id, client_key, succeeded, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [newId(), folderId, clientKey, succeeded ? 1 : 0, nowIso()],
  );
}

export async function unlockFolder(input: {
  folderId: string;
  pin: string;
  clientKey?: string;
}): Promise<{ token: string | null; expiresAt: string | null }> {
  const clientKey = input.clientKey || "unknown";
  const row = await getFolderRow(input.folderId);
  if (!row.pin_hash || !row.pin_salt || !row.pin_iterations) {
    return { token: null, expiresAt: null };
  }
  await assertUnlockAllowed(input.folderId, clientKey);

  // Clear expired sessions and stale attempt records opportunistically.
  await run("DELETE FROM folder_unlock_sessions WHERE expires_at < ?", [nowIso()]);
  await run("DELETE FROM folder_unlock_attempts WHERE created_at < ?", [
    new Date(Date.now() - 24 * 3600_000).toISOString(),
  ]);

  const ok = await verifyPin(input.pin, {
    hash: row.pin_hash,
    salt: row.pin_salt,
    iterations: row.pin_iterations,
  });
  await recordAttempt(input.folderId, clientKey, ok);
  if (!ok) throw new VaultError("INVALID_PIN", "That PIN is incorrect.", 401);

  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + UNLOCK_TTL_MINUTES * 60_000).toISOString();
  await run(
    `INSERT INTO folder_unlock_sessions (id, folder_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [newId(), input.folderId, await hashToken(token), expiresAt, nowIso()],
  );
  return { token, expiresAt };
}

export async function lockFolder(input: { folderId: string }) {
  await revokeSessions(input.folderId);
  return { ok: true };
}

/* --------------------------------- files -------------------------------- */

export async function createUpload(input: {
  folderId: string | null;
  name: string;
  size: number;
  mimeType: string;
  tokens: string[];
}): Promise<UploadTarget> {
  const name = sanitizeFileName(input.name);
  await assertAccess(input.folderId, input.tokens);

  // Storage keys are random — never derived from user input, so traversal is
  // structurally impossible whichever backend stores the bytes.
  const storageKey = `${input.folderId ?? "root"}/${randomHex(16)}`;
  const mimeType = (input.mimeType || "application/octet-stream").slice(0, 255);
  const id = newId();
  const ts = nowIso();
  await run(
    `INSERT INTO files (id, folder_id, name, original_name, size, mime_type, storage_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
    [
      id,
      input.folderId,
      name,
      name,
      Math.max(0, Math.floor(input.size)),
      mimeType,
      storageKey,
      ts,
      ts,
    ],
  );

  const ticket = await getStorageService().createUploadTicket(storageKey, mimeType);
  return { fileId: id, ...ticket };
}

export async function completeUpload(input: { fileId: string; size: number; tokens: string[] }) {
  const row = await get<FileRow>("SELECT * FROM files WHERE id = ?", [input.fileId]);
  if (!row) throw notFound("file");
  await assertAccess(row.folder_id, input.tokens);
  const size = Math.max(0, Math.floor(input.size));
  await run("UPDATE files SET status = 'ready', size = ?, updated_at = ? WHERE id = ?", [
    size,
    nowIso(),
    input.fileId,
  ]);
  return toFile({ ...row, status: "ready", size });
}

/** Removes the database row and object for an upload that never finished. */
export async function abandonUpload(input: { fileId: string; tokens: string[] }) {
  const row = await get<FileRow>("SELECT * FROM files WHERE id = ?", [input.fileId]);
  if (!row) return { ok: true };
  if (row.status === "ready") return { ok: true };
  await assertAccess(row.folder_id, input.tokens);
  await getStorageService().remove([row.storage_key]);
  await run("DELETE FROM files WHERE id = ?", [input.fileId]);
  return { ok: true };
}

async function getFileRow(fileId: string, tokens: string[]): Promise<FileRow> {
  const row = await get<FileRow>("SELECT * FROM files WHERE id = ?", [fileId]);
  if (!row) throw notFound("file");
  await assertAccess(row.folder_id, tokens);
  return row;
}

export async function getDownloadUrl(input: { fileId: string; tokens: string[] }) {
  const row = await getFileRow(input.fileId, input.tokens);
  const url = await getStorageService().createDownloadUrl(row.storage_key, row.name);
  return { url, name: row.name, size: Number(row.size), mimeType: row.mime_type };
}

export async function renameFile(input: { fileId: string; name: string; tokens: string[] }) {
  if (!String(input.name ?? "").trim()) throw invalid("Please enter a name.");
  const name = sanitizeFileName(input.name);
  await getFileRow(input.fileId, input.tokens);
  await run("UPDATE files SET name = ?, updated_at = ? WHERE id = ?", [
    name,
    nowIso(),
    input.fileId,
  ]);
  return { ok: true, name };
}

/** Moving requires access to BOTH the current and the destination folder. */
export async function moveFile(input: {
  fileId: string;
  folderId: string | null;
  tokens: string[];
}) {
  await getFileRow(input.fileId, input.tokens);
  await assertAccess(input.folderId, input.tokens);
  await run("UPDATE files SET folder_id = ?, updated_at = ? WHERE id = ?", [
    input.folderId,
    nowIso(),
    input.fileId,
  ]);
  return { ok: true };
}

export async function deleteFile(input: { fileId: string; tokens: string[] }) {
  const row = await getFileRow(input.fileId, input.tokens);
  await getStorageService().remove([row.storage_key]);
  await run("DELETE FROM files WHERE id = ?", [input.fileId]);
  return { ok: true };
}

/** Folders the caller may move a file into (locked subtrees are omitted). */
export async function listAccessibleFolders(tokens: string[]): Promise<BreadcrumbEntry[]> {
  const rows = await all<FolderRow>("SELECT * FROM folders ORDER BY name");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unlocked = await validTokenFolderIds(tokens);

  const pathOf = (row: FolderRow): string | null => {
    const parts: string[] = [];
    let current: FolderRow | undefined = row;
    const guard = new Set<string>();
    while (current) {
      if (guard.has(current.id)) break;
      guard.add(current.id);
      if (current.pin_hash && !unlocked.has(current.id)) return null;
      parts.unshift(current.name);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return parts.join(" / ");
  };

  const out: BreadcrumbEntry[] = [];
  for (const row of rows) {
    const path = pathOf(row);
    if (path) out.push({ id: row.id, name: path });
  }
  return out;
}

export async function getVaultStats(tokens: string[]): Promise<VaultStats> {
  const unlocked = await validTokenFolderIds(tokens);
  const files = await get<{ count: number; total: number | null }>(
    "SELECT COUNT(*) AS count, SUM(size) AS total FROM files WHERE status = 'ready'",
  );
  const folders = await get<{ count: number }>("SELECT COUNT(*) AS count FROM folders");
  return {
    fileCount: files?.count ?? 0,
    folderCount: folders?.count ?? 0,
    totalSize: Number(files?.total ?? 0),
    unlockedCount: unlocked.size,
  };
}
