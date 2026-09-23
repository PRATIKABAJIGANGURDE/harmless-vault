import { createFileRoute } from "@tanstack/react-router";

import { folderParam, json, readJson, toErrorResponse, unlockTokens } from "@/lib/api/http";
import { VaultError } from "@/lib/vault/types";

export const Route = createFileRoute("/api/files/upload")({
  server: {
    handlers: {
      // POST /api/files/upload  { folderId, name, size, mimeType }
      // Returns an upload ticket. The browser then streams the body straight to
      // `url` with `method`/`headers`, and confirms with
      // POST /api/files/:id/complete. No file bytes pass through this endpoint,
      // so there is no app-level size ceiling.
      POST: async ({ request }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const body = await readJson<{
            folderId?: string | null;
            name?: string;
            size?: number;
            mimeType?: string;
          }>(request);
          if (typeof body.name !== "string" || !body.name.trim()) {
            throw new VaultError("VALIDATION", "A file name is required.", 400);
          }
          if (typeof body.size !== "number" || !Number.isFinite(body.size) || body.size < 0) {
            throw new VaultError("VALIDATION", "A valid file size is required.", 400);
          }
          const target = await repo.createUpload({
            folderId: folderParam(body.folderId ?? null),
            name: body.name,
            size: body.size,
            mimeType: body.mimeType ?? "application/octet-stream",
            tokens: unlockTokens(request),
          });
          return json(target, 201);
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
