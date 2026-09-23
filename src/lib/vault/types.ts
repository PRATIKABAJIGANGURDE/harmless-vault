// Shared, client-safe types for the vault API layer.
// These are the only shapes the UI knows about, which keeps the frontend
// independent from whichever storage backend is in use (Lovable Cloud today,
// a self-hosted Node/Termux server on the Narzo 50A later).

export interface VaultFolder {
  id: string;
  name: string;
  parentId: string | null;
  isProtected: boolean;
  isLocked: boolean;
  fileCount: number;
  folderCount: number;
  totalSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface VaultFile {
  id: string;
  folderId: string | null;
  name: string;
  originalName: string;
  size: number;
  mimeType: string;
  kind: FileKind;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FileKind = "image" | "video" | "audio" | "pdf" | "archive" | "document" | "other";

export function fileKind(mime: string): FileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (/zip|compressed|tar|rar|7z/.test(mime)) return "archive";
  if (/word|excel|powerpoint|opendocument|text\//.test(mime)) return "document";
  return "other";
}

export interface BreadcrumbEntry {
  id: string;
  name: string;
}

export interface FolderView {
  folder: VaultFolder | null;
  breadcrumbs: BreadcrumbEntry[];
  folders: VaultFolder[];
  files: VaultFile[];
}

export interface VaultStats {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  unlockedCount: number;
}

export type SortKey = "name" | "size" | "created";
export type SortDirection = "asc" | "desc";

export interface UploadTarget {
  fileId: string;
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
}

export const VAULT_LOCKED_CODE = "FOLDER_LOCKED";

export type VaultErrorCode =
  | "FOLDER_LOCKED"
  | "INVALID_PIN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "SERVER_ERROR";

/** Transport-agnostic error: the REST layer maps `status`, the UI reads `code`. */
export class VaultError extends Error {
  code: VaultErrorCode;
  status: number;
  folderId?: string;

  constructor(code: VaultErrorCode, message: string, status: number, folderId?: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.status = status;
    if (folderId) this.folderId = folderId;
  }
}

export class VaultLockedError extends VaultError {
  constructor(folderId: string) {
    super(
      VAULT_LOCKED_CODE,
      "This folder is locked. Enter its PIN to continue.",
      423,
      folderId,
    );
  }
}

export function isLockedError(error: unknown): boolean {
  if (error instanceof VaultError) return error.code === VAULT_LOCKED_CODE;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === VAULT_LOCKED_CODE
  );
}
