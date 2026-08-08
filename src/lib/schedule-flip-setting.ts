/**
 * Pure - no other imports, so both `server/app-router/schedule-flip.ts`
 * (reads it every cron tick) and `pages/PageBuild.tsx` (the "Publish
 * schedule" form that writes it) can import this directly, the same way
 * `system-settings-theme.ts` is already shared between `routes/
 * system-settings.ts` and `Settings.tsx` for the SAME `systemSettings.data`
 * blob's theme keys. Kept as its own module rather than added to that file:
 * `scheduleFlipIntervalMinutes` is an unrelated concern that just happens
 * to share the same "misc setting, no dedicated column" JSON blob (see
 * `plans/app-r2.md` mục 9) - not a theme value, and a client-side import of
 * a server-only module (`schedule-flip.ts` pulls in D1/KV-backed adapters)
 * would break the browser build the same way `assets.ts` did before
 * `resolve-asset-href.ts` was split out (`status/app-r2-build.md`).
 */

/** Quyết định #11's default. */
export const DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES = 60;

/** `raw` is `systemSettings.data` (`entry.value.data`). Falls back to the
 * default for anything not a positive finite number - same "don't throw,
 * just fall back to shipped defaults" spirit
 * `system-settings-theme.ts`'s `parseSystemSettingsData` already uses. */
export function parseScheduleFlipIntervalMinutes(raw: unknown): number {
  if (typeof raw !== "string" || !raw) return DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES;
  try {
    const parsed: unknown = JSON.parse(raw);
    const value = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).scheduleFlipIntervalMinutes : undefined;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES;
  } catch {
    return DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES;
  }
}
