// Public API surface of the vault. The UI calls only these functions, never
// the database or storage directly. Swapping the storage backend later does not
// change any of these signatures.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokens = z.array(z.string()).default([]);
const uuid = z.string().uuid();
const pin = z.string().regex(/^\d{4}$/, "The PIN must be exactly 4 digits.");

export const fetchFolderView = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ folderId: uuid.nullable().default(null), tokens }).parse(d),
  )
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.getFolderView(data.folderId, data.tokens);
  });

export const fetchVaultStats = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ tokens }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.getVaultStats(data.tokens);
  });

export const createFolder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        parentId: uuid.nullable().default(null),
        pin: pin.nullable().optional(),
        tokens,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.createFolder(data);
  });

export const renameFolder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ folderId: uuid, name: z.string().min(1).max(120), tokens }).parse(d),
  )
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.renameFolder(data);
  });

export const deleteFolder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ folderId: uuid, tokens }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.deleteFolder(data);
  });

export const setFolderPin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ folderId: uuid, pin, tokens }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.setFolderPin(data);
  });

export const removeFolderPin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ folderId: uuid, tokens }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.removeFolderPin(data);
  });

export const unlockFolder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ folderId: uuid, pin }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.unlockFolder(data);
  });

export const lockFolder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ folderId: uuid }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.lockFolder(data);
  });

export const createUpload = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        folderId: uuid.nullable().default(null),
        name: z.string().min(1).max(255),
        size: z.number().nonnegative(),
        mimeType: z.string().max(255).default("application/octet-stream"),
        tokens,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.createUpload(data);
  });

export const completeUpload = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ fileId: uuid, size: z.number().nonnegative(), tokens }).parse(d),
  )
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.completeUpload(data);
  });

export const getDownloadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileId: uuid, tokens }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.getDownloadUrl(data);
  });

export const renameFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ fileId: uuid, name: z.string().min(1).max(255), tokens }).parse(d),
  )
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.renameFile(data);
  });

export const deleteFile = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileId: uuid, tokens }).parse(d))
  .handler(async ({ data }) => {
    const repo = await import("./vault/repo.server");
    return repo.deleteFile(data);
  });
