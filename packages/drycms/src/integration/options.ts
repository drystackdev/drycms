import { resolve as resolvePath } from "node:path";

/** Roadmap kinds not implemented yet - listed so an unsupported `kind` can
 * name what's coming instead of just saying "unknown". */
const PLANNED_STORAGE_KINDS = ["r2", "github", "gitlab", "s3"];

export interface DryStorageOption {
  /**
   * Which backend serves `/dry/api/storage/**`. Only `'local'` is
   * implemented today; the shape is deliberately an open object (not a bare
   * string) so future kinds can carry their own fields (bucket, token, ...)
   * without breaking this type.
   *
   * @default "local"
   */
  kind?: "local";
  /**
   * `local` only: directory files are read from/written to, relative to the
   * consuming project's cwd (or an absolute path).
   *
   * @default "storage"
   */
  root?: string;
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
}

export interface ResolvedLocalStorageOption {
  kind: "local";
  root: string;
}

/** A union so future kinds can be added without widening every existing branch. */
export type ResolvedStorageOption = ResolvedLocalStorageOption;

export interface ResolvedDryOption {
  path: string;
  storage: ResolvedStorageOption;
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

export const DEFAULT_PATH = "/dry";
export const DEFAULT_STORAGE_ROOT = "storage";

function resolveStorageOption(storage: DryStorageOption = {}): ResolvedStorageOption {
  const kind = storage.kind ?? "local";
  if (typeof kind !== "string") {
    throw new TypeError(
      `[drycms] \`storage.kind\` must be a string, received ${typeof kind}.`,
    );
  }
  if (kind !== "local") {
    const roadmap = PLANNED_STORAGE_KINDS.includes(kind)
      ? ` \`storage.kind: "${kind}"\` is on the roadmap but not implemented yet.`
      : ` "${kind}" is not a recognized storage kind.`;
    throw new Error(
      `[drycms]${roadmap} Only "local" is available today (planned: ${PLANNED_STORAGE_KINDS.join(", ")}).`,
    );
  }

  const root = storage.root ?? DEFAULT_STORAGE_ROOT;
  if (typeof root !== "string") {
    throw new TypeError(
      `[drycms] \`storage.root\` must be a string, received ${typeof root}.`,
    );
  }

  return { kind: "local", root: resolvePath(process.cwd(), root) };
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
  };
}
