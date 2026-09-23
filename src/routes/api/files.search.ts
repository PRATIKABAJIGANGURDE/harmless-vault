import { createFileRoute } from "@tanstack/react-router";

import { json, toErrorResponse, unlockTokens } from "@/lib/api/http";
import type { SortDirection, SortKey } from "@/lib/vault/types";

export const Route = createFileRoute("/api/files/search")({
  server: {
    handlers: {
      // GET /api/files/search?q=&sort=&direction=
      // Files inside still-locked folders are never returned.
      GET: async ({ request }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const url = new URL(request.url);
          const sort = (url.searchParams.get("sort") ?? "created") as SortKey;
          const direction = (url.searchParams.get("direction") ?? "desc") as SortDirection;
          const files = await repo.searchFiles({
            query: url.searchParams.get("q") ?? "",
            tokens: unlockTokens(request),
            sort: ["name", "size", "created"].includes(sort) ? sort : "created",
            direction: direction === "asc" ? "asc" : "desc",
          });
          return json({ files });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
