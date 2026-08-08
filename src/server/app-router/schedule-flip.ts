import type { DryRouteContext } from "../context.js";
import type { PagesRegistryAdapter } from "../../content-types/engine/pages-registry-types.js";
import { publishImmutableObject } from "./built-pages-storage.js";

/**
 * The cron half of `schedule` (`plans/app-r2.md` mục 9) - flips every
 * `_pages` row whose `publish_at` is now due onto its stable live key.
 * Never renders anything (decision #2 holds even here): the HTML for a
 * scheduled build was already produced client-side, at build time, by
 * whoever staged it - this only copies bytes already sitting at an
 * immutable key onto the pathname-derived one `readBuiltPage` reads.
 *
 * NOT reading a user-configurable interval yet (mục 9's "chỉnh được trong
 * Settings" - see `status/app-r2-build.md`): today's cadence is whatever
 * `wrangler.jsonc`'s `triggers.crons` expression says, fixed. The interval
 * SETTING (read from `systemSettings`, gating out early on ticks that
 * haven't waited long enough) is a small follow-up on top of this, not
 * blocked by anything here - `runScheduledFlip` itself doesn't care how
 * often it's called.
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
