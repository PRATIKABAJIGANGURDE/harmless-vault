// Client-side holder for folder unlock tickets.
// Tickets live in sessionStorage only: closing the tab relocks every folder.
// The ticket itself proves nothing on its own — the server checks it against a
// stored hash with an expiry before allowing any read or write.

const KEY = "harmless-vault-unlocks";

type Store = Record<string, { token: string; expiresAt: string }>;

const listeners = new Set<() => void>();

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    const now = Date.now();
    const alive: Store = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (new Date(entry.expiresAt).getTime() > now) alive[id] = entry;
    }
    return alive;
  } catch {
    return {};
  }
}

function write(store: Store) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, JSON.stringify(store));
  listeners.forEach((l) => l());
}

export const unlockStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getTokens(): string[] {
    return Object.values(read()).map((e) => e.token);
  },
  isUnlocked(folderId: string): boolean {
    return Boolean(read()[folderId]);
  },
  set(folderId: string, token: string, expiresAt: string) {
    write({ ...read(), [folderId]: { token, expiresAt } });
  },
  clear(folderId: string) {
    const store = read();
    delete store[folderId];
    write(store);
  },
  clearAll() {
    write({});
  },
};
