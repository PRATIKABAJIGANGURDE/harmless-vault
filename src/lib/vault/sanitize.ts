// Pure, dependency-free input sanitizers. Shared by the server layer and
// unit-tested directly. Storage keys are NEVER built from these values — they
// are random ids — but names still get cleaned so nothing downstream (a Node
// filesystem backend on the Narzo 50A, for example) can be tricked into path
// traversal.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const PATH_CHARS = /[/\\]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const MAX_NAME_LENGTH = 255;
export const MAX_FOLDER_NAME_LENGTH = 120;

/** Cleans a user-supplied file name. Throws nothing; always returns something usable. */
export function sanitizeFileName(input: string): string {
  let name = String(input ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(PATH_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim();

  // Strip traversal attempts and leading dots ("..", ".hidden/../x").
  name = name.replace(/\.{2,}/g, ".").replace(/^\.+/, "");
  if (RESERVED.test(name.split(".")[0] ?? "")) name = `file-${name}`;
  if (!name) name = "untitled";
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return name;
}

/** Cleans a folder name. Same rules, shorter limit. */
export function sanitizeFolderName(input: string): string {
  const name = sanitizeFileName(input);
  return name.length > MAX_FOLDER_NAME_LENGTH ? name.slice(0, MAX_FOLDER_NAME_LENGTH) : name;
}

/** True when the string is a syntactically valid 4-digit PIN. */
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

/** Loose UUID check used before hitting the database. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
