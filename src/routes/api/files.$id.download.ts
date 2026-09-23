import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, json, toErrorResponse, unlockTokens } from "@/lib/api/http";

export const Route = createFileRoute("/api/files/$id/download")({
  server: {
    handlers: {
      // GET /api/files/:id/download -> { url, name, size, mimeType }
      // The URL is short-lived and streams from storage straight to disk, so a
      // large file never enters page memory. A filesystem backend may instead
      // return a URL to its own streaming endpoint — the contract is the same.
      GET: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const result = await repo.getDownloadUrl({
            fileId: assertUuid(params.id, "file id"),
            tokens: unlockTokens(request),
          });
          return json(result);
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
