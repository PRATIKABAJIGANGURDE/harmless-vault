import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, json, readJson, toErrorResponse, unlockTokens } from "@/lib/api/http";
import { VaultError } from "@/lib/vault/types";

export const Route = createFileRoute("/api/folders/$id")({
  server: {
    handlers: {
      // PATCH /api/folders/:id  { name? , pin?: string|null }
      PATCH: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const id = assertUuid(params.id, "folder id");
          const tokens = unlockTokens(request);
          const body = await readJson<{ name?: string; pin?: string | null }>(request);
          if (typeof body.name === "string") {
            await repo.renameFolder({ folderId: id, name: body.name, tokens });
          }
          if (body.pin === null) {
            await repo.removeFolderPin({ folderId: id, tokens });
          } else if (typeof body.pin === "string") {
            await repo.setFolderPin({ folderId: id, pin: body.pin, tokens });
          }
          if (body.name === undefined && body.pin === undefined) {
            throw new VaultError("VALIDATION", "Nothing to update.", 400);
          }
          return json({ ok: true });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
      // DELETE /api/folders/:id  (recursive, removes stored objects too)
      DELETE: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          await repo.deleteFolder({
            folderId: assertUuid(params.id, "folder id"),
            tokens: unlockTokens(request),
          });
          return json({ ok: true });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
