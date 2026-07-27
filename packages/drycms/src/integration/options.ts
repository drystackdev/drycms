import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/** Roadmap kinds not implemented yet - listed so an unsupported `kind` can
 * name what's coming instead of just saying "unknown". */
const PLANNED_STORAGE_KINDS = ["r2", "s3"];

export interface DryStorageOption {
  /**
   * Which backend serves `/dry/api/storage/**`. `'github'`/`'gitlab'` read
   * their repo/branch/token from env vars (`GITHUB_REPO`/`GITHUB_PAT_KEY`/
   * `GITHUB_BRANCH` or `GITLAB_PROJECT`/`GITLAB_PAT_KEY`/`GITLAB_BRANCH`/
   * `GITLAB_HOST`) rather than this object, so no secret ends up in a
   * committed `astro.config.mjs`.
   *
   * @default "local"
   */
  kind?: "local" | "github" | "gitlab";
  /**
   * `local`: directory files are read from/written to, relative to the
   * consuming project's cwd (or an absolute path). `github`: subpath within
   * the repo files live under (repo root if omitted).
   *
   * @default "storage"
   */
  root?: string;
}

export interface DryContentOption {
  /**
   * Which backend the Content-Type Builder generates/migrates tables into.
   * `"file"` (GitHub/GitLab-backed) is on the roadmap but not implemented
   * yet - there's no notion of a SQL column to add/drop there.
   *
   * @default "sqlite"
   */
  engine?: "sqlite" | "D1";
  /**
   * `sqlite` only: path to the database file, relative to the consuming
   * project's cwd (or an absolute path).
   *
   * @default "content.sqlite"
   */
  file?: string;
  /**
   * `D1` only: the binding name configured in `wrangler.jsonc`'s
   * `d1_databases[].binding` (e.g. `"CONTENT_DB"`) - required for
   * `engine: "D1"`. The live `D1Database` itself is looked up per-request
   * from `context.locals.runtime.env`, not from this option (it isn't a
   * JSON-serializable value, unlike every other resolved option).
   */
  binding?: string;
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
  content?: DryContentOption;
}

export interface ResolvedLocalStorageOption {
  kind: "local";
  root: string;
}

export interface ResolvedGithubStorageOption {
  kind: "github";
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** Subpath within the repo files live under. `""` = repo root. */
  root: string;
}

export interface ResolvedGitlabStorageOption {
  kind: "gitlab";
  /** API/instance base, e.g. `"https://gitlab.com"` - configurable (unlike
   * the GitHub adapter's hardcoded `api.github.com`) since self-managed
   * GitLab is common. No trailing slash. */
  host: string;
  /** Numeric project ID or URL-encoded-at-request-time `"namespace/project"`
   * path - GitLab accepts either as the `:id` in `/projects/:id/...`. */
  project: string;
  branch: string;
  token: string;
  /** Subpath within the repo files live under. `""` = repo root. */
  root: string;
}

/** A union so future kinds can be added without widening every existing branch. */
export type ResolvedStorageOption =
  | ResolvedLocalStorageOption
  | ResolvedGithubStorageOption
  | ResolvedGitlabStorageOption;

export interface ResolvedSqliteContentOption {
  engine: "sqlite";
  file: string;
}

export interface ResolvedD1ContentOption {
  engine: "D1";
  binding: string;
}

/** A union so a future `"file"` engine can be added without widening every
 * existing branch. */
export type ResolvedContentOption = ResolvedSqliteContentOption | ResolvedD1ContentOption;

export interface ResolvedDryOption {
  path: string;
  storage: ResolvedStorageOption;
  content: ResolvedContentOption;
}

/**
 * The single Astro entrypoint injected by the integration. It only mounts the
 * Preact app - every actual route (dashboard, showcase, ...) is handled
 * client-side by `preact-iso`, not by Astro.
 */
export const APP_ENTRYPOINT = "drycms/app.astro";

/**
 * The Astro API endpoint injected alongside `APP_ENTRYPOINT`, serving
 * `${path}/api/storage/**`. Unlike the components under `components/`/`pages/`,
 * this is a plain `.ts` route file - never compiled, resolved the same way
 * `app.astro` is (see the `"./routes/*"` entry in `package.json`'s `exports`).
 */
export const STORAGE_ROUTE_ENTRYPOINT = "drycms/routes/storage.ts";

/**
 * The Astro API endpoint backing the Content-Type Builder, serving
 * `${path}/api/content-types/**`.
 */
export const CONTENT_ROUTE_ENTRYPOINT = "drycms/routes/content-types.ts";

/**
 * The Astro API endpoint backing content-*entry* CRUD (list/get/create/
 * update/delete rows of a collection/singleton), serving `${path}/api/content/**`.
 * Distinct from `CONTENT_ROUTE_ENTRYPOINT`, which is schema-definition only.
 */
export const CONTENT_ENTRIES_ROUTE_ENTRYPOINT = "drycms/routes/content-entries.ts";

export const DEFAULT_PATH = "/dry";
export const DEFAULT_STORAGE_ROOT = "storage";
export const DEFAULT_CONTENT_FILE = "content.sqlite";

let dotEnvCache: Record<string, string> | undefined;

/**
 * `astro.config.mjs` is evaluated before any of `.env`'s vars are
 * guaranteed to be in `process.env` - Astro's own env loader (`loadEnv`)
 * only feeds `import.meta.env`/`astro:env` for *application* code, not
 * `process.env`, and depending on how `astro dev` gets launched (`bunx`,
 * a plain `node`, a package.json script shelling out), the wrapping
 * runtime's own `.env` auto-load may not have run yet either - reproduced
 * directly: `bun run <script that shells out to node>` does NOT forward
 * Bun's auto-loaded `.env` vars to that child process. A tiny parser here,
 * consulted only when the real environment doesn't already have the var,
 * makes config-time resolution work regardless of invocation method.
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
  return process.env[name] || readDotEnv()[name];
}

/**
 * `github`'s owner/repo/branch/token come from env vars, not this object -
 * they're deployment secrets/specifics, not something that belongs in a
 * committed `astro.config.mjs`.
 */
function resolveGithubStorageOption(root: string): ResolvedGithubStorageOption {
  const repoEnv = readEnvVar("GITHUB_REPO");
  if (!repoEnv) {
    throw new Error(
      '[drycms] `storage.kind: "github"` requires a `GITHUB_REPO` env var shaped "owner/repo".',
    );
  }
  const slash = repoEnv.indexOf("/");
  if (slash <= 0 || slash === repoEnv.length - 1) {
    throw new Error(
      `[drycms] \`GITHUB_REPO\` must be shaped "owner/repo", received "${repoEnv}".`,
    );
  }

  const token = readEnvVar("GITHUB_PAT_KEY");
  if (!token) {
    throw new Error(
      '[drycms] `storage.kind: "github"` requires a `GITHUB_PAT_KEY` env var (a GitHub personal access token).',
    );
  }

  return {
    kind: "github",
    owner: repoEnv.slice(0, slash),
    repo: repoEnv.slice(slash + 1),
    branch: readEnvVar("GITHUB_BRANCH") || "main",
    token,
    root,
  };
}

/**
 * `gitlab`'s host/project/branch/token come from env vars, not this object -
 * same rationale as `resolveGithubStorageOption`.
 */
function resolveGitlabStorageOption(root: string): ResolvedGitlabStorageOption {
  const project = readEnvVar("GITLAB_PROJECT");
  if (!project) {
    throw new Error(
      '[drycms] `storage.kind: "gitlab"` requires a `GITLAB_PROJECT` env var (a numeric project ID or a "namespace/project" path).',
    );
  }

  const token = readEnvVar("GITLAB_PAT_KEY");
  if (!token) {
    throw new Error(
      '[drycms] `storage.kind: "gitlab"` requires a `GITLAB_PAT_KEY` env var (a GitLab personal access token).',
    );
  }

  const host = (readEnvVar("GITLAB_HOST") || "https://gitlab.com").replace(/\/+$/, "");

  return {
    kind: "gitlab",
    host,
    project,
    branch: readEnvVar("GITLAB_BRANCH") || "main",
    token,
    root,
  };
}

function resolveStorageOption(storage: DryStorageOption = {}): ResolvedStorageOption {
  const kind = storage.kind ?? "local";
  if (typeof kind !== "string") {
    throw new TypeError(
      `[drycms] \`storage.kind\` must be a string, received ${typeof kind}.`,
    );
  }
  if (kind !== "local" && kind !== "github" && kind !== "gitlab") {
    const roadmap = PLANNED_STORAGE_KINDS.includes(kind)
      ? ` \`storage.kind: "${kind}"\` is on the roadmap but not implemented yet.`
      : ` "${kind}" is not a recognized storage kind.`;
    throw new Error(
      `[drycms]${roadmap} Only "local", "github" and "gitlab" are available today (planned: ${PLANNED_STORAGE_KINDS.join(", ")}).`,
    );
  }

  const root = storage.root ?? DEFAULT_STORAGE_ROOT;
  if (typeof root !== "string") {
    throw new TypeError(
      `[drycms] \`storage.root\` must be a string, received ${typeof root}.`,
    );
  }
  // `local` normalizes trailing slashes away via `resolvePath` - github/gitlab
  // don't go through that, so a config'd trailing slash would otherwise make
  // their `stripRoot`'s `${root}/` prefix check never match a real path.
  const normalizedRoot = root.replace(/\/+$/, "");

  if (kind === "github") return resolveGithubStorageOption(normalizedRoot);
  if (kind === "gitlab") return resolveGitlabStorageOption(normalizedRoot);

  return { kind: "local", root: resolvePath(process.cwd(), normalizedRoot) };
}

function resolveContentOption(content: DryContentOption = {}): ResolvedContentOption {
  const engine = content.engine ?? "sqlite";
  if (typeof engine !== "string") {
    throw new TypeError(`[drycms] \`content.engine\` must be a string, received ${typeof engine}.`);
  }
  if (engine !== "sqlite" && engine !== "D1") {
    throw new Error(
      `[drycms] \`content.engine: "${engine}"\` is not recognized. Only "sqlite" and "D1" are available today ("file" is on the roadmap).`,
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

  if (engine === "D1") {
    const binding = content.binding;
    if (!binding || typeof binding !== "string") {
      throw new Error(
        '[drycms] `content.engine: "D1"` requires a `content.binding` string naming the D1 binding (matching `wrangler.jsonc`\'s `d1_databases[].binding`).',
      );
    }
    return { engine: "D1", binding };
  }

  const file = content.file ?? DEFAULT_CONTENT_FILE;
  if (typeof file !== "string") {
    throw new TypeError(`[drycms] \`content.file\` must be a string, received ${typeof file}.`);
  }
  return { engine: "sqlite", file: resolvePath(process.cwd(), file) };
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
    content: resolveContentOption(options.content),
  };
}
