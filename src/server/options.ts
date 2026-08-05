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
const ICONS_DIR_NAME = "icons";
const CONTENT_FILE_NAME = "content.sqlite";
const COMPONENTS_STORAGE_DIR_NAME = "richtext-components";
const PAGE_COMPONENTS_STORAGE_DIR_NAME = "components";
const PAGES_CACHE_STORAGE_DIR_NAME = "pages-cache";
const TYPES_CACHE_STORAGE_DIR_NAME = "types-cache";
const KV_DIR_NAME = "kv";

const LOCAL_DATA_ROOT_DIR = ".dry";
const E2E_DATA_ROOT_DIR = "test-results/e2e-data";

/** `storage`'s real (non-test) local root - see `resolveStorageOption()`. */
const PUBLIC_DIR_NAME = "public";

export interface DryAiOption {
  /**
   * `codex`/`claude` under `kind: "local"` (runs that CLI on the same
   * machine), `openai`/`anthropic` under `kind: "cloudflare"` (calls the
   * provider's HTTP API using a stored `aiKey` record). There is no
   * separate `ai.mode` anymore - which provider values are valid follows
   * the top-level `DryOption.kind` toggle directly, same as every other
   * backend.
   */
  provider?: "codex" | "claude" | "openai" | "anthropic";
  /** Local executable name/path. Defaults to the selected provider CLI. */
  command?: string;
  /** Extra CLI arguments. Use `{prompt}` to control where the prompt is inserted. */
  args?: string[];
  /** Optional preferred `aiKey.name`; remaining configured keys are fallbacks. */
  keyName?: string;
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
   * `/name.ext` URL through Vite's normal static-asset serving.
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
 * `createStorageAdapter()` unchanged, it just points at a different root. */
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
}

export interface ResolvedTypesCacheOption {
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
  keyName?: string;
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
  ai: ResolvedAiOption;
  kv: ResolvedKvOption;
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

/** `mode` is derived from the top-level `kind`, never set independently
 * anymore - `"local"` runs a CLI, `"cloudflare"` calls a provider HTTP API
 * via a stored `aiKey` record (see `DryAiOption.provider`'s doc comment). */
function resolveAiOption(kind: "local" | "cloudflare", option: DryAiOption = {}): ResolvedAiOption {
  const mode = kind === "local" ? "local" : "server";
  const timeoutMs = resolvePositiveNumber(option.timeoutMs, "ai.timeoutMs", 120_000);
  const lang = option.lang ?? "en";
  if (typeof lang !== "string" || !lang.trim()) {
    throw new TypeError('[drycms] `ai.lang` must be a non-empty string.');
  }

  if (mode === "local") {
    const provider = option.provider ?? "codex";
    if (provider !== "codex" && provider !== "claude") {
      throw new Error('[drycms] `ai.provider` must be `codex` or `claude` when `kind` is `local`.');
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
    throw new Error('[drycms] `ai.provider` must be `openai` or `anthropic` when `kind` is `cloudflare`.');
  }
  const model = option.model ?? (provider === "openai" ? "gpt-5" : "claude-sonnet-4-20250514");
  const baseUrl = option.baseUrl ?? (provider === "openai" ? "https://api.openai.com" : "https://api.anthropic.com");
  if (typeof model !== "string" || !model.trim()) throw new TypeError('[drycms] `ai.model` must be a non-empty string.');
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) throw new TypeError('[drycms] `ai.baseUrl` must be an http(s) URL.');
  if (option.keyName !== undefined && (typeof option.keyName !== "string" || !option.keyName.trim())) {
    throw new TypeError('[drycms] `ai.keyName` must be a non-empty string when provided.');
  }
  return { mode, provider, keyName: option.keyName?.trim(), model: model.trim(), baseUrl: baseUrl.replace(/\/+$/, ""), timeoutMs, lang: lang.trim() };
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

  return {
    path,
    kind,
    storage: resolveStorageOption(kind, overrides),
    icons: resolveStorageBackedOption(kind, ICONS_DIR_NAME, overrides),
    content: resolveContentOption(kind, overrides),
    components: { storage: resolveStorageBackedOption(kind, COMPONENTS_STORAGE_DIR_NAME, overrides) },
    pageComponents: { storage: resolveStorageBackedOption(kind, PAGE_COMPONENTS_STORAGE_DIR_NAME, overrides) },
    pagesCache: { storage: resolveStorageBackedOption(kind, PAGES_CACHE_STORAGE_DIR_NAME, overrides) },
    typesCache: { storage: resolveStorageBackedOption(kind, TYPES_CACHE_STORAGE_DIR_NAME, overrides) },
    ai: resolveAiOption(kind, options.ai),
    kv: resolveKvOption(kind, options.kv, overrides),
  };
}
