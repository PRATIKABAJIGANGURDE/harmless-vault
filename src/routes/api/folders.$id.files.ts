import { createFileRoute } from "@tanstack/react-router";

import { folderParam, json, toErrorResponse, unlockTokens } from "@/lib/api/http";
import type { SortDirection, SortKey } from "@/lib/vault/types";

export const Route = createFileRoute("/api/folders/$id/files")({
  server: {
    handlers: {
      // GET /api/folders/:id/files?search=&sort=name|size|created&direction=asc|desc
      // ":id" may be the literal "root" for the top level.
      GET: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const url = new URL(request.url);
          const sort = (url.searchParams.get("sort") ?? "created") as SortKey;
          const direction = (url.searchParams.get("direction") ?? "desc") as SortDirection;
          const view = await repo.getFolderView(folderParam(params.id), unlockTokens(request), {
            search: url.searchParams.get("search") ?? "",
            sort: ["name", "size", "created"].includes(sort) ? sort : "created",
            direction: direction === "asc" ? "asc" : "desc",
          });
          return json(view);
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
