import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, folderParam, json, readJson, toErrorResponse, unlockTokens } from "@/lib/api/http";

export const Route = createFileRoute("/api/files/$id/move")({
  server: {
    handlers: {
      // POST /api/files/:id/move { folderId }  (null / "root" = top level)
      POST: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const body = await readJson<{ folderId?: string | null }>(request);
          await repo.moveFile({
            fileId: assertUuid(params.id, "file id"),
            folderId: folderParam(body.folderId ?? null),
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
