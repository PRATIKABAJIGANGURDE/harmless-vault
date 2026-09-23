import { createFileRoute } from "@tanstack/react-router";

import { json, toErrorResponse, unlockTokens } from "@/lib/api/http";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      // GET /api/stats -> { fileCount, folderCount, totalSize, unlockedCount }
      GET: async ({ request }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          return json(await repo.getVaultStats(unlockTokens(request)));
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
