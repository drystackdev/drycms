import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/** Roadmap kinds not implemented yet - listed so an unsupported `kind` can
 * name what's coming instead of just saying "unknown". */
const PLANNED_STORAGE_KINDS = ["r2", "s3"];

export interface DryStorageOption {
  /**
   * Which backend serves `/dry/api/storage/**`.
   *
   * @default "local"
   */
  kind?: "local";
  /**
   * `local`: directory files are read from/written to, relative to the
   * consuming project's cwd (or an absolute path).
   *
   * @default ".dry/storage"
   */
  root?: string;
}

export interface DryIconsOption {
  /**
   * Which backend serves `/dry/api/icons/**`.
   *
   * @default "local"
   */
  kind?: "local";
  /**
   * Same semantics as `DryStorageOption.root`, but for the Icon Management
   * feature's own storage root - kept separate from `storage.root` so
   * managed UI icons never mix with user-uploaded media.
   *
   * @default ".dry/icons"
   */
  root?: string;
}

export interface DryContentOption {
  /**
   * Which backend the Content-Type Builder generates/migrates tables into.
   * `"file"` stores each record as a JSON file instead of a SQL table - no
   * DDL, no SQL parser, git-diffable.
   *
   * @default "sqlite"
   */
  engine?: "sqlite" | "D1" | "file";
  /**
   * `sqlite` only: path to the database file, relative to the consuming
   * project's cwd (or an absolute path).
   *
   * @default ".dry/content.sqlite"
   */
  file?: string;
  /**
   * `D1` only: the binding name configured in `wrangler.jsonc`'s
   * `d1_databases[].binding` (e.g. `"CONTENT_DB"`) - required for
   * `engine: "D1"`. The live `D1Database` itself is looked up per-request
   * from `context.env` (see `server/context.ts`), not from this option (it
   * isn't a JSON-serializable value, unlike every other resolved option).
   */
  binding?: string;
  /**
   * `engine: "file"` only: which backend serves the JSON content store -
   * local directory used for the JSON content store.
   *
   * @default "local"
   */
  kind?: "local";
  /**
   * `engine: "file"` only: same semantics as `DryStorageOption.root`, but
   * for the JSON content store's own root.
   *
   * @default ".dry/content"
  */
  root?: string;
}

export interface DryComponentsOption {
  /**
   * Where "confirmed" component records (label/type/props/shadow, written
   * once an admin picks "Use" on the component management page) are stored -
   * a root of its own, same shape as `storage`/`icons`, so it never mixes
   * with user-uploaded media.
   *
   * @default { root: ".dry/richtext-components" }
   */
  storage?: DryStorageOption;
}

export interface DryPageComponentsOption {
  /**
   * Where Component Builder's `.tsx` component tree (independent from
   * RichText's `components.storage` above - a page-builder concern, not a
   * RichText one) is stored - a root of its own, same shape as `storage`/
   * `icons`.
   *
   * @default { root: ".dry/components" }
   */
  storage?: DryStorageOption;
}

export interface DryAiOption {
  /** `local` runs a CLI on the same machine; `server` calls an AI HTTP API. */
  mode?: "local" | "server";
  /** `codex`/`claude` for local mode, `openai`/`anthropic` for server mode. */
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

export interface DryKvOption {
  /** Persistence backend for the server-side Key Value store. */
  kind?: "local" | "sqlite" | "D1" | "KV";
  /** Directory root for local persistence. @default ".dry/kv" */
  root?: string;
  /** SQLite file path when `kind` is `sqlite`. @default ".dry/kv.sqlite" */
  file?: string;
  /** D1/KV binding name when using a Workers runtime. */
  binding?: string;
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
  storage?: DryStorageOption;
  icons?: DryIconsOption;
  content?: DryContentOption;
  components?: DryComponentsOption;
  pageComponents?: DryPageComponentsOption;
  ai?: DryAiOption;
  kv?: DryKvOption;
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

export type ResolvedStorageOption = ResolvedLocalStorageOption;

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

/** The file content engine reuses `createStorageAdapter()` unchanged. */
export type ResolvedFileContentOption = { engine: "file" } & ResolvedStorageOption;

export type ResolvedContentOption = ResolvedSqliteContentOption | ResolvedD1ContentOption | ResolvedFileContentOption;

export interface ResolvedComponentsOption {
  storage: ResolvedStorageOption;
}

export interface ResolvedPageComponentsOption {
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

export type ResolvedKvOption = ResolvedKvTuning & (
  | ({ kind: "local"; root: string })
  | ({ kind: "sqlite"; file: string })
  | ({ kind: "D1"; binding: string })
  | ({ kind: "KV"; binding: string })
);

export interface ResolvedDryOption {
  path: string;
  storage: ResolvedStorageOption;
  icons: ResolvedIconsOption;
  content: ResolvedContentOption;
  components: ResolvedComponentsOption;
  pageComponents: ResolvedPageComponentsOption;
  ai: ResolvedAiOption;
  kv: ResolvedKvOption;
}

export const DEFAULT_PATH = "/dry";
export const DEFAULT_STORAGE_ROOT = ".dry/storage";
export const DEFAULT_ICONS_ROOT = ".dry/icons";
export const DEFAULT_CONTENT_FILE = ".dry/content.sqlite";
export const DEFAULT_CONTENT_ROOT = ".dry/content";
export const DEFAULT_COMPONENTS_STORAGE_ROOT = ".dry/richtext-components";
export const DEFAULT_PAGE_COMPONENTS_STORAGE_ROOT = ".dry/components";
export const DEFAULT_KV_ROOT = ".dry/kv";
export const DEFAULT_KV_FILE = ".dry/kv.sqlite";
export const DEFAULT_KV_BINDING = "KV";

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

/**
 * Shared by `resolveStorageOption` and `resolveIconsOption` - both are just a
 * only in which config key/default root they read. `optionName` is used
 * purely for error messages (`"storage"` or `"icons"`).
 */
function resolveFileBackedOption(
  option: { kind?: unknown; root?: unknown; branch?: unknown } | undefined,
  defaultRoot: string,
  optionName: string,
): ResolvedStorageOption {
  const { kind: rawKind, root: rawRoot, branch: rawBranch } = option ?? {};
  const kind = rawKind ?? "local";
  if (typeof kind !== "string") {
    throw new TypeError(
      `[drycms] \`${optionName}.kind\` must be a string, received ${typeof kind}.`,
    );
  }
  if (kind !== "local") {
    const roadmap = PLANNED_STORAGE_KINDS.includes(kind)
      ? ` \`${optionName}.kind: "${kind}"\` is on the roadmap but not implemented yet.`
      : ` "${kind}" is not a recognized storage kind.`;
    throw new Error(
      `[drycms]${roadmap} Only "local" is available today (planned: ${PLANNED_STORAGE_KINDS.join(", ")}).`,
    );
  }

  const root = rawRoot ?? defaultRoot;
  if (typeof root !== "string") {
    throw new TypeError(
      `[drycms] \`${optionName}.root\` must be a string, received ${typeof root}.`,
    );
  }
  if (rawBranch !== undefined && typeof rawBranch !== "string") {
    throw new TypeError(
      `[drycms] \`${optionName}.branch\` must be a string, received ${typeof rawBranch}.`,
    );
  }
  if (rawBranch !== undefined) {
    throw new Error(`[drycms] \`${optionName}.branch\` is no longer supported; use local storage without a branch.`);
  }
  const normalizedRoot = root.replace(/\/+$/, "");
  return { kind: "local", root: resolvePath(process.cwd(), normalizedRoot) };
}

function resolveStorageOption(storage?: DryStorageOption): ResolvedStorageOption {
  return resolveFileBackedOption(storage, DEFAULT_STORAGE_ROOT, "storage");
}

function resolveIconsOption(icons?: DryIconsOption): ResolvedIconsOption {
  return resolveFileBackedOption(icons, DEFAULT_ICONS_ROOT, "icons");
}

function resolveComponentsOption(components: DryComponentsOption = {}): ResolvedComponentsOption {
  return {
    storage: resolveFileBackedOption(components.storage, DEFAULT_COMPONENTS_STORAGE_ROOT, "components.storage"),
  };
}

function resolvePageComponentsOption(pageComponents: DryPageComponentsOption = {}): ResolvedPageComponentsOption {
  return {
    storage: resolveFileBackedOption(pageComponents.storage, DEFAULT_PAGE_COMPONENTS_STORAGE_ROOT, "pageComponents.storage"),
  };
}

function resolveContentOption(content: DryContentOption = {}): ResolvedContentOption {
  const legacyBranch = (content as DryContentOption & { branch?: unknown }).branch;
  const engine = content.engine ?? "sqlite";
  if (typeof engine !== "string") {
    throw new TypeError(`[drycms] \`content.engine\` must be a string, received ${typeof engine}.`);
  }
  if (engine !== "sqlite" && engine !== "D1" && engine !== "file") {
    throw new Error(
      `[drycms] \`content.engine: "${engine}"\` is not recognized. Only "sqlite", "D1" and "file" are available today.`,
    );
  }
  // A `binding` only means anything under `engine: "D1"` - silently falling
  // back to local sqlite when it's set without that would turn a config typo
  // into a "why is my data going to the wrong place" bug discovered later,
  // instead of surfacing at config time like every other mistake here does.
  if (engine !== "D1" && content.binding !== undefined) {
    throw new Error(
      '[drycms] `content.binding` is only used with `content.engine: "D1"` - add `engine: "D1"` or remove `binding`.',
    );
  }
  if (engine !== "file" && (content.kind !== undefined || content.root !== undefined || legacyBranch !== undefined)) {
    throw new Error(
      '[drycms] `content.kind`/`content.root`/`content.branch` are only used with `content.engine: "file"` - add `engine: "file"` or remove them.',
    );
  }

  if (engine === "D1") {
    const binding = content.binding;
    if (!binding || typeof binding !== "string") {
      throw new Error(
        '[drycms] `content.engine: "D1"` requires a `content.binding` string naming the D1 binding (matching `wrangler.jsonc`\'s `d1_databases[].binding`).',
      );
    }
    return { engine: "D1", binding };
  }

  if (engine === "file") {
    const storageOption = resolveFileBackedOption(
      { kind: content.kind, root: content.root, branch: legacyBranch },
      DEFAULT_CONTENT_ROOT,
      "content",
    );
    return { engine: "file", ...storageOption };
  }

  const file = content.file ?? DEFAULT_CONTENT_FILE;
  if (typeof file !== "string") {
    throw new TypeError(`[drycms] \`content.file\` must be a string, received ${typeof file}.`);
  }
  return { engine: "sqlite", file: resolvePath(process.cwd(), file) };
}

function resolvePositiveNumber(value: unknown, key: string, fallback: number): number {
  const result = value ?? fallback;
  if (typeof result !== "number" || !Number.isFinite(result) || result <= 0) {
    throw new TypeError(`[drycms] \`${key}\` must be a positive finite number.`);
  }
  return result;
}

function resolveKvOption(option: DryKvOption = {}): ResolvedKvOption {
  const legacyBranch = (option as DryKvOption & { branch?: unknown }).branch;
  if (legacyBranch !== undefined) {
    throw new Error('[drycms] `kv.branch` is no longer supported; use local, SQLite, D1 or Cloudflare KV.');
  }
  const kind = option.kind ?? "local";
  if (typeof kind !== "string" || !["local", "sqlite", "D1", "KV"].includes(kind)) {
    throw new Error(`[drycms] \`kv.kind\` must be one of local, sqlite, D1 or KV.`);
  }
  if (kind === "sqlite") {
    if (option.root !== undefined || option.binding !== undefined) {
      throw new Error('[drycms] `kv.root`/`kv.binding` are not used with `kv.kind: "sqlite"`.');
    }
  }
  if ((kind === "D1" || kind === "KV") && (option.root !== undefined || option.file !== undefined)) {
    throw new Error(`[drycms] \`kv.root\`/\`kv.file\` are not used with \`kv.kind: "${kind}"\`.`);
  }
  if (kind === "local" && (option.file !== undefined || option.binding !== undefined)) {
    throw new Error(`[drycms] \`kv.file\`/\`kv.binding\` are not used with \`kv.kind: "${kind}"\`.`);
  }

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

  if (kind === "sqlite") return { ...tuning, kind, file: resolvePath(process.cwd(), option.file ?? DEFAULT_KV_FILE) };
  if (kind === "D1" || kind === "KV") {
    const binding = option.binding ?? (kind === "KV" ? DEFAULT_KV_BINDING : "KV_DB");
    if (typeof binding !== "string" || !binding.trim()) throw new TypeError(`[drycms] \`kv.binding\` must be a non-empty string.`);
    return { ...tuning, kind, binding };
  }
  const storageOption = resolveFileBackedOption(
    { kind, root: option.root ?? DEFAULT_KV_ROOT },
    DEFAULT_KV_ROOT,
    "kv",
  );
  return { ...tuning, ...storageOption } as ResolvedKvOption;
}

function resolveAiOption(option: DryAiOption = {}): ResolvedAiOption {
  const mode = option.mode ?? "local";
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

  if (mode !== "server") {
    throw new Error('[drycms] `ai.mode` must be `local` or `server`.');
  }
  const provider = option.provider ?? "openai";
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error('[drycms] `ai.provider` must be `openai` or `anthropic` when `ai.mode` is `server`.');
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
 */
export function resolveOptions(options: DryOption = {}): ResolvedDryOption {
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

  return {
    path,
    storage: resolveStorageOption(options.storage),
    icons: resolveIconsOption(options.icons),
    content: resolveContentOption(options.content),
    components: resolveComponentsOption(options.components),
    pageComponents: resolvePageComponentsOption(options.pageComponents),
    ai: resolveAiOption(options.ai),
    kv: resolveKvOption(options.kv),
  };
}
