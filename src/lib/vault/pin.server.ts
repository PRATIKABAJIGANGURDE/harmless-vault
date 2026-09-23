// PIN hashing and unlock-token helpers. PINs are never stored or logged in
// plaintext: only a PBKDF2-SHA256 hash plus a random per-folder salt is kept.

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function derive(pin: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPin(pin: string) {
  const salt = randomHex(16);
  const hash = await derive(pin, salt, ITERATIONS);
  return { hash, salt, iterations: ITERATIONS };
}

/** Constant-time comparison so a wrong PIN cannot be found by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(
  pin: string,
  stored: { hash: string; salt: string; iterations: number },
): Promise<boolean> {
  const candidate = await derive(pin, stored.salt, stored.iterations);
  return timingSafeEqual(candidate, stored.hash);
}

/** Unlock tokens are stored hashed too, so a database leak grants no access. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}
