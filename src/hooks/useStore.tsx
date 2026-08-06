import { useCallback, useState } from "preact/hooks";
import type { Dispatch, StateUpdater } from "preact/hooks";

export const STORAGE_KEY = "drycms:store";

function readAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(store: Record<string, unknown>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode / storage disabled - state still works for this session.
  }
}

/** Reads the `key` entry of the shared `drycms:store` object, or `undefined` if
 * it isn't set yet. For state that isn't owned by a single component (and so
 * can't use the `useStore` hook below) - e.g. a `@preact/signals` signal
 * shared across components, like `collapsed` in `store/dashboard.ts`. */
export function readStoreValue<T>(key: string): T | undefined {
  return readAll()[key] as T | undefined;
}

/** Writes `value` into the `key` entry of the shared `drycms:store` object. See
 * `readStoreValue`. Also schedules a debounced background sync of the whole
 * `drycms:store` blob to the account's server-side `memory` row (see
 * `initMemorySync` below) - every `useStore`/`readStoreValue`+`writeStoreValue`
 * caller (theme, sidebar collapsed, submenu open state, ...) gets cross-
 * device sync for free through this one choke point, with no per-key wiring. */
export function writeStoreValue<T>(key: string, value: T): void {
  writeAll({ ...readAll(), [key]: value });
  scheduleMemoryPush();
}

/** Same signature/behavior as `useState`, but backed by the `key` entry of
 * a single `drycms:store` object in `localStorage` instead of in-memory state.
 * If `key` isn't present yet, `initialValue` seeds it (and is persisted). */
export function useStore<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<StateUpdater<T>>];
export function useStore<T = undefined>(
  key: string,
): [T | undefined, Dispatch<StateUpdater<T | undefined>>];
export function useStore<T>(key: string, initialValue?: T | (() => T)) {
  const [value, setValue] = useState<T | undefined>(() => {
    const existing = readStoreValue<T>(key);
    if (existing !== undefined) return existing;
    const initial =
      initialValue instanceof Function ? initialValue() : initialValue;
    if (initial !== undefined) writeStoreValue(key, initial);
    return initial;
  });

  const setStoredValue = useCallback(
    (next: T | undefined | ((prev: T | undefined) => T | undefined)) => {
      setValue((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        writeStoreValue(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, setStoredValue] as const;
}

// ---------------------------------------------------------------------------
// Background sync with the account's server-side `memory` row
// (`routes/memory.ts`) - see `status/system-memory-and-settings.md` Part A.
// Every `useStore`/`writeStoreValue` caller (theme, sidebar collapsed,
// submenu open state, ...) is a plain entry in the ONE `drycms:store` blob
// this reads/writes wholesale, so it gets cross-device sync for free with no
// per-key wiring - callers never see this module at all.
// ---------------------------------------------------------------------------

const SYNC_VERSION_KEY = "drycms:store:syncVersion";
const PUSH_DEBOUNCE_MS = 800;

function readSyncVersion(): number {
  try {
    const raw = localStorage.getItem(SYNC_VERSION_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeSyncVersion(version: number): void {
  try {
    localStorage.setItem(SYNC_VERSION_KEY, String(version));
  } catch {
    // Same private-mode fallback as `writeAll` - sync just retries next load.
  }
}

let pullDone = false;
let pulling = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

interface MemorySyncResponse {
  data?: Record<string, unknown>;
  version?: number;
}

/** Pushes the CURRENT full `drycms:store` blob up, carrying whatever
 * version this browser last agreed on with the server. A `409` means
 * another device wrote first since then - the server's response body IS its
 * own latest copy (`routes/memory.ts`), so that's adopted here directly
 * rather than retried; the next real local edit schedules a fresh push on
 * top of the now-current version. `window.fetch` here goes through
 * `lib/native/csrf-fetch.ts`'s global wrapper (installed at app bootstrap),
 * so the CSRF header/401-refresh-retry are already handled - this file
 * doesn't need to know about either. */
async function pushMemory(): Promise<void> {
  const { path } = window.__DRY_CONFIG__;
  try {
    const response = await fetch(`${path}/api/memory`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ data: readAll(), version: readSyncVersion() }),
    });
    const body = (await response.json().catch(() => ({}))) as MemorySyncResponse;
    if (!response.ok && response.status !== 409) return;
    if (body.data) writeAll(body.data);
    if (typeof body.version === "number") writeSyncVersion(body.version);
  } catch {
    // Offline/network error - the local write already succeeded; the next
    // debounced push (or the next `initMemorySync()` on a future load)
    // retries with the same still-current local version.
  }
}

function scheduleMemoryPush(): void {
  // Never push before the initial pull resolves (`initMemorySync` below) -
  // otherwise a page freshly loaded with STALE local data (this device was
  // offline last time it changed something) could race a legitimate
  // server-wins overwrite with this session's own first render's writes.
  if (!pullDone) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushMemory(), PUSH_DEBOUNCE_MS);
}

/**
 * Called once, as early as possible after authentication resolves (see
 * `DryLayout.tsx`'s mount effect - it never remounts once the authenticated
 * shell is up, so this can't double-run there). Pulls this account's synced
 * `drycms:store` from the server and reconciles per `routes/memory.ts`'s
 * version protocol - "server mới nhất luôn đúng" (the newest server value
 * always wins): a server version ahead of what THIS browser last agreed on
 * overwrites local; otherwise (equal, or local somehow ahead - e.g. this
 * device made an offline edit since its last sync) local is pushed up
 * instead. Idempotent - a call while a previous one is still in flight, or
 * after the first has already completed, is a no-op.
 *
 * Known limitation (v1, see the status file): an overwrite here updates
 * `localStorage` directly, not any already-mounted component's React state
 * or the `collapsed` signal in `store/dashboard.ts` - both only read once,
 * at mount. Called this early, the window where that matters is small (most
 * of the UI hasn't mounted yet), but a value changed on another device
 * moments before this tab was already open won't retroactively repaint
 * until the next navigation/reload.
 */
export async function initMemorySync(): Promise<void> {
  if (pullDone || pulling) return;
  pulling = true;
  const { path } = window.__DRY_CONFIG__;
  try {
    const response = await fetch(`${path}/api/memory`, { credentials: "same-origin" });
    if (!response.ok) return;
    const body = (await response.json()) as MemorySyncResponse;
    const serverVersion = body.version ?? 0;
    if (serverVersion > readSyncVersion()) {
      if (body.data) writeAll(body.data);
      writeSyncVersion(serverVersion);
      pullDone = true;
    } else {
      pullDone = true;
      await pushMemory();
    }
  } catch {
    // Offline at boot - local `drycms:store` keeps working for this
    // session; `pullDone` stays `false` so a later call (there isn't one
    // today, but this keeps the function safe to call again) can retry.
  } finally {
    pulling = false;
  }
}
