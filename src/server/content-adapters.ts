import { content } from "./config.js";
import type { DryRouteContext } from "./context.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter, createPagesRegistryAdapter } from "../content-types/engine/index.js";
import type { ContentEntryEngineAdapter } from "../content-types/engine/entries-types.js";
import type { ContentEngineAdapter } from "../content-types/engine/types.js";
import type { PagesRegistryAdapter } from "../content-types/engine/pages-registry-types.js";

export interface ContentAdapters {
  schema: ContentEngineAdapter;
  entries: ContentEntryEngineAdapter;
  pagesRegistry: PagesRegistryAdapter;
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
      pagesRegistry: createPagesRegistryAdapter(content),
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
    pagesRegistry: createPagesRegistryAdapter(content, context.env),
  };
  requestAdapters.set(context, adapters);
  return adapters;
}
