import { content } from "./config.js";
import type { DryRouteContext } from "./context.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../content-types/engine/index.js";
import type { ContentEntryEngineAdapter } from "../content-types/engine/entries-types.js";
import type { ContentEngineAdapter } from "../content-types/engine/types.js";

export interface ContentAdapters {
  schema: ContentEngineAdapter;
  entries: ContentEntryEngineAdapter;
}

/**
 * SQLite and file adapters are safe to share for the life of the module. D1
 * adapters contain a live request binding, so they are created once per route
 * context instead. Keeping both decisions here prevents every route from
 * reimplementing the same runtime split.
 */
const moduleAdapters: ContentAdapters | undefined = content.engine !== "D1"
  ? {
      schema: createContentEngineAdapter(content),
      entries: createContentEntryEngineAdapter(content),
    }
  : undefined;

const requestAdapters = new WeakMap<object, ContentAdapters>();

export function getContentAdapters(context: DryRouteContext): ContentAdapters {
  if (moduleAdapters) return moduleAdapters;
  const existing = requestAdapters.get(context);
  if (existing) return existing;
  const adapters = {
    schema: createContentEngineAdapter(content, context.env),
    entries: createContentEntryEngineAdapter(content, context.env),
  };
  requestAdapters.set(context, adapters);
  return adapters;
}
