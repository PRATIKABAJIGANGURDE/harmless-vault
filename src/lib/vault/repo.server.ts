// Server-only data layer. Every rule (PIN checks, lock enforcement, cascade
// deletes, rate limiting) lives here, so no client can bypass it: the database
// tables are not reachable from the browser at all.
//
// This module is the contract a future Node.js/Express + SQLite implementation
// on the Narzo 50A must reproduce. See docs/API.md.

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

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function notFound(what: string): VaultError {
  return new VaultError("NOT_FOUND", `That ${what} no longer exists.`, 404);
}

function invalid(message: string): VaultError {
  return new VaultError("VALIDATION", message, 400);
}

function dbError(message: string): VaultError {
  // Never leak raw provider/database detail to the client.
  console.error("[vault] database error:", message);
  return new VaultError("SERVER_ERROR", "The vault could not complete that request.", 500);
}

function assertPin(pin: string) {
  if (!isValidPin(pin)) throw invalid("The PIN must be exactly 4 digits.");
}

function folderName(name: string) {
  const clean = sanitizeFolderName(name);
  if (!clean || clean === "untitled") {
    if (!String(name ?? "").trim()) throw invalid("Please enter a name.");
  }
  return clean;
}

async function getFolderRow(id: string): Promise<FolderRow> {
  const supabase = await db();
  const { data, error } = await supabase.from("folders").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error.message);
  if (!data) throw notFound("folder");
  return data as FolderRow;
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
  const supabase = await db();
  const hashes = await Promise.all(clean.map((t) => hashToken(t)));
  const { data, error } = await supabase
    .from("folder_unlock_sessions")
    .select("folder_id, expires_at")
    .in("token_hash", hashes)
    .gt("expires_at", new Date().toISOString());
  if (error) throw dbError(error.message);
  for (const row of data ?? []) unlocked.add(row.folder_id as string);
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
  const supabase = await db();
  const counts = new Map<string, { files: number; folders: number; size: number }>();
  for (const id of folderIds) counts.set(id, { files: 0, folders: 0, size: 0 });
  if (folderIds.length === 0) return counts;

  const [{ data: files, error: fErr }, { data: subs, error: sErr }] = await Promise.all([
    supabase
      .from("files")
      .select("folder_id, size")
      .in("folder_id", folderIds)
      .eq("status", "ready"),
    supabase.from("folders").select("parent_id").in("parent_id", folderIds),
  ]);
  if (fErr) throw dbError(fErr.message);
  if (sErr) throw dbError(sErr.message);

  for (const f of files ?? []) {
    const entry = counts.get(f.folder_id as string);
    if (entry) {
      entry.files += 1;
      entry.size += Number(f.size ?? 0);
    }
  }
  for (const s of subs ?? []) {
    const entry = counts.get(s.parent_id as string);
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

/** Signed, short-lived inline URLs for image files only. */
async function withPreviews(rows: FileRow[]): Promise<VaultFile[]> {
  const storage = getStorageService();
  const images = rows.filter((r) => r.mime_type.startsWith("image/")).slice(0, MAX_PREVIEWS_PER_VIEW);
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
  const supabase = await db();
  const chain = await assertAccess(folderId, tokens);
  const unlocked = await validTokenFolderIds(tokens);
  const search = (options.search ?? "").trim();

  const folderQuery = folderId
    ? supabase.from("folders").select("*").eq("parent_id", folderId)
    : supabase.from("folders").select("*").is("parent_id", null);
  let fileQuery = folderId
    ? supabase.from("files").select("*").eq("folder_id", folderId)
    : supabase.from("files").select("*").is("folder_id", null);
  fileQuery = fileQuery.eq("status", "ready");
  if (search) fileQuery = fileQuery.ilike("name", `%${search.replace(/[%_]/g, "")}%`);

  const [{ data: folderRows, error: folderErr }, { data: fileRows, error: fileErr }] =
    await Promise.all([
      search ? folderQuery.ilike("name", `%${search.replace(/[%_]/g, "")}%`) : folderQuery,
      fileQuery,
    ]);
  if (folderErr) throw dbError(folderErr.message);
  if (fileErr) throw dbError(fileErr.message);

  const rows = (folderRows ?? []) as FolderRow[];
  const counts = await countsFor(rows.map((r) => r.id));
  const current = chain.length ? chain[chain.length - 1]! : null;
  const currentCounts = current ? await countsFor([current.id]) : new Map();

  const breadcrumbs: BreadcrumbEntry[] = chain.map((f) => ({ id: f.id, name: f.name }));
  const files = await withPreviews((fileRows ?? []) as FileRow[]);

  return {
    folder: current ? toFolder(current, unlocked, currentCounts) : null,
    breadcrumbs,
    folders: rows
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
  const supabase = await db();
  const term = input.query.trim().replace(/[%_]/g, "");
  if (!term) return [];
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("status", "ready")
    .ilike("name", `%${term}%`)
    .limit(SEARCH_LIMIT);
  if (error) throw dbError(error.message);

  const rows = (data ?? []) as FileRow[];
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
  const supabase = await db();
  const name = folderName(input.name);
  await assertAccess(input.parentId, input.tokens);

  let pinFields: Record<string, unknown> = {};
  if (input.pin) {
    assertPin(input.pin);
    const { hash, salt, iterations } = await hashPin(input.pin);
    pinFields = { pin_hash: hash, pin_salt: salt, pin_iterations: iterations };
  }

  const { data, error } = await supabase
    .from("folders")
    .insert({ name, parent_id: input.parentId, ...pinFields })
    .select("*")
    .single();
  if (error) throw dbError(error.message);
  return toFolder(data as FolderRow, new Set(), new Map());
}

export async function renameFolder(input: { folderId: string; name: string; tokens: string[] }) {
  const supabase = await db();
  const name = folderName(input.name);
  await assertAccess(input.folderId, input.tokens);
  const { error } = await supabase.from("folders").update({ name }).eq("id", input.folderId);
  if (error) throw dbError(error.message);
  return { ok: true };
}

/** Collects the folder and every descendant, so storage objects can be purged. */
async function collectSubtree(folderId: string): Promise<string[]> {
  const supabase = await db();
  const all = [folderId];
  let frontier = [folderId];
  while (frontier.length) {
    const { data, error } = await supabase.from("folders").select("id").in("parent_id", frontier);
    if (error) throw dbError(error.message);
    frontier = (data ?? []).map((r) => r.id as string);
    all.push(...frontier);
  }
  return all;
}

export async function deleteFolder(input: { folderId: string; tokens: string[] }) {
  const supabase = await db();
  await assertAccess(input.folderId, input.tokens);
  const ids = await collectSubtree(input.folderId);
  const { data: files, error } = await supabase
    .from("files")
    .select("storage_key")
    .in("folder_id", ids);
  if (error) throw dbError(error.message);
  const keys = (files ?? []).map((f) => f.storage_key as string);
  if (keys.length) await getStorageService().remove(keys);
  const { error: delErr } = await supabase.from("folders").delete().eq("id", input.folderId);
  if (delErr) throw dbError(delErr.message);
  return { ok: true };
}

/* --------------------------------- PINs --------------------------------- */

export async function setFolderPin(input: { folderId: string; pin: string; tokens: string[] }) {
  const supabase = await db();
  assertPin(input.pin);
  const row = await getFolderRow(input.folderId);
  // Changing an existing PIN requires the folder to be unlocked first.
  if (row.pin_hash) await assertAccess(input.folderId, input.tokens);
  const { hash, salt, iterations } = await hashPin(input.pin);
  const { error } = await supabase
    .from("folders")
    .update({ pin_hash: hash, pin_salt: salt, pin_iterations: iterations })
    .eq("id", input.folderId);
  if (error) throw dbError(error.message);
  await revokeSessions(input.folderId);
  return { ok: true };
}

export async function removeFolderPin(input: { folderId: string; tokens: string[] }) {
  const supabase = await db();
  await assertAccess(input.folderId, input.tokens);
  const { error } = await supabase
    .from("folders")
    .update({ pin_hash: null, pin_salt: null, pin_iterations: null })
    .eq("id", input.folderId);
  if (error) throw dbError(error.message);
  await revokeSessions(input.folderId);
  return { ok: true };
}

async function revokeSessions(folderId: string) {
  const supabase = await db();
  await supabase.from("folder_unlock_sessions").delete().eq("folder_id", folderId);
}

/** Throttles brute force without revealing whether the folder is protected. */
async function assertUnlockAllowed(folderId: string, clientKey: string) {
  const supabase = await db();
  const since = new Date(Date.now() - UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await supabase
    .from("folder_unlock_attempts")
    .select("id", { count: "exact", head: true })
    .eq("folder_id", folderId)
    .eq("client_key", clientKey)
    .eq("succeeded", false)
    .gt("created_at", since);
  if (error) throw dbError(error.message);
  if ((count ?? 0) >= UNLOCK_MAX_FAILURES) {
    throw new VaultError(
      "RATE_LIMITED",
      `Too many attempts. Try again in ${UNLOCK_WINDOW_MINUTES} minutes.`,
      429,
    );
  }
}

async function recordAttempt(folderId: string, clientKey: string, succeeded: boolean) {
  const supabase = await db();
  await supabase
    .from("folder_unlock_attempts")
    .insert({ folder_id: folderId, client_key: clientKey, succeeded });
}

export async function unlockFolder(input: {
  folderId: string;
  pin: string;
  clientKey?: string;
}): Promise<{ token: string | null; expiresAt: string | null }> {
  const supabase = await db();
  const clientKey = input.clientKey || "unknown";
  const row = await getFolderRow(input.folderId);
  if (!row.pin_hash || !row.pin_salt || !row.pin_iterations) {
    return { token: null, expiresAt: null };
  }
  await assertUnlockAllowed(input.folderId, clientKey);

  // Clear expired sessions and stale attempt records opportunistically.
  const now = new Date().toISOString();
  await supabase.from("folder_unlock_sessions").delete().lt("expires_at", now);
  await supabase
    .from("folder_unlock_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());

  const ok = await verifyPin(input.pin, {
    hash: row.pin_hash,
    salt: row.pin_salt,
    iterations: row.pin_iterations,
  });
  await recordAttempt(input.folderId, clientKey, ok);
  if (!ok) throw new VaultError("INVALID_PIN", "That PIN is incorrect.", 401);

  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + UNLOCK_TTL_MINUTES * 60_000).toISOString();
  const { error } = await supabase.from("folder_unlock_sessions").insert({
    folder_id: input.folderId,
    token_hash: await hashToken(token),
    expires_at: expiresAt,
  });
  if (error) throw dbError(error.message);
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
  const supabase = await db();
  const name = sanitizeFileName(input.name);
  await assertAccess(input.folderId, input.tokens);

  // Storage keys are random — never derived from user input, so traversal is
  // structurally impossible whichever backend stores the bytes.
  const storageKey = `${input.folderId ?? "root"}/${randomHex(16)}`;
  const mimeType = (input.mimeType || "application/octet-stream").slice(0, 255);
  const { data, error } = await supabase
    .from("files")
    .insert({
      folder_id: input.folderId,
      name,
      original_name: name,
      size: Math.max(0, Math.floor(input.size)),
      mime_type: mimeType,
      storage_key: storageKey,
      status: "uploading",
    })
    .select("id")
    .single();
  if (error) throw dbError(error.message);

  const ticket = await getStorageService().createUploadTicket(storageKey, mimeType);
  return { fileId: data.id as string, ...ticket };
}

export async function completeUpload(input: { fileId: string; size: number; tokens: string[] }) {
  const supabase = await db();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", input.fileId)
    .maybeSingle();
  if (error) throw dbError(error.message);
  if (!data) throw notFound("file");
  const row = data as FileRow;
  await assertAccess(row.folder_id, input.tokens);
  const { error: upErr } = await supabase
    .from("files")
    .update({ status: "ready", size: Math.max(0, Math.floor(input.size)) })
    .eq("id", input.fileId);
  if (upErr) throw dbError(upErr.message);
  return toFile({ ...row, status: "ready", size: input.size });
}

/** Removes the database row and object for an upload that never finished. */
export async function abandonUpload(input: { fileId: string; tokens: string[] }) {
  const supabase = await db();
  const { data } = await supabase.from("files").select("*").eq("id", input.fileId).maybeSingle();
  if (!data) return { ok: true };
  const row = data as FileRow;
  if (row.status === "ready") return { ok: true };
  await assertAccess(row.folder_id, input.tokens);
  await getStorageService().remove([row.storage_key]);
  await supabase.from("files").delete().eq("id", input.fileId);
  return { ok: true };
}

async function getFileRow(fileId: string, tokens: string[]): Promise<FileRow> {
  const supabase = await db();
  const { data, error } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();
  if (error) throw dbError(error.message);
  if (!data) throw notFound("file");
  const row = data as FileRow;
  await assertAccess(row.folder_id, tokens);
  return row;
}

export async function getDownloadUrl(input: { fileId: string; tokens: string[] }) {
  const row = await getFileRow(input.fileId, input.tokens);
  const url = await getStorageService().createDownloadUrl(row.storage_key, row.name);
  return { url, name: row.name, size: Number(row.size), mimeType: row.mime_type };
}

export async function renameFile(input: { fileId: string; name: string; tokens: string[] }) {
  const supabase = await db();
  if (!String(input.name ?? "").trim()) throw invalid("Please enter a name.");
  const name = sanitizeFileName(input.name);
  await getFileRow(input.fileId, input.tokens);
  const { error } = await supabase.from("files").update({ name }).eq("id", input.fileId);
  if (error) throw dbError(error.message);
  return { ok: true, name };
}

/** Moving requires access to BOTH the current and the destination folder. */
export async function moveFile(input: {
  fileId: string;
  folderId: string | null;
  tokens: string[];
}) {
  const supabase = await db();
  await getFileRow(input.fileId, input.tokens);
  await assertAccess(input.folderId, input.tokens);
  const { error } = await supabase
    .from("files")
    .update({ folder_id: input.folderId })
    .eq("id", input.fileId);
  if (error) throw dbError(error.message);
  return { ok: true };
}

export async function deleteFile(input: { fileId: string; tokens: string[] }) {
  const supabase = await db();
  const row = await getFileRow(input.fileId, input.tokens);
  await getStorageService().remove([row.storage_key]);
  const { error } = await supabase.from("files").delete().eq("id", input.fileId);
  if (error) throw dbError(error.message);
  return { ok: true };
}

/** Folders the caller may move a file into (locked subtrees are omitted). */
export async function listAccessibleFolders(tokens: string[]): Promise<BreadcrumbEntry[]> {
  const supabase = await db();
  const { data, error } = await supabase.from("folders").select("*").order("name");
  if (error) throw dbError(error.message);
  const rows = (data ?? []) as FolderRow[];
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
  const supabase = await db();
  const unlocked = await validTokenFolderIds(tokens);
  const [{ count: fileCount }, { count: folderCount }, { data: sizes }] = await Promise.all([
    supabase.from("files").select("id", { count: "exact", head: true }).eq("status", "ready"),
    supabase.from("folders").select("id", { count: "exact", head: true }),
    supabase.from("files").select("size").eq("status", "ready"),
  ]);
  const totalSize = (sizes ?? []).reduce((sum, r) => sum + Number(r.size ?? 0), 0);
  return {
    fileCount: fileCount ?? 0,
    folderCount: folderCount ?? 0,
    totalSize,
    unlockedCount: unlocked.size,
  };
}
