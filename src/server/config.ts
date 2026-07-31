import userOptions from "../../dry.config.js";
import { resolveOptions } from "./options.js";

/**
 * Resolved once at server startup (dev: when Vite's SSR module graph first
 * loads this module; prod: at process start) and reused for the lifetime of
 * the process - same "resolve once, read everywhere" contract the old
 * `virtual:drycms/*-config` Vite plugins gave each injected Astro route.
 */
export const resolved = resolveOptions(userOptions);

export const { path, storage, icons, content } = resolved;
export const richtextComponentsStorage = resolved.richtext.storage;
export const richtextComponentsDir = resolved.richtext.componentsDir;
