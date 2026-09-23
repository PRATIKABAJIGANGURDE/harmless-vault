// Storage abstraction.
//
// Everything in the app talks to `StorageService` only. The default
// implementation writes file bodies to the local filesystem (Windows during
// development, Termux on the Narzo 50A in production) under VAULT_DATA_DIR.
// Swapping in another backend means adding one more implementation of this
// interface and changing `getStorageService()` — no UI or database changes.
//
// Large files never pass through JavaScript memory: the browser receives a
// short-lived ticket URL and the route streams the body to or from disk.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { blobDir } from "./config.server";
import { get, nowIso, run } from "./db.server";
import { hashToken, randomHex } from "./pin.server";
import { VaultError } from "./types";

const UPLOAD_TICKET_TTL_SECONDS = 12 * 3600; // long enough for a slow, huge file
const DOWNLOAD_TICKET_TTL_SECONDS = 300;

export interface UploadTicket {
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
}

export interface StorageService {
  /** A short-lived, write-only URL the browser can stream a file body to. */
  createUploadTicket(key: string, mimeType: string): Promise<UploadTicket>;
  /** A short-lived, read-only URL the browser can stream a file body from. */
  createDownloadUrl(key: string, fileName: string): Promise<string>;
  /** A short-lived inline URL, used for image thumbnails. */
  createPreviewUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Removes objects. Missing objects are not an error. */
  remove(keys: string[]): Promise<void>;
}

export type TicketMode = "upload" | "download" | "preview";

export interface ResolvedTicket {
  storageKey: string;
  absolutePath: string;
  mode: TicketMode;
  fileName: string;
  mimeType: string;
}

/**
 * Storage keys are generated server-side, never taken from user input. This
 * check is the second line of defence: the resolved path must stay inside the
 * blob directory, so `..` or absolute paths can never escape it.
 */
function absolutePathFor(key: string): string {
  if (!/^[A-Za-z0-9_\-./]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new VaultError("VALIDATION", "That storage location is not valid.", 400);
  }
  const root = blobDir();
  const target = path.resolve(root, key);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new VaultError("VALIDATION", "That storage location is not valid.", 400);
  }
  return target;
}

async function issueTicket(input: {
  key: string;
  mode: TicketMode;
  ttlSeconds: number;
  fileName?: string;
  mimeType?: string;
}): Promise<string> {
  absolutePathFor(input.key);
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  await run("DELETE FROM storage_tickets WHERE expires_at < ?", [nowIso()]);
  await run(
    `INSERT INTO storage_tickets (token_hash, storage_key, mode, file_name, mime_type, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      await hashToken(token),
      input.key,
      input.mode,
      input.fileName ?? null,
      input.mimeType ?? null,
      expiresAt,
    ],
  );
  // Relative path: the browser resolves it against the configured API base, so
  // the same code works against localhost, the LAN address of the phone, or a
  // reverse proxy.
  return `/api/storage/${token}`;
}

/** Looks up a ticket and consumes nothing: upload tickets may retry. */
export async function resolveTicket(token: string): Promise<ResolvedTicket> {
  if (!/^[a-f0-9]{16,128}$/i.test(token)) {
    throw new VaultError("VALIDATION", "That link is not valid.", 400);
  }
  const row = await get<{
    storage_key: string;
    mode: TicketMode;
    file_name: string | null;
    mime_type: string | null;
    expires_at: string;
  }>("SELECT * FROM storage_tickets WHERE token_hash = ?", [await hashToken(token)]);
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new VaultError("NOT_FOUND", "That link has expired.", 404);
  }
  return {
    storageKey: row.storage_key,
    absolutePath: absolutePathFor(row.storage_key),
    mode: row.mode,
    fileName: row.file_name ?? "download",
    mimeType: row.mime_type ?? "application/octet-stream",
  };
}

/** Streams a request body straight to disk; nothing is buffered in memory. */
export async function writeBody(ticket: ResolvedTicket, body: ReadableStream | null) {
  await mkdir(path.dirname(ticket.absolutePath), { recursive: true });
  const temp = `${ticket.absolutePath}.part`;
  const source = body
    ? (Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]) as Readable)
    : Readable.from([]);
  await pipeline(source, createWriteStream(temp));
  await rm(ticket.absolutePath, { force: true });
  const { rename } = await import("node:fs/promises");
  await rename(temp, ticket.absolutePath);
  const info = await stat(ticket.absolutePath);
  return { size: info.size };
}

/** Streams a stored body back out, optionally honouring a Range request. */
export async function readBody(ticket: ResolvedTicket, range?: string | null) {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(ticket.absolutePath);
  } catch {
    throw new VaultError("NOT_FOUND", "That file is no longer stored.", 404);
  }
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  let start = 0;
  let end = info.size - 1;
  let partial = false;
  if (match && info.size > 0) {
    const rawStart = match[1] ? Number(match[1]) : null;
    const rawEnd = match[2] ? Number(match[2]) : null;
    if (rawStart !== null) {
      start = Math.min(rawStart, info.size - 1);
      if (rawEnd !== null) end = Math.min(rawEnd, info.size - 1);
    } else if (rawEnd !== null) {
      start = Math.max(0, info.size - rawEnd);
    }
    partial = true;
  }
  const stream = Readable.toWeb(
    createReadStream(ticket.absolutePath, { start, end }),
  ) as ReadableStream;
  return { stream, size: info.size, start, end, partial };
}

class LocalFilesystemStorage implements StorageService {
  async createUploadTicket(key: string, mimeType: string): Promise<UploadTicket> {
    const url = await issueTicket({
      key,
      mode: "upload",
      ttlSeconds: UPLOAD_TICKET_TTL_SECONDS,
      mimeType,
    });
    return {
      url,
      method: "PUT",
      headers: mimeType ? { "content-type": mimeType } : {},
    };
  }

  async createDownloadUrl(key: string, fileName: string): Promise<string> {
    return issueTicket({
      key,
      mode: "download",
      ttlSeconds: DOWNLOAD_TICKET_TTL_SECONDS,
      fileName,
    });
  }

  async createPreviewUrl(key: string, ttlSeconds: number): Promise<string> {
    return issueTicket({ key, mode: "preview", ttlSeconds });
  }

  async remove(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        try {
          await rm(absolutePathFor(key), { force: true });
        } catch {
          // A missing object is not an error.
        }
      }),
    );
  }
}

let instance: StorageService | null = null;

export function getStorageService(): StorageService {
  // Future backends (S3, a different filesystem layout) plug in here only.
  if (!instance) instance = new LocalFilesystemStorage();
  return instance;
}
