import { createFileRoute } from "@tanstack/react-router";

import {
  clientKey as _clientKey,
  folderParam,
  json,
  readJson,
  toErrorResponse,
  unlockTokens,
} from "@/lib/api/http";
import { VaultError } from "@/lib/vault/types";

export const Route = createFileRoute("/api/folders")({
  server: {
    handlers: {
      // GET /api/folders?parentId=<uuid|root>  -> folder listing for that level
      GET: async ({ request }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const url = new URL(request.url);
          const parentId = folderParam(url.searchParams.get("parentId"));
          const view = await repo.getFolderView(parentId, unlockTokens(request));
          return json({ folders: view.folders, breadcrumbs: view.breadcrumbs, folder: view.folder });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
      // POST /api/folders  { name, parentId, pin? }
      POST: async ({ request }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const body = await readJson<{ name?: string; parentId?: string | null; pin?: string | null }>(
            request,
          );
          if (typeof body.name !== "string") {
            throw new VaultError("VALIDATION", "A folder name is required.", 400);
          }
          const folder = await repo.createFolder({
            name: body.name,
            parentId: folderParam(body.parentId ?? null),
            pin: body.pin ?? null,
            tokens: unlockTokens(request),
          });
          return json({ folder }, 201);
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
