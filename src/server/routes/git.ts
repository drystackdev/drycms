import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, readSlug } from "../route-helpers.js";
import { isValidRepoSlug, loadGitConfig } from "../git-config.js";
import { validateOutboundUrlForRequest } from "../outbound-url.js";

/**
 * Git smart-HTTP proxy - the one thing that makes a real git working copy
 * possible in the browser (`page-components/git/`, `status/git-page-source.md`).
 *
 * Why it has to exist: github.com's git endpoints send no CORS headers, so a
 * browser can never talk to them directly; isomorphic-git's usual answer is a
 * third-party CORS proxy (`cors.isomorphic-git.org`). This is that proxy,
 * same-origin and owned by us, which also makes it the right place to inject
 * the PAT - the browser never sees the token, and the repo it talks to is
 * fixed by THIS server's config rather than anything the client sends.
 *
 * Hard rules, all enforced below:
 * - Exactly three upstream paths are reachable (`info/refs` for either
 *   service, `git-upload-pack`, `git-receive-pack`). Nothing else about
 *   github.com is proxyable through here.
 * - `repo` comes from the `githubSync` singleton, never from the request -
 *   the client cannot name a host, a path, or another repo (SSRF).
 * - The admin's cookies never leave this origin, and the upstream's
 *   `Set-Cookie`/`WWW-Authenticate` never come back.
 * - Bodies stream both ways. A pack can be tens of MiB and neither runtime
 *   should hold one in memory (`request-limits.ts`'s `git` branch raises the
 *   generic 2 MiB JSON cap for exactly this route, and its wrapper already
 *   hands us a `duplex: "half"` stream).
 *
 * Gated in `handler.ts` on `PAGE_BUILDER_RESOURCE_ID`, same as
 * `pages-source` - a git clone through here IS a read of that same
 * executable tenant source. `git-upload-pack` (read/clone) also admits a
 * role with no code-edit grant but real content permissions on at least one
 * type (`isGitReadRequest` below, `permissions.ts`'s `isVeiEditableType`) -
 * it needs to read page source to render a VEI preview, even though it can
 * never write any. `git-receive-pack` (push) stays exclusively behind the
 * code-edit permission, no exception.
 */
const GITHUB_GIT_BASE = "https://github.com";
const UPLOAD_PACK = "git-upload-pack";
const RECEIVE_PACK = "git-receive-pack";

/** Headers worth forwarding upstream. Everything else (Cookie above all) is
 * dropped rather than filtered, so a new client header can never leak by
 * default. */
const FORWARD_REQUEST_HEADERS = ["accept", "content-type", "git-protocol", "accept-encoding"];
/** `content-encoding`/`content-length` are deliberately NOT copied back: the
 * runtime's own fetch already decoded the body we are re-streaming, so
 * echoing them would describe bytes that no longer exist and corrupt the
 * response git reads. */
const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control"];

interface ResolvedTarget {
  url: string;
  /** `git-upload-pack` = read (clone/fetch), `git-receive-pack` = write
   * (push). Kept even though both are allowed, so a future "read-only
   * viewer" role has one obvious place to branch on. */
  service: typeof UPLOAD_PACK | typeof RECEIVE_PACK;
}

/** Whether this request only needs read (clone/fetch, `git-upload-pack`)
 * access, as opposed to `git-receive-pack` (push) which always needs the
 * full code-edit permission - `handler.ts`'s gate calls this to decide
 * whether a content-only role's `hasAnyVeiAccess` fallback applies, without
 * needing a resolved repo/provider (unlike `resolveGitTarget` below, this
 * never touches `loadGitConfig` or github.com). Mirrors that function's own
 * method/slug/service matching. */
export function isGitReadRequest(method: string, slug: string | undefined, search: URLSearchParams): boolean {
  if (method === "GET" && slug === "info/refs") return search.get("service") === UPLOAD_PACK;
  return method === "POST" && slug === UPLOAD_PACK;
}

/**
 * The allowlist. `slug` is whatever followed `{path}/api/git/`; the query
 * string is re-built from scratch rather than forwarded, so nothing but
 * `service` can ever reach github.com.
 */
export function resolveGitTarget(repo: string, slug: string, method: string, search: URLSearchParams, providerBase = GITHUB_GIT_BASE): ResolvedTarget | null {
  const base = `${providerBase}/${repo}.git`;
  if (method === "GET" && slug === "info/refs") {
    const service = search.get("service");
    if (service !== UPLOAD_PACK && service !== RECEIVE_PACK) return null;
    return { url: `${base}/info/refs?service=${service}`, service };
  }
  if (method === "POST" && (slug === UPLOAD_PACK || slug === RECEIVE_PACK)) {
    return { url: `${base}/${slug}`, service: slug };
  }
  return null;
}

function notConfiguredResponse(reason: string): Response {
  return jsonResponse(
    {
      error: "git_not_configured",
      message:
        reason === "not-configured"
          ? "Connect a GitHub repository first: Settings -> GitHub (repository, branch and a personal access token)."
          : reason,
    },
    412,
  );
}

/**
 * `GET {path}/api/git/config` - what the browser needs before it can clone:
 * which branch, and whether a repository is connected at all. Deliberately
 * reports only whether a token EXISTS, never any part of it - the token's
 * whole point is that it stays on this side.
 */
async function configResponse(context: DryRouteContext): Promise<Response> {
  const loaded = await loadGitConfig(context);
  if ("error" in loaded) return jsonResponse({ configured: false, repo: "", branch: "", hasToken: false });
  const { repo, branch, token, provider = "github", url = "" } = loaded.config;
  return jsonResponse({ configured: isValidRepoSlug(repo, provider), provider, url, repo, branch, hasToken: token.length > 0 });
}

async function proxy(context: DryRouteContext, method: string): Promise<Response> {
  const loaded = await loadGitConfig(context);
  if ("error" in loaded) return notConfiguredResponse(loaded.error);
  const { repo, token, provider = "github", url = "" } = loaded.config;
  if (!isValidRepoSlug(repo, provider)) {
    return notConfiguredResponse(`"${repo}" is not a valid "owner/name" repository.`);
  }

  let providerBase = GITHUB_GIT_BASE;
  try {
    if (provider === "gitlab") providerBase = await validateOutboundUrlForRequest(url, "GitLab URL");
  } catch (error) {
    return notConfiguredResponse(error instanceof Error ? error.message : "The GitLab URL is invalid.");
  }
  const target = resolveGitTarget(repo, readSlug(context), method, context.url.searchParams, providerBase);
  if (!target) return jsonResponse({ error: "not_found", message: "Not a git smart-HTTP endpoint." }, 404);

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("User-Agent", "git/drycms");
  if (token) headers.set("Authorization", `Basic ${btoa(`${provider === "gitlab" ? "oauth2" : "x-access-token"}:${token}`)}`);

  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method,
      headers,
      body: method === "POST" ? context.request.body : undefined,
      // Node needs this to send a streaming request body at all; workerd
      // accepts and ignores it.
      ...(method === "POST" ? ({ duplex: "half" } as RequestInit) : {}),
      redirect: "manual",
    });
  } catch (error) {
    return jsonResponse(
      { error: "git_upstream_unreachable", message: error instanceof Error ? error.message : `${provider === "gitlab" ? "GitLab" : "GitHub"} could not be reached.` },
      502,
    );
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    // Never follow it: the redirect target is chosen by the upstream, not by
    // our own validated config. In practice this means the repo was renamed,
    // moved, or is a redirect to a login page.
    return jsonResponse(
      {
        error: "git_redirected",
        message: `${provider === "gitlab" ? "GitLab" : "GitHub"} redirected "${repo}" (HTTP ${upstream.status}) - the repository may have been renamed or moved. Update the Git settings.`,
      },
      502,
    );
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return jsonResponse(
      {
        error: "git_unauthorized",
        message: token
          ? `${provider === "gitlab" ? "GitLab" : "GitHub"} rejected the stored token for "${repo}" (HTTP ${upstream.status}). Check that it is still valid and has push access.`
          : `"${repo}" needs a personal access token. Add one in Git settings.`,
      },
      upstream.status,
    );
  }
  if (upstream.status === 404) {
    return jsonResponse({ error: "git_not_found", message: `${provider === "gitlab" ? "GitLab" : "GitHub"} has no repository "${repo}" (or the token cannot see it).` }, 404);
  }

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "private, no-store");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET: DryRouteHandler = (context) =>
  readSlug(context) === "config" ? configResponse(context) : proxy(context, "GET");
async function validate(context: DryRouteContext): Promise<Response> {
  const body = await context.request.json().catch(() => ({})) as { provider?: unknown; url?: unknown; repo?: unknown; token?: unknown };
  const provider = body.provider === "gitlab" ? "gitlab" : "github";
  const providerName = provider === "gitlab" ? "GitLab" : "GitHub";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const fieldErrors: Record<string, string> = {};
  if (!isValidRepoSlug(repo, provider)) fieldErrors.repo = provider === "gitlab" ? 'Use the "group/repository" format.' : 'Use the "owner/repository" format.';
  if (!token) fieldErrors.token = "An access token is required.";
  if (Object.keys(fieldErrors).length) return jsonResponse({ valid: false, fieldErrors }, 400);
  let apiBase = "https://api.github.com";
  try {
    if (provider === "gitlab") apiBase = `${await validateOutboundUrlForRequest(typeof body.url === "string" ? body.url : "", "GitLab URL")}/api/v4`;
  } catch (error) {
    return jsonResponse({ valid: false, fieldErrors: { url: error instanceof Error ? error.message : "GitLab URL is invalid." } }, 400);
  }
  const headers = new Headers({ Accept: provider === "gitlab" ? "application/json" : "application/vnd.github+json", "User-Agent": "drycms" });
  if (provider === "gitlab") headers.set("PRIVATE-TOKEN", token);
  else {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-GitHub-Api-Version", "2022-11-28");
  }
  try {
    const user = await fetch(`${apiBase}/user`, { headers, redirect: "manual" });
    if (!user.ok) {
      const error = await user.json().catch(() => ({})) as { error?: string };
      const message = provider === "gitlab" && user.status === 403 && error.error === "insufficient_scope"
        ? "This GitLab token requires the api scope."
        : `${providerName} rejected this access token.`;
      return jsonResponse({ valid: false, fieldErrors: { token: message } }, 400);
    }
    const repository = await fetch(provider === "gitlab" ? `${apiBase}/projects/${encodeURIComponent(repo)}` : `${apiBase}/repos/${repo}`, { headers, redirect: "manual" });
    if (!repository.ok) return jsonResponse({ valid: false, fieldErrors: { repo: "Repository not found or this token cannot access it." } }, 400);
    const value = await repository.json() as { empty_repo?: boolean; permissions?: { push?: boolean; project_access?: { access_level?: number }; group_access?: { access_level?: number } } };
    if (provider === "gitlab" && value.empty_repo === true) return jsonResponse({ valid: false, fieldErrors: { repo: "Initialize this GitLab repository with a default branch first." } }, 400);
    const gitlabAccessLevel = Math.max(value.permissions?.project_access?.access_level ?? 0, value.permissions?.group_access?.access_level ?? 0);
    const canPush = provider === "gitlab" ? gitlabAccessLevel >= 30 : value.permissions?.push === true;
    if (!canPush) {
      const gitlabRole = ({ 10: "Guest", 15: "Planner", 20: "Reporter", 30: "Developer", 40: "Maintainer", 50: "Owner" } as Record<number, string>)[gitlabAccessLevel] ?? "no project role";
      return jsonResponse({
        valid: false,
        fieldErrors: { token: provider === "gitlab" ? `This GitLab token has the ${gitlabRole} role. Create one with Developer or Maintainer access.` : "This token does not have push access to the repository." },
      }, 400);
    }
    return jsonResponse({ valid: true });
  } catch {
    return jsonResponse({ valid: false, fieldErrors: { token: `${providerName} could not be reached. Try again.` } }, 502);
  }
}
export const POST: DryRouteHandler = (context) => readSlug(context) === "validate" ? validate(context) : proxy(context, "POST");
