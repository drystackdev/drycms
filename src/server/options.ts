import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/**
 * Fixed binding names every `kind: "cloudflare"` resolution uses - matching
 * `wrangler.jsonc`'s `r2_buckets[].binding`/`d1_databases[].binding`/
 * `kv_namespaces[].binding`. Not configurable: collapsing every backend
 * choice to one `kind` field (see `DryOption.kind`'s doc comment) only
 * works if the binding names on both sides of that contract are fixed too -
 * a customizable binding name would just reintroduce the per-option
 * surface this was meant to remove. Rename these (and `wrangler.jsonc` to
 * match) if you need different binding names for your own Cloudflare
 * account.
 */
const R2_BUCKET_BINDING = "MEDIA_BUCKET";
const D1_CONTENT_BINDING = "CONTENT_DB";
const KV_NAMESPACE_BINDING = "KV";

/** Fixed local directory/file names (also reused as the R2 key prefix for
 * the same root under `kind: "cloudflare"`) - see `R2_BUCKET_BINDING`'s doc
 * comment on why these are fixed rather than configurable. */
const STORAGE_DIR_NAME = "storage";
/** Icons are just image files too - `icons` is always resolved as a
 * subfolder of `storage`'s own root (see `resolveIconsOption()`) rather than
 * an independent root, under both `kind`s. */
const ICONS_DIR_NAME = "dry-icons";
const CONTENT_FILE_NAME = "content.sqlite";
const COMPONENTS_STORAGE_DIR_NAME = "richtext-components";
const PAGE_COMPONENTS_STORAGE_DIR_NAME = "components";
const PAGES_CACHE_STORAGE_DIR_NAME = "pages-cache";
const TYPES_CACHE_STORAGE_DIR_NAME = "types-cache";
/** `src/apps/pages/**` source `.tsx`/`.ts` - `plans/app-r2.md` quyết định
 * #6: git remains the source of truth, this root is what `scripts/sync-pages-r2.ts`
 * (push, no-overwrite) pushes INTO and the browser build pipeline reads
 * FROM (mục 1's route manifest, mục 7's per-page compile). Deliberately
 * separate from `pagesCacheStorage` (built HTML OUTPUT) and
 * `pageComponentsStorage` (Component Builder's unrelated `.dry/components`
 * tree, quyết định #10 - left alone). */
const PAGES_SOURCE_STORAGE_DIR_NAME = "pages-source";
const KV_DIR_NAME = "kv";

/** Long enough that a hot page's repeat views stop reaching the Worker's
 * D1/R2 work at all, short enough that an editor's change is live without
 * anyone purging anything (see `status/worker-request-cost.md`). */
const DEFAULT_PAGES_CACHE_EDGE_TTL_SECONDS = 60;

const LOCAL_DATA_ROOT_DIR = ".dry";
const E2E_DATA_ROOT_DIR = "test-results/e2e-data";

/** `storage`'s real (non-test) local root - see `resolveStorageOption()`. */
const PUBLIC_DIR_NAME = "public";

export interface DryAiOption {
  /**
   * How AI requests are executed. Defaults to following the top-level
   * `kind` toggle - `"local"` under `kind: "local"` (runs a CLI on the same
   * machine), `"server"` under `kind: "cloudflare"` (calls a provider's
   * HTTP API using a stored `aiKey` record).
   *
   * Set this explicitly to run server-mode AI (a real provider HTTP call,
   * needed for anything that sends images/attachments - the local CLI mode
   * has no attachment protocol) while every OTHER backend (storage/content/
   * kv) stays on `kind: "local"` - e.g. for developing/testing an AI
   * feature without standing up Cloudflare D1/R2/KV and a Workers adapter.
   *
   * `"local"` cannot be combined with `kind: "cloudflare"` - spawning a CLI
   * via `node:child_process` does not work in a Workers runtime.
   */
  mode?: "local" | "server";
  /** `codex`/`claude` when `ai.mode` is `"local"`, `openai`/`anthropic` when
   * `ai.mode` is `"server"` (see `mode`'s doc comment for how that's
   * decided). */
  provider?: "codex" | "claude" | "openai" | "anthropic";
  /** Local executable name/path. Defaults to the selected provider CLI. */
  command?: string;
  /** Extra CLI arguments. Use `{prompt}` to control where the prompt is inserted. */
  args?: string[];
  /** Server provider model. */
  model?: string;
  /** Server provider base URL override. */
  baseUrl?: string;
  /** Local working directory. Defaults to the app's current working directory. */
  cwd?: string;
  /** Request/process timeout in milliseconds. */
  timeoutMs?: number;
  /** Display language for AI-generated, user-facing text (e.g. the Content
   * Types AI schema wizard's questions/choice labels). The prompt sent to
   * the model always stays English regardless of this setting - only the
   * text it's asked to write back for a person to read follows `lang`.
   * @default "en" */
  lang?: string;
}

/**
 * Key Value store performance/eviction tuning - independent of `kind`
 * (`DryOption.kind` decides WHERE the store lives; these decide how it
 * behaves once it's there), so they stay their own optional block rather
 * than collapsing into the top-level toggle.
 */
export interface DryKvTuningOption {
  maxEntries?: number;
  maxBytes?: number;
  defaultTtlMs?: number;
  idleTtlMs?: number;
  cleanupIntervalMs?: number;
  flushDebounceMs?: number;
  flushBatchSize?: number;
  durability?: "memory" | "async" | "sync";
}

export interface DryPagesCacheOption {
  /**
   * How many seconds Cloudflare's edge cache may serve a rendered public
   * page for, before the Worker runs again for that URL. Only anonymous
   * `GET`s are ever stored (a request carrying an admin/VEI cookie bypasses
   * the layer in both directions), so an editor always sees their own change
   * immediately; an anonymous visitor sees it at most `edgeTtl` seconds
   * later. `0` turns the layer off, leaving only the version-checked
   * pages-cache in storage, which is never stale but costs a D1 round trip
   * per view (see `status/worker-request-cost.md`).
   *
   * Workers-only: the Cache API does not exist under the Node adapter, and
   * Cloudflare disables it on `*.workers.dev` - a Worker has to be served
   * through a custom domain/route for this to do anything.
   *
   * @default 60
   */
  edgeTtl?: number;
}

export interface DryOption {
  /**
   * Base path the drycms admin UI is mounted on.
   * Visiting it redirects to `${path}/dashboard`.
   *
   * @default "/dry"
   */
  path?: string;
  /**
   * Single toggle for every persistence backend the app needs at once -
   * object storage (`storage`/`icons`/richtext components/page components/
   * pages cache/types cache), the content engine, and the Key Value store.
   *
   * `"local"`: real Node - a SQLite file plus local filesystem directories
   * under `.dry/` (or `test-results/e2e-data/` when `DRYCMS_E2E=1`, see
   * `scripts/e2e-server.mjs`) - except `storage` (user-uploaded media),
   * which resolves straight to the project's `public/` directory instead
   * (see `resolveStorageOption()`), so an upload is reachable at its plain
   * `/name.ext` URL through Vite's normal static-asset serving. `icons`
   * is not an independent root either way - it's always a `dry-icons`
   * subfolder of wherever `storage` itself landed (see
   * `resolveIconsOption()`), local or `cloudflare` alike.
   *
   * `"cloudflare"`: Cloudflare Workers - D1 (content), one shared R2 bucket (every
   * storage-backed root, key-prefixed) and Workers KV, using the fixed
   * binding names `wrangler.jsonc` declares (`CONTENT_DB`/`MEDIA_BUCKET`/
   * `KV`) - see `status/cloudflare-workers-adapter.md`. There is no
   * per-backend `kind`/`root`/`binding`/`file` override anymore; this one
   * field is the whole surface.
   *
   * @default "local"
   */
  kind?: "local" | "cloudflare";
  ai?: DryAiOption;
  kv?: DryKvTuningOption;
  pagesCache?: DryPagesCacheOption;
  /** The public site's `<html lang>` (`render.ts`'s `DOC_HEAD_PREFIX`) - a
   * real per-deployment constant, unlike `ai.lang` (a separate, optional
   * setting for AI-generated text specifically, not every app configures
   * `ai` at all) - kept independent rather than derived from it.
   * @default "en" */
  lang?: string;
}

/**
 * Type-safe entry point for `dry.config.ts`.
 *
 * This deliberately returns the raw options unchanged: `resolveOptions()` is
 * the single place that applies defaults and resolves paths.
 */
export function config(options: DryOption = {}): DryOption {
  return options;
}

export interface ResolvedLocalStorageOption {
  kind: "local";
  root: string;
}

export interface ResolvedR2StorageOption {
  kind: "r2";
  binding: string;
  /** Key prefix within the bucket, no leading/trailing slash (`""` = bucket
   * root). */
  prefix: string;
}

export type ResolvedStorageOption = ResolvedLocalStorageOption | ResolvedR2StorageOption;

/** Same shape as `ResolvedStorageOption` - the Icon Management feature reuses
 * `createStorageAdapter()` unchanged, it just points at a subfolder of
 * `storage`'s own root (see `resolveIconsOption()`). */
export type ResolvedIconsOption = ResolvedStorageOption;

export interface ResolvedSqliteContentOption {
  engine: "sqlite";
  file: string;
}

export interface ResolvedD1ContentOption {
  engine: "D1";
  binding: string;
}

export type ResolvedContentOption = ResolvedSqliteContentOption | ResolvedD1ContentOption;

export interface ResolvedComponentsOption {
  storage: ResolvedStorageOption;
}

export interface ResolvedPageComponentsOption {
  storage: ResolvedStorageOption;
}

export interface ResolvedPagesCacheOption {
  storage: ResolvedStorageOption;
  /** Seconds a rendered public page may be held in the Cloudflare edge cache
   * (`app-router/edge-cache.ts`). `0` disables that layer entirely, leaving
   * only the version-checked `storage` cache. */
  edgeTtl: number;
}

export interface ResolvedTypesCacheOption {
  storage: ResolvedStorageOption;
}

export interface ResolvedPagesSourceOption {
  storage: ResolvedStorageOption;
}

export interface ResolvedLocalAiOption {
  mode: "local";
  provider: "codex" | "claude";
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  lang: string;
}

export interface ResolvedServerAiOption {
  mode: "server";
  provider: "openai" | "anthropic";
  model: string;
  baseUrl: string;
  timeoutMs: number;
  lang: string;
}

export type ResolvedAiOption = ResolvedLocalAiOption | ResolvedServerAiOption;

export interface ResolvedKvTuning {
  maxEntries: number;
  maxBytes: number;
  defaultTtlMs?: number;
  idleTtlMs?: number;
  cleanupIntervalMs: number;
  flushDebounceMs: number;
  flushBatchSize: number;
  durability: "memory" | "async" | "sync";
}

/**
 * The union still has all 4 historical kinds (`kv/factory.ts`'s
 * `createKeyValueAdapter`/`createRequestKeyValueAdapter` still implement
 * every one of them) even though `resolveOptions()` below only ever
 * produces `"local"` or `"KV"` now - `"sqlite"`/`"D1"` remain valid values
 * for anything that builds a `ResolvedKvOption` by hand instead of through
 * `DryOption.kind`.
 */
export type ResolvedKvOption = ResolvedKvTuning & (
  | ({ kind: "local"; root: string })
  | ({ kind: "sqlite"; file: string })
  | ({ kind: "D1"; binding: string })
  | ({ kind: "KV"; binding: string })
);

export interface ResolvedDryOption {
  path: string;
  kind: "local" | "cloudflare";
  storage: ResolvedStorageOption;
  icons: ResolvedIconsOption;
  content: ResolvedContentOption;
  components: ResolvedComponentsOption;
  pageComponents: ResolvedPageComponentsOption;
  pagesCache: ResolvedPagesCacheOption;
  typesCache: ResolvedTypesCacheOption;
  pagesSource: ResolvedPagesSourceOption;
  ai: ResolvedAiOption;
  kv: ResolvedKvOption;
  lang: string;
}

export const DEFAULT_PATH = "/dry";

let dotEnvCache: Record<string, string> | undefined;

/**
 * `dry.config.ts`/`vite.config.ts` are evaluated before any of `.env`'s vars
 * are guaranteed to be in `process.env` - Vite's own env loader only feeds
 * `import.meta.env` for *application* code, not `process.env`, and depending
 * on how the dev server gets launched (`bunx`, a plain `node`, a
 * package.json script shelling out), the wrapping runtime's own `.env`
 * auto-load may not have run yet either - reproduced directly: `bun run
 * <script that shells out to node>` does NOT forward Bun's auto-loaded
 * `.env` vars to that child process. A tiny parser here, consulted only when
 * the real environment doesn't already have the var, makes config-time
 * resolution work regardless of invocation method.
 */
function readDotEnv(): Record<string, string> {
  if (dotEnvCache) return dotEnvCache;
  dotEnvCache = {};
  let text: string;
  try {
    text = readFileSync(resolvePath(process.cwd(), ".env"), "utf8");
  } catch {
    return dotEnvCache;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    dotEnvCache[key] = value;
  }
  return dotEnvCache;
}

/** Exported for reuse outside config resolution too - `lib/secret-crypto.ts`
 * reads `DRYCMS_SECRET_KEY` through this same `.env`-then-`process.env`
 * fallback rather than duplicating the parsing logic. */
export function readEnvVar(name: string): string | undefined {
  // An explicitly-present process variable (including an empty/undefined
  // test stub) wins over `.env`. This keeps tests and deployments able to
  // intentionally clear a value without the local `.env` resurrecting it,
  // while an entirely absent process variable still falls back to `.env`.
  if (Object.prototype.hasOwnProperty.call(process.env, name)) return process.env[name] || undefined;
  return readDotEnv()[name];
}

export interface ResolveOptionsOverrides {
  /**
   * Test/tooling-only escape hatch - NOT part of `DryOption`, so a real
   * `dry.config.ts` has no way to reach it. Overrides the directory
   * `kind: "local"` resolves every default path under (normally `.dry`, or
   * `test-results/e2e-data` when `DRYCMS_E2E=1` - see
   * `scripts/e2e-server.mjs`) - lets a unit test that calls `resolveOptions`
   * directly get a real, isolated `mkdtempSync` root without
   * `resolveOptions()` regaining a per-backend `root`/`file`/`binding`
   * surface just for that.
   */
  localDataRoot?: string;
}

function localBaseDir(overrides: ResolveOptionsOverrides): string {
  if (overrides.localDataRoot !== undefined) return overrides.localDataRoot;
  return readEnvVar("DRYCMS_E2E") === "1" ? E2E_DATA_ROOT_DIR : LOCAL_DATA_ROOT_DIR;
}

function resolvePagesCacheEdgeTtl(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGES_CACHE_EDGE_TTL_SECONDS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError('[drycms] `pagesCache.edgeTtl` must be a non-negative integer number of seconds (0 disables the edge cache).');
  }
  return value;
}

function resolveStorageBackedOption(
  kind: "local" | "cloudflare",
  dirName: string,
  overrides: ResolveOptionsOverrides,
): ResolvedStorageOption {
  if (kind === "cloudflare") return { kind: "r2", binding: R2_BUCKET_BINDING, prefix: dirName };
  return { kind: "local", root: resolvePath(process.cwd(), localBaseDir(overrides), dirName) };
}

/**
 * `storage` (the generic File Manager root - user-uploaded media) is
 * special-cased under `kind: "local"`: it resolves directly to the
 * project's `public/` directory rather than nesting under `.dry/` like
 * every other backend, so an uploaded file is immediately reachable at its
 * plain `/name.ext` URL through Vite's normal static-asset serving instead
 * of only through the storage API route.
 *
 * Test isolation still wins over this default exactly like every other
 * local root: `overrides.localDataRoot` and `DRYCMS_E2E=1` both keep
 * nesting storage under their own root, so tests never write into the
 * repo's real `public/`.
 */
function resolveStorageOption(
  kind: "local" | "cloudflare",
  overrides: ResolveOptionsOverrides,
): ResolvedStorageOption {
  if (kind === "cloudflare") return { kind: "r2", binding: R2_BUCKET_BINDING, prefix: STORAGE_DIR_NAME };
  if (overrides.localDataRoot === undefined && readEnvVar("DRYCMS_E2E") !== "1") {
    return { kind: "local", root: resolvePath(process.cwd(), PUBLIC_DIR_NAME) };
  }
  return { kind: "local", root: resolvePath(process.cwd(), localBaseDir(overrides), STORAGE_DIR_NAME) };
}

/**
 * `icons` (Icon Management's SVG library) is not an independent root - an
 * icon is just an image file, so it's always resolved as a `dry-icons`
 * subfolder of `storage`'s own already-resolved root, under both `kind`s.
 * Deriving it from `storage`'s resolved value (rather than recomputing a
 * root independently from `overrides`/`localBaseDir()`) is what makes this
 * hold in every case at once - the real `public/` default, a unit test's
 * `overrides.localDataRoot`, and `DRYCMS_E2E=1` all "just work" without
 * their own icons-specific branch.
 */
function resolveIconsOption(storage: ResolvedStorageOption): ResolvedIconsOption {
  if (storage.kind === "r2") {
    return { kind: "r2", binding: storage.binding, prefix: `${storage.prefix}/${ICONS_DIR_NAME}` };
  }
  return { kind: "local", root: resolvePath(storage.root, ICONS_DIR_NAME) };
}

function resolveContentOption(kind: "local" | "cloudflare", overrides: ResolveOptionsOverrides): ResolvedContentOption {
  if (kind === "cloudflare") return { engine: "D1", binding: D1_CONTENT_BINDING };
  return { engine: "sqlite", file: resolvePath(process.cwd(), localBaseDir(overrides), CONTENT_FILE_NAME) };
}

function resolvePositiveNumber(value: unknown, key: string, fallback: number): number {
  const result = value ?? fallback;
  if (typeof result !== "number" || !Number.isFinite(result) || result <= 0) {
    throw new TypeError(`[drycms] \`${key}\` must be a positive finite number.`);
  }
  return result;
}

function resolveKvOption(
  kind: "local" | "cloudflare",
  option: DryKvTuningOption = {},
  overrides: ResolveOptionsOverrides,
): ResolvedKvOption {
  const tuning: ResolvedKvTuning = {
    maxEntries: resolvePositiveNumber(option.maxEntries, "kv.maxEntries", 10_000),
    maxBytes: resolvePositiveNumber(option.maxBytes, "kv.maxBytes", 32 * 1024 * 1024),
    defaultTtlMs: option.defaultTtlMs,
    idleTtlMs: option.idleTtlMs,
    cleanupIntervalMs: resolvePositiveNumber(option.cleanupIntervalMs, "kv.cleanupIntervalMs", 30_000),
    flushDebounceMs: resolvePositiveNumber(option.flushDebounceMs, "kv.flushDebounceMs", 100),
    flushBatchSize: resolvePositiveNumber(option.flushBatchSize, "kv.flushBatchSize", 100),
    durability: option.durability ?? "async",
  };
  for (const [key, value] of [["defaultTtlMs", option.defaultTtlMs], ["idleTtlMs", option.idleTtlMs]] as const) {
    if (value !== undefined) resolvePositiveNumber(value, `kv.${key}`, value);
  }

  if (kind === "cloudflare") return { ...tuning, kind: "KV", binding: KV_NAMESPACE_BINDING };
  return { ...tuning, kind: "local", root: resolvePath(process.cwd(), localBaseDir(overrides), KV_DIR_NAME) };
}

/** `mode` defaults to following the top-level `kind` but can be overridden
 * independently (see `DryAiOption.mode`'s doc comment) - `"local"` runs a
 * CLI, `"server"` calls a provider HTTP API via a stored `aiKey` record. */
function resolveAiOption(kind: "local" | "cloudflare", option: DryAiOption = {}): ResolvedAiOption {
  const mode = option.mode ?? (kind === "local" ? "local" : "server");
  if (mode !== "local" && mode !== "server") {
    throw new Error('[drycms] `ai.mode` must be "local" or "server".');
  }
  if (mode === "local" && kind === "cloudflare") {
    throw new Error('[drycms] `ai.mode` cannot be "local" when `kind` is "cloudflare" - spawning a CLI via `node:child_process` does not work in a Workers runtime.');
  }
  const timeoutMs = resolvePositiveNumber(option.timeoutMs, "ai.timeoutMs", 120_000);
  const lang = option.lang ?? "en";
  if (typeof lang !== "string" || !lang.trim()) {
    throw new TypeError('[drycms] `ai.lang` must be a non-empty string.');
  }

  if (mode === "local") {
    const provider = option.provider ?? "codex";
    if (provider !== "codex" && provider !== "claude") {
      throw new Error('[drycms] `ai.provider` must be `codex` or `claude` when `ai.mode` is `local`.');
    }
    const command = option.command ?? provider;
    if (typeof command !== "string" || !command.trim()) {
      throw new TypeError('[drycms] `ai.command` must be a non-empty string.');
    }
    const args = option.args ?? (provider === "codex" ? ["exec", "--ephemeral", "--skip-git-repo-check"] : ["-p"]);
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      throw new TypeError('[drycms] `ai.args` must be an array of strings.');
    }
    const cwd = option.cwd === undefined ? undefined : resolvePath(process.cwd(), option.cwd);
    return { mode, provider, command: command.trim(), args: [...args], cwd, timeoutMs, lang: lang.trim() };
  }

  const provider = option.provider ?? "openai";
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error('[drycms] `ai.provider` must be `openai` or `anthropic` when `ai.mode` is `server`.');
  }
  const model = option.model ?? (provider === "openai" ? "gpt-5" : "claude-sonnet-4-20250514");
  const baseUrl = option.baseUrl ?? (provider === "openai" ? "https://api.openai.com" : "https://api.anthropic.com");
  if (typeof model !== "string" || !model.trim()) throw new TypeError('[drycms] `ai.model` must be a non-empty string.');
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) throw new TypeError('[drycms] `ai.baseUrl` must be an http(s) URL.');
  return { mode, provider, model: model.trim(), baseUrl: baseUrl.replace(/\/+$/, ""), timeoutMs, lang: lang.trim() };
}

/**
 * Normalizes and validates user options. Throws on values that would produce a
 * broken route so the failure surfaces at config time rather than at request time.
 *
 * `overrides` is never supplied by `dry.config.ts`/`config()` - see
 * `ResolveOptionsOverrides`'s own doc comment.
 */
export function resolveOptions(options: DryOption = {}, overrides: ResolveOptionsOverrides = {}): ResolvedDryOption {
  const raw = options.path ?? DEFAULT_PATH;

  if (typeof raw !== "string") {
    throw new TypeError(
      `[drycms] \`path\` must be a string, received ${typeof raw}.`,
    );
  }

  let path = raw.trim().replace(/\\/g, "/");
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");

  if (path === "") {
    throw new Error(
      '[drycms] `path` cannot be the site root ("/"), it would take over every route. Use something like "/dry".',
    );
  }
  if (/[[\]]/.test(path)) {
    throw new Error(
      `[drycms] \`path\` cannot contain route parameters, received "${raw}".`,
    );
  }
  if (/[?#\s]/.test(path)) {
    throw new Error(
      `[drycms] \`path\` cannot contain "?", "#" or whitespace, received "${raw}".`,
    );
  }

  const kind = options.kind ?? "local";
  if (kind !== "local" && kind !== "cloudflare") {
    throw new Error(`[drycms] \`kind\` must be "local" or "cloudflare", received "${String(kind)}".`);
  }

  const storage = resolveStorageOption(kind, overrides);

  const lang = options.lang ?? "en";
  if (typeof lang !== "string" || !lang.trim()) {
    throw new TypeError('[drycms] `lang` must be a non-empty string.');
  }

  return {
    path,
    kind,
    storage,
    icons: resolveIconsOption(storage),
    content: resolveContentOption(kind, overrides),
    components: { storage: resolveStorageBackedOption(kind, COMPONENTS_STORAGE_DIR_NAME, overrides) },
    pageComponents: { storage: resolveStorageBackedOption(kind, PAGE_COMPONENTS_STORAGE_DIR_NAME, overrides) },
    pagesCache: {
      storage: resolveStorageBackedOption(kind, PAGES_CACHE_STORAGE_DIR_NAME, overrides),
      edgeTtl: resolvePagesCacheEdgeTtl(options.pagesCache?.edgeTtl),
    },
    typesCache: { storage: resolveStorageBackedOption(kind, TYPES_CACHE_STORAGE_DIR_NAME, overrides) },
    pagesSource: { storage: resolveStorageBackedOption(kind, PAGES_SOURCE_STORAGE_DIR_NAME, overrides) },
    ai: resolveAiOption(kind, options.ai),
    kv: resolveKvOption(kind, options.kv, overrides),
    lang: lang.trim(),
  };
}
