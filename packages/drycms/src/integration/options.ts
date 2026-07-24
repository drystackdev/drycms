export interface DryOption {
  /**
   * Base path the drycms admin UI is mounted on.
   * Visiting it redirects to `${path}/dashboard`.
   *
   * @default "/dry"
   */
  path?: string;
}

export interface ResolvedDryOption {
  path: string;
}

/**
 * The single Astro entrypoint injected by the integration. It only mounts the
 * Preact app - every actual route (dashboard, showcase, ...) is handled
 * client-side by `preact-iso`, not by Astro.
 */
export const APP_ENTRYPOINT = "drycms/app.astro";

export const DEFAULT_PATH = "/dry";

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
  };
}
