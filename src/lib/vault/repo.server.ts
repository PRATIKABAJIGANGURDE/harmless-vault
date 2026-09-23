// Server-only data layer. Every rule (PIN checks, lock enforcement, cascade
// deletes) lives here, so no client can bypass it: the database tables are not
// reachable from the browser at all.

import { hashPin, hashToken, randomHex, verifyPin } from "./pin.server";
import { getStorageService } from "./storage.server";
import type { BreadcrumbEntry, FolderView, UploadTarget, VaultFile, VaultFolder } from "./types";
import { VAULT_LOCKED_CODE } from "./types";

const UNLOCK_TTL_MINUTES = 30;

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

function lockedError(folderId: string): Error {
  return new Error(`${VAULT_LOCKED_CODE}:${folderId}`);
}

function assertPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error("The PIN must be exactly 4 digits.");
}

function assertName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Please enter a name.");
  if (trimmed.length > 120) throw new Error("That name is too long.");
  return trimmed;
}

async function getFolderRow(id: string): Promise<FolderRow> {
  const supabase = await db();
  const { data, error } = await supabase.from("folders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That folder no longer exists.");
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
  if (tokens.length === 0) return unlocked;
  const supabase = await db();
  const hashes = await Promise.all(tokens.filter(Boolean).map((t) => hashToken(t)));
  const { data, error } = await supabase
    .from("folder_unlock_sessions")
    .select("folder_id, expires_at")
    .in("token_hash", hashes)
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
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
    if (!unlocked.has(id)) throw lockedError(id);
  }
  return chain;
}

async function countsFor(folderIds: string[]) {
  const supabase = await db();
  const counts = new Map<string, { files: number; folders: number; size: number }>();
  for (const id of folderIds) counts.set(id, { files: 0, folders: 0, size: 0 });
  if (folderIds.length === 0) return counts;

  const [{ data: files, error: fErr }, { data: subs, error: sErr }] = await Promise.all([
    supabase.from("files").select("folder_id, size").in("folder_id", folderIds).eq("status", "ready"),
    supabase.from("folders").select("parent_id").in("parent_id", folderIds),
  ]);
  if (fErr) throw new Error(fErr.message);
  if (sErr) throw new Error(sErr.message);

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

function toFile(row: FileRow): VaultFile {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    size: Number(row.size),
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------ read paths ------------------------------ */

export async function getFolderView(
  folderId: string | null,
  tokens: string[],
): Promise<FolderView> {
  const supabase = await db();
  const chain = await assertAccess(folderId, tokens);
  const unlocked = await validTokenFolderIds(tokens);

  const [{ data: folderRows, error: folderErr }, { data: fileRows, error: fileErr }] =
    await Promise.all([
      folderId
        ? supabase.from("folders").select("*").eq("parent_id", folderId).order("name")
        : supabase.from("folders").select("*").is("parent_id", null).order("name"),
      folderId
        ? supabase
            .from("files")
            .select("*")
            .eq("folder_id", folderId)
            .eq("status", "ready")
            .order("created_at", { ascending: false })
        : supabase
            .from("files")
            .select("*")
            .is("folder_id", null)
            .eq("status", "ready")
            .order("created_at", { ascending: false }),
    ]);
  if (folderErr) throw new Error(folderErr.message);
  if (fileErr) throw new Error(fileErr.message);

  const rows = (folderRows ?? []) as FolderRow[];
  const counts = await countsFor(rows.map((r) => r.id));
  const current = chain.length ? chain[chain.length - 1]! : null;
  const currentCounts = current ? await countsFor([current.id]) : new Map();

  const breadcrumbs: BreadcrumbEntry[] = chain.map((f) => ({ id: f.id, name: f.name }));

  return {
    folder: current ? toFolder(current, unlocked, currentCounts) : null,
    breadcrumbs,
    folders: rows.map((r) => toFolder(r, unlocked, counts)),
    files: (fileRows ?? []).map((r) => toFile(r as FileRow)),
  };
}

/* ------------------------------ folder ops ------------------------------ */

export async function createFolder(input: {
  name: string;
  parentId: string | null;
  pin?: string | null | undefined;
  tokens: string[];
}): Promise<VaultFolder> {
  const supabase = await db();
  const name = assertName(input.name);
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
  if (error) throw new Error(error.message);
  return toFolder(data as FolderRow, new Set(), new Map());
}

export async function renameFolder(input: { folderId: string; name: string; tokens: string[] }) {
  const supabase = await db();
  const name = assertName(input.name);
  await assertAccess(input.folderId, input.tokens);
  const { error } = await supabase.from("folders").update({ name }).eq("id", input.folderId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Collects the folder and every descendant, so storage objects can be purged. */
async function collectSubtree(folderId: string): Promise<string[]> {
  const supabase = await db();
  const all = [folderId];
  let frontier = [folderId];
  while (frontier.length) {
    const { data, error } = await supabase.from("folders").select("id").in("parent_id", frontier);
    if (error) throw new Error(error.message);
    frontier = (data ?? []).map((r) => r.id as string);
    all.push(...frontier);
  }
  return all;
}

export async function deleteFolder(input: { folderId: string; tokens: string[] }) {
  const supabase = await db();
  await assertAccess(input.folderId, input.tokens);
  const ids = await collectSubtree(input.folderId);
  const { data: files, error } = await supabase.from("files").select("storage_key").in("folder_id", ids);
  if (error) throw new Error(error.message);
  const keys = (files ?? []).map((f) => f.storage_key as string);
  if (keys.length) await getStorageService().remove(keys);
  const { error: delErr } = await supabase.from("folders").delete().eq("id", input.folderId);
  if (delErr) throw new Error(delErr.message);
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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
  await revokeSessions(input.folderId);
  return { ok: true };
}

async function revokeSessions(folderId: string) {
  const supabase = await db();
  await supabase.from("folder_unlock_sessions").delete().eq("folder_id", folderId);
}

export async function unlockFolder(input: { folderId: string; pin: string }) {
  const supabase = await db();
  const row = await getFolderRow(input.folderId);
  if (!row.pin_hash || !row.pin_salt || !row.pin_iterations) {
    return { token: null, expiresAt: null };
  }
  // Clear expired sessions opportunistically.
  await supabase.from("folder_unlock_sessions").delete().lt("expires_at", new Date().toISOString());

  const ok = await verifyPin(input.pin, {
    hash: row.pin_hash,
    salt: row.pin_salt,
    iterations: row.pin_iterations,
  });
  if (!ok) throw new Error("That PIN is incorrect.");

  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + UNLOCK_TTL_MINUTES * 60_000).toISOString();
  const { error } = await supabase.from("folder_unlock_sessions").insert({
    folder_id: input.folderId,
    token_hash: await hashToken(token),
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
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
  const name = assertName(input.name);
  await assertAccess(input.folderId, input.tokens);

  const storageKey = `${input.folderId ?? "root"}/${randomHex(16)}`;
  const { data, error } = await supabase
    .from("files")
    .insert({
      folder_id: input.folderId,
      name,
      size: Math.max(0, Math.floor(input.size)),
      mime_type: input.mimeType || "application/octet-stream",
      storage_key: storageKey,
      status: "uploading",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const ticket = await getStorageService().createUploadTicket(
    storageKey,
    input.mimeType || "application/octet-stream",
  );
  return { fileId: data.id as string, ...ticket };
}

export async function completeUpload(input: { fileId: string; size: number; tokens: string[] }) {
  const supabase = await db();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", input.fileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That file no longer exists.");
  const row = data as FileRow;
  await assertAccess(row.folder_id, input.tokens);
  const { error: upErr } = await supabase
    .from("files")
    .update({ status: "ready", size: Math.max(0, Math.floor(input.size)) })
    .eq("id", input.fileId);
  if (upErr) throw new Error(upErr.message);
  return toFile({ ...row, status: "ready", size: input.size });
}

async function getFileRow(fileId: string, tokens: string[]): Promise<FileRow> {
  const supabase = await db();
  const { data, error } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That file no longer exists.");
  const row = data as FileRow;
  await assertAccess(row.folder_id, tokens);
  return row;
}

export async function getDownloadUrl(input: { fileId: string; tokens: string[] }) {
  const row = await getFileRow(input.fileId, input.tokens);
  const url = await getStorageService().createDownloadUrl(row.storage_key, row.name);
  return { url, name: row.name };
}

export async function renameFile(input: { fileId: string; name: string; tokens: string[] }) {
  const supabase = await db();
  const name = assertName(input.name);
  await getFileRow(input.fileId, input.tokens);
  const { error } = await supabase.from("files").update({ name }).eq("id", input.fileId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteFile(input: { fileId: string; tokens: string[] }) {
  const supabase = await db();
  const row = await getFileRow(input.fileId, input.tokens);
  await getStorageService().remove([row.storage_key]);
  const { error } = await supabase.from("files").delete().eq("id", input.fileId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getVaultStats(tokens: string[]) {
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
