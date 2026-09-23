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
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
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

export interface UploadTarget {
  fileId: string;
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
}

export const VAULT_LOCKED_CODE = "FOLDER_LOCKED";

export class VaultLockedError extends Error {
  code = VAULT_LOCKED_CODE;
  folderId: string;
  constructor(folderId: string) {
    super("This folder is locked. Enter its PIN to continue.");
    this.folderId = folderId;
  }
}

export function isLockedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message.includes(VAULT_LOCKED_CODE)
  );
}
