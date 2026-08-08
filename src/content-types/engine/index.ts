import type { ResolvedContentOption } from "../../server/options.js";
import { createD1ContentEngineAdapter } from "./d1.js";
import { createD1ContentEntryEngineAdapter } from "./entries-d1.js";
import { createSqliteContentEntryEngineAdapter } from "./entries-sqlite.js";
import type { ContentEntryEngineAdapter } from "./entries-types.js";
import { createD1PagesRegistryAdapter } from "./pages-registry-d1.js";
import { createSqlitePagesRegistryAdapter } from "./pages-registry-sqlite.js";
import type { PagesRegistryAdapter } from "./pages-registry-types.js";
import { createSqliteContentEngineAdapter } from "./sqlite.js";
import { ContentEngineError, type ContentEngineAdapter } from "./types.js";

/**
 * `runtimeEnv` is only required for `engine: "D1"` (the live `D1Database`
 * binding only exists per-request, unlike every other resolved option -
 * see `ResolvedD1ContentOption`'s docs). The `sqlite` branch ignores it and
 * opens its connection immediately; safe to module-cache the returned
 * adapter for `sqlite`, but a `D1` adapter must be constructed fresh per
 * request (inside the route handler), not once at module scope.
 */
export function createContentEngineAdapter(
  option: ResolvedContentOption,
  runtimeEnv?: Record<string, unknown>,
): ContentEngineAdapter {
  switch (option.engine) {
    case "sqlite":
      return createSqliteContentEngineAdapter(option);
    case "D1":
      return createD1ContentEngineAdapter(option, runtimeEnv);
    default:
      throw new ContentEngineError(
        "unsupported",
        `content.engine "${(option as { engine: string }).engine}" is not implemented yet.`,
      );
  }
}

/** Same dual-engine selection as `createContentEngineAdapter`, for the entry
 * (row-CRUD) engine instead of the schema engine. */
export function createContentEntryEngineAdapter(
  option: ResolvedContentOption,
  runtimeEnv?: Record<string, unknown>,
): ContentEntryEngineAdapter {
  switch (option.engine) {
    case "sqlite":
      return createSqliteContentEntryEngineAdapter(option);
    case "D1":
      return createD1ContentEntryEngineAdapter(option, runtimeEnv);
    default:
      throw new ContentEngineError(
        "unsupported",
        `content.engine "${(option as { engine: string }).engine}" is not implemented yet.`,
      );
  }
}

/** Same dual-engine selection, for the page-build registry (`_pages`/
 * `_page_deps`, `plans/app-r2.md` mục 5) - always keyed off `content`'s
 * engine choice, since it lives in the SAME physical database/binding as
 * content entries (needed for `listStalePaths`'s JOIN against `_versions`),
 * not a separately-configurable option. */
export function createPagesRegistryAdapter(
  option: ResolvedContentOption,
  runtimeEnv?: Record<string, unknown>,
): PagesRegistryAdapter {
  switch (option.engine) {
    case "sqlite":
      return createSqlitePagesRegistryAdapter(option);
    case "D1":
      return createD1PagesRegistryAdapter(option, runtimeEnv);
    default:
      throw new ContentEngineError(
        "unsupported",
        `content.engine "${(option as { engine: string }).engine}" is not implemented yet.`,
      );
  }
}

export { ContentEngineError };
export type { ContentEngineAdapter, ContentEngineErrorCode } from "./types.js";
export { ContentEntryError } from "./entries-types.js";
export type { ContentEntryEngineAdapter, ContentEntryErrorCode, EntryPage, EntryQuery, EntryRow } from "./entries-types.js";
export type { PageDependency, PageRecord, PagesRegistryAdapter, StalePageInfo } from "./pages-registry-types.js";
