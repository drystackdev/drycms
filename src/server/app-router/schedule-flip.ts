import type { DryRouteContext } from "../context.js";
import type { PagesRegistryAdapter } from "../../content-types/engine/pages-registry-types.js";
import { publishImmutableObject } from "./built-pages-storage.js";
import { getAuthSecurityStore } from "../auth-security.js";
export { parseScheduleFlipIntervalMinutes, DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES } from "../../lib/schedule-flip-setting.js";

/**
 * The cron half of `schedule` (`plans/app-r2.md` mục 9) - flips every
 * `_pages` row whose `publish_at` is now due onto its stable live key.
 * Never renders anything (decision #2 holds even here): the HTML for a
 * scheduled build was already produced client-side, at build time, by
 * whoever staged it - this only copies bytes already sitting at an
 * immutable key onto the pathname-derived one `readBuiltPage` reads.
 *
 * Deliberately unaware of the interval SETTING (`parseScheduleFlipIntervalMinutes`,
 * re-exported below from `lib/schedule-flip-setting.ts`) - `wrangler.jsonc`'s
 * cron cadence is the finest anything here needs, and whether THIS
 * particular tick should even run is the caller's concern
 * (`entry-worker.ts`'s `scheduled` export, via `shouldRunScheduledFlip`),
 * not this function's. Keeps this trivially testable without mocking
 * KV/settings, and matches its own single responsibility: flip whatever's
 * due, whenever called.
 */
export async function runScheduledFlip(context: Pick<DryRouteContext, "env">, pagesRegistry: PagesRegistryAdapter, nowMs: number): Promise<string[]> {
  const due = await pagesRegistry.listDueForPublish(nowMs);
  const flipped: string[] = [];
  for (const page of due) {
    const liveKey = await publishImmutableObject(context, page.path, page.objectKey);
    await pagesRegistry.markPublished(page.path, liveKey);
    flipped.push(page.path);
  }
  return flipped;
}

/** `"schedule-flip"` is its own KV namespace, so this can never collide
 * with `auth-security.ts`'s own keys despite sharing its store instance -
 * `rate-limit.ts` already reuses the exact same store the exact same way,
 * for an equally not-really-auth concern (login throttling), under its own
 * `"auth-rate-limit"` namespace. Not worth a second KV binding/adapter
 * dance just for one small timestamp. */
const LAST_RUN_NAMESPACE = "schedule-flip";
const LAST_RUN_KEY = "last-run-at";

/** Whether enough time has passed since the last run to actually do one -
 * `entry-worker.ts`'s `scheduled` export calls this BEFORE `runScheduledFlip`
 * (not inside it, see that function's own doc comment), so a tick that
 * fires too soon costs one KV read and nothing else: no D1 round trip, no
 * `listDueForPublish` call. First-ever tick (no recorded run yet) always
 * runs. */
export async function shouldRunScheduledFlip(env: Record<string, unknown>, intervalMinutes: number, nowMs: number): Promise<boolean> {
  const lastRunAt = await getAuthSecurityStore(env).get<number>(LAST_RUN_NAMESPACE, LAST_RUN_KEY);
  if (lastRunAt === null) return true;
  return nowMs - lastRunAt >= intervalMinutes * 60_000;
}

/** Called after every tick that actually ran (regardless of whether
 * anything was due to flip) - the throttle is about how often to even
 * CHECK, not how often something happened to publish, so an empty run
 * still resets the clock (matches quyết định #11's intent: a chosen
 * CADENCE, not "check every 15 min until something's due then wait an
 * hour"). */
export async function recordScheduledFlipRun(env: Record<string, unknown>, nowMs: number): Promise<void> {
  await getAuthSecurityStore(env).set(LAST_RUN_NAMESPACE, LAST_RUN_KEY, nowMs, { durability: "sync" });
}
