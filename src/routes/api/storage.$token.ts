import { createFileRoute } from "@tanstack/react-router";

import { json, toErrorResponse } from "@/lib/api/http";
import { VaultError } from "@/lib/vault/types";

export const Route = createFileRoute("/api/storage/$token")({
  server: {
    handlers: {
      // PUT /api/storage/:token  -> streams the request body to disk.
      // The token is a short-lived capability handed out by /api/files/upload,
      // so access rules were already enforced when it was issued.
      PUT: async ({ request, params }) => {
        try {
          const storage = await import("@/lib/vault/storage.server");
          const ticket = await storage.resolveTicket(params.token);
          if (ticket.mode !== "upload") {
            throw new VaultError("VALIDATION", "That link cannot be used to upload.", 400);
          }
          const result = await storage.writeBody(ticket, request.body);
          return json({ ok: true, size: result.size });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
      // GET /api/storage/:token -> streams the stored body back out.
      GET: async ({ request, params }) => {
        try {
          const storage = await import("@/lib/vault/storage.server");
          const ticket = await storage.resolveTicket(params.token);
          if (ticket.mode === "upload") {
            throw new VaultError("VALIDATION", "That link cannot be used to read.", 400);
          }
          const { stream, size, start, end, partial } = await storage.readBody(
            ticket,
            request.headers.get("range"),
          );
          const disposition =
            ticket.mode === "download"
              ? `attachment; filename*=UTF-8''${encodeURIComponent(ticket.fileName)}`
              : "inline";
          const headers: Record<string, string> = {
            "content-type": ticket.mimeType,
            "content-disposition": disposition,
            "accept-ranges": "bytes",
            "cache-control": "private, no-store",
            "content-length": String(partial ? end - start + 1 : size),
          };
          if (partial) headers["content-range"] = `bytes ${start}-${end}/${size}`;
          return new Response(stream, { status: partial ? 206 : 200, headers });
        } catch (error) {
          return toErrorResponse(error);
        }
      },
    },
  },
});
