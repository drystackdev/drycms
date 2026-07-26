import type { ResolvedContentOption } from "../../integration/options.js";
import { createD1ContentEngineAdapter } from "./d1.js";
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

export { ContentEngineError };
export type { ContentEngineAdapter, ContentEngineErrorCode } from "./types.js";
