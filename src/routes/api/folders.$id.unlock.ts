import { createFileRoute } from "@tanstack/react-router";

import { assertUuid, clientKey, json, readJson, toErrorResponse } from "@/lib/api/http";
import { VaultError } from "@/lib/vault/types";

export const Route = createFileRoute("/api/folders/$id/unlock")({
  server: {
    handlers: {
      // POST /api/folders/:id/unlock  { pin } -> { token, expiresAt }
      POST: async ({ request, params }) => {
        try {
          const repo = await import("@/lib/vault/repo.server");
          const body = await readJson<{ pin?: string }>(request);
          if (typeof body.pin !== "string") {
            throw new VaultError("VALIDATION", "A 4-digit PIN is required.", 400);
          }
          const result = await repo.unlockFolder({
            folderId: assertUuid(params.id, "folder id"),
            pin: body.pin,
            clientKey: clientKey(request),
          });
          return json(result);
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
