import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, json, toErrorResponse } from "@/lib/api/http";

export const Route = createFileRoute("/api/folders/$id/lock")({
  server: {
    handlers: {
      // POST /api/folders/:id/lock -> revokes every unlock session for the folder
      POST: async ({ params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          await repo.lockFolder({ folderId: assertUuid(params.id, "folder id") });
          return json({ ok: true });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
