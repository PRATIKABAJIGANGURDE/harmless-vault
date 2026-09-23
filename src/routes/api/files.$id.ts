import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, json, readJson, toErrorResponse, unlockTokens } from "@/lib/api/http";
import { VaultError } from "@/lib/vault/types";

export const Route = createFileRoute("/api/files/$id")({
  server: {
    handlers: {
      // PATCH /api/files/:id { name }
      PATCH: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const body = await readJson<{ name?: string }>(request);
          if (typeof body.name !== "string") {
            throw new VaultError("VALIDATION", "A file name is required.", 400);
          }
          const result = await repo.renameFile({
            fileId: assertUuid(params.id, "file id"),
            name: body.name,
            tokens: unlockTokens(request),
          });
          return json(result);
        } catch (error) {
          return toErrorResponse(error);
        }
      },
      // DELETE /api/files/:id
      DELETE: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          await repo.deleteFile({
            fileId: assertUuid(params.id, "file id"),
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
