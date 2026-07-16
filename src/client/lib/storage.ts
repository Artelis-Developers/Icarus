/**
 * iframe-safe key/value persistence.
 *
 * localStorage can throw in a cross-origin iframe (or when a browser blocks
 * third-party storage). Every access is guarded and falls back to an in-memory
 * map so the app keeps working — it just won't persist across reloads in that
 * environment.
 */

const memory = new Map<string, string>();
let available: boolean | null = null;

function canUseLocalStorage(): boolean {
  if (available !== null) return available;
  try {
    const probe = '__Icarus_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = canUseLocalStorage() ? window.localStorage.getItem(key) : memory.get(key) ?? null;
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    if (canUseLocalStorage()) window.localStorage.setItem(key, raw);
    else memory.set(key, raw);
  } catch {
    /* quota / serialization errors are non-fatal */
  }
}
