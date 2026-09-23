// The single place the frontend talks to a backend.
//
// Every request goes through here, so switching from the bundled API to a
// Node.js/Express server running on the Narzo 50A is a matter of setting
// VITE_API_BASE_URL (e.g. "http://192.168.1.42:3000") — no component changes.

import { unlockStore } from "@/services/session";
import { UNLOCK_HEADER } from "@/lib/api/http";
import { VaultError, type VaultErrorCode } from "@/lib/vault/types";

export const API_BASE_URL: string = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

function buildUrl(path: string, query?: Record<string, string | number | null | undefined>): string {
  const base = API_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}${path}`, base ? undefined : window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function headers(json: boolean): HeadersInit {
  const tokens = unlockStore.getTokens();
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(tokens.length ? { [UNLOCK_HEADER]: tokens.join(",") } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; folderId?: string } })
      ?.error;
    throw new VaultError(
      (error?.code as VaultErrorCode) ?? "SERVER_ERROR",
      error?.message ?? "The vault is unavailable right now.",
      response.status,
      error?.folderId,
    );
  }
  return payload as T;
}

async function send<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | null | undefined>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: headers(body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      credentials: "include",
    });
  } catch {
    throw new VaultError("SERVER_ERROR", "Cannot reach the vault. Check your connection.", 0);
  }
  return parse<T>(response);
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | null | undefined>) =>
    send<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => send<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => send<T>("PATCH", path, body),
  delete: <T>(path: string) => send<T>("DELETE", path),
  url: buildUrl,
  unlockHeaders: () => headers(false),
};
