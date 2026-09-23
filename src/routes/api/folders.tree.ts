import { createFileRoute } from "@tanstack/react-router";

import { json, toErrorResponse, unlockTokens } from "@/lib/api/http";

export const Route = createFileRoute("/api/folders/tree")({
  server: {
    handlers: {
      // GET /api/folders/tree -> flat list of folders the caller can move files
      // into, with their full path as the name. Locked subtrees are omitted.
      GET: async ({ request }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          return json({ folders: await repo.listAccessibleFolders(unlockTokens(request)) });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
