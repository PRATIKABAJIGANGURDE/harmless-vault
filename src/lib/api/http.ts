// Shared HTTP helpers for the vault REST API. Deliberately dependency-free and
// client-safe: route files ship to the client bundle, so nothing server-only is
// imported here.

import { VaultError } from "@/lib/vault/types";

export const UNLOCK_HEADER = "x-vault-unlock";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function apiError(code: string, message: string, status: number, extra?: object): Response {
  return json({ error: { code, message, ...extra } }, status);
}

/** Maps any thrown value to a JSON error response with a sane status code. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof VaultError) {
    return apiError(
      error.code,
      error.message,
      error.status,
      error.folderId ? { folderId: error.folderId } : undefined,
    );
  }
  console.error("[api] unexpected error:", error);
  return apiError("SERVER_ERROR", "The vault is unavailable right now.", 500);
}

/** Unlock tickets travel in a header, never in the URL (URLs end up in logs). */
export function unlockTokens(request: Request): string[] {
  const raw = request.headers.get(UNLOCK_HEADER) ?? "";
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[a-f0-9]{16,128}$/i.test(t));
}

/** Coarse client identity used only for unlock rate limiting. */
export function clientKey(request: Request): string {
  const header =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  return (header.split(",")[0] ?? "").trim() || "local";
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new VaultError("VALIDATION", "The request body must be valid JSON.", 400);
  }
}

/** Route params arrive as strings; "root" means the top level. */
export function folderParam(value: string | undefined | null): string | null {
  if (!value || value === "root" || value === "null") return null;
  return value;
}

export function assertUuid(value: string, what = "id"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new VaultError("VALIDATION", `That ${what} is not valid.`, 400);
  }
  return value;
}
