import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, json, readJson, toErrorResponse, unlockTokens } from "@/lib/api/http";

export const Route = createFileRoute("/api/files/$id/complete")({
  server: {
    handlers: {
      // POST /api/files/:id/complete { size } -> marks the upload ready
      POST: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const body = await readJson<{ size?: number }>(request);
          const file = await repo.completeUpload({
            fileId: assertUuid(params.id, "file id"),
            size: typeof body.size === "number" ? body.size : 0,
            tokens: unlockTokens(request),
          });
          return json({ file });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
      // DELETE /api/files/:id/complete -> discards a cancelled/failed upload
      DELETE: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          await repo.abandonUpload({
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
