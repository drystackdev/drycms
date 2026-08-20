import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, readSlug } from "../route-helpers.js";
import { isValidRepoSlug, loadGitConfig } from "../git-config.js";
import { fetchNoRedirect, validateOutboundUrlForRequest } from "../outbound-url.js";
import { GITHUB_URL, gitRemoteUrl, parseGitRemoteUrl, type GitProvider, type GitRepositorySetting } from "../../lib/git-provider.js";

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
const GITHUB_GIT_BASE = GITHUB_URL;
const UPLOAD_PACK = "git-upload-pack";
const RECEIVE_PACK = "git-receive-pack";

const providerName = (provider: GitProvider) => (provider === "gitlab" ? "GitLab" : provider === "github" ? "GitHub" : "The git server");

/**
 * The Basic-auth pair git-over-HTTP wants. The username is meaningless to
 * GitHub/GitLab (both authenticate on the token alone, but each insists on
 * its own placeholder), so the only case where it carries information is a
 * self-hosted host the admin gave a real user name for, in the repository
 * URL's own userinfo (`lib/git-provider.ts`'s `user`).
 */
function gitAuthHeader(config: { provider: GitProvider; user?: string; token: string }): string {
  const user = config.user || (config.provider === "github" ? "x-access-token" : "oauth2");
  return `Basic ${btoa(`${user}:${config.token}`)}`;
}

/** The git smart-HTTP origin for a config: fixed for github.com, the stored
 * (SSRF-validated) origin for everything else - `custom` included, which is
 * exactly why a self-hosted host needs no provider-specific support here. */
async function gitBaseFor(config: { provider: GitProvider; url: string }): Promise<string> {
  if (config.provider === "github") return GITHUB_GIT_BASE;
  return validateOutboundUrlForRequest(config.url, "Git URL");
}

/**
 * `refs/heads/*` out of a v1 `info/refs` advertisement, plus the default
 * branch from the `symref=HEAD:` capability. Deliberately regex over the raw
 * advertisement instead of a pkt-line parser: every ref name is
 * whitespace/NUL-delimited in that format, and this is the ONE thing we want
 * from it - which is also what makes branch listing work identically on
 * GitHub, GitLab and any self-hosted host, with no vendor API involved.
 */
export function parseAdvertisedBranches(advertisement: string): { branches: string[]; defaultBranch: string } {
  const names = new Set<string>();
  for (const match of advertisement.matchAll(/refs\/heads\/([^\s\0]+)/g)) {
    // `refs/heads/x^{}` is a peeled annotated tag entry, never a branch.
    const name = match[1] ?? "";
    if (name && !name.endsWith("^{}")) names.add(name);
  }
  const symref = /symref=HEAD:refs\/heads\/([^\s\0]+)/.exec(advertisement);
  return { branches: [...names].sort((left, right) => left.localeCompare(right)), defaultBranch: symref?.[1] ?? "" };
}

interface RemoteRefsResult {
  status: number;
  advertisement: string;
}

/** One `GET {base}/{repo}.git/info/refs?service=…` against the real remote.
 * Used to list branches (upload-pack) and to prove a token can push
 * (receive-pack) on hosts with no REST API of ours to ask. */
async function fetchRemoteRefs(base: string, repo: string, service: string, auth: string | null): Promise<RemoteRefsResult> {
  const headers = new Headers({ "User-Agent": "git/drycms", Accept: "*/*" });
  if (auth) headers.set("Authorization", auth);
  const response = await fetchNoRedirect(`${base}/${repo}.git/info/refs?service=${service}`, { headers });
  return { status: response.status, advertisement: response.ok ? await response.text() : "" };
}

interface ResolvedRemote {
  setting: GitRepositorySetting;
  /** SSRF-validated git origin - `gitBaseFor` applied to `setting`. */
  base: string;
}

/**
 * The one place a typed repository URL becomes a platform + origin + repo.
 * There is no "Platform" field any more (`pages/GithubSyncSettings.tsx`), so
 * an unknown host is PROBED here rather than guessed: a self-hosted GitLab
 * answers `/api/v4/version` and is upgraded from `custom` to `gitlab`, which
 * is what keeps its REST-only features (snapshot push, content history)
 * working. Anything that doesn't answer stays `custom` and is driven purely
 * over git smart-HTTP.
 */
async function resolveGitRemote(rawUrl: unknown, token: string): Promise<ResolvedRemote | { fieldErrors: Record<string, string> }> {
  const parsed = parseGitRemoteUrl(typeof rawUrl === "string" ? rawUrl : "");
  if (!parsed.ok) return { fieldErrors: { url: parsed.error } };
  let base: string;
  try {
    base = await gitBaseFor(parsed.setting);
  } catch (error) {
    return { fieldErrors: { url: error instanceof Error ? error.message : "This git URL is not reachable." } };
  }
  const setting = { ...parsed.setting };
  if (setting.provider === "custom" && token && (await isGitLabInstance(setting.url, token))) setting.provider = "gitlab";
  return { setting, base };
}

/** A self-hosted GitLab identifies itself on `/api/v4/version`; 401/403 count
 * too (the endpoint exists, this token just can't read it), since all we are
 * deciding is which API dialect the host speaks. */
async function isGitLabInstance(origin: string, token: string): Promise<boolean> {
  try {
    const url = await validateOutboundUrlForRequest(origin, "Git URL");
    const response = await fetchNoRedirect(`${url}/api/v4/version`, { headers: { "PRIVATE-TOKEN": token, Accept: "application/json" } });
    if (response.status === 401 || response.status === 403) return true;
    if (!response.ok) return false;
    const body = await response.json().catch(() => null) as { version?: unknown } | null;
    return typeof body?.version === "string";
  } catch {
    return false;
  }
}

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
  const { repo, branch, token, provider = "github", url = "", user = "" } = loaded.config;
  return jsonResponse({ configured: isValidRepoSlug(repo, provider), provider, url, repo, remoteUrl: gitRemoteUrl({ url, repo, user }), branch, hasToken: token.length > 0 });
}

async function proxy(context: DryRouteContext, method: string): Promise<Response> {
  const loaded = await loadGitConfig(context);
  if ("error" in loaded) return notConfiguredResponse(loaded.error);
  const { repo, token, provider = "github", url = "", user = "" } = loaded.config;
  if (!isValidRepoSlug(repo, provider)) {
    return notConfiguredResponse(`"${repo}" is not a valid "owner/name" repository.`);
  }

  let providerBase: string;
  try {
    providerBase = await gitBaseFor({ provider, url });
  } catch (error) {
    return notConfiguredResponse(error instanceof Error ? error.message : "The git URL is invalid.");
  }
  const target = resolveGitTarget(repo, readSlug(context), method, context.url.searchParams, providerBase);
  if (!target) return jsonResponse({ error: "not_found", message: "Not a git smart-HTTP endpoint." }, 404);

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("User-Agent", "git/drycms");
  if (token) headers.set("Authorization", gitAuthHeader({ provider, user, token }));

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
      { error: "git_upstream_unreachable", message: error instanceof Error ? error.message : `${providerName(provider)} could not be reached.` },
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
        message: `${providerName(provider)} redirected "${repo}" (HTTP ${upstream.status}) - the repository may have been renamed or moved. Update the Git settings.`,
      },
      502,
    );
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return jsonResponse(
      {
        error: "git_unauthorized",
        message: token
          ? `${providerName(provider)} rejected the stored token for "${repo}" (HTTP ${upstream.status}). Check that it is still valid and has push access.`
          : `"${repo}" needs a personal access token. Add one in Git settings.`,
      },
      upstream.status,
    );
  }
  if (upstream.status === 404) {
    return jsonResponse({ error: "git_not_found", message: `${providerName(provider)} has no repository "${repo}" (or the token cannot see it).` }, 404);
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
/**
 * `POST {path}/api/git/validate` - "is this URL + token a repository this
 * server can actually push to?", answered before the setting is saved
 * (`pages/GithubSyncSettings.tsx`). Takes ONE url (no platform, no separate
 * repo field) and reports back the platform it resolved, which is what the
 * page then stores.
 *
 * GitHub/GitLab are checked through their REST APIs because those give a
 * real reason when a token is wrong (missing scope, too low a project role).
 * A self-hosted host with no API of ours to ask is checked the only way that
 * works everywhere: asking git itself for a `git-receive-pack`
 * advertisement, which only succeeds when the credentials may push.
 */
async function validate(context: DryRouteContext): Promise<Response> {
  const body = await context.request.json().catch(() => ({})) as { url?: unknown; token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return jsonResponse({ valid: false, fieldErrors: { token: "An access token is required." } }, 400);

  const resolved = await resolveGitRemote(body.url, token);
  if ("fieldErrors" in resolved) return jsonResponse({ valid: false, fieldErrors: resolved.fieldErrors }, 400);
  const { setting, base } = resolved;
  const { provider, repo } = setting;
  if (!isValidRepoSlug(repo, provider)) {
    return jsonResponse({ valid: false, fieldErrors: { url: provider === "github" ? 'A GitHub URL is "https://github.com/owner/repository".' : "This URL has no repository path." } }, 400);
  }
  const resolvedSetting = { provider, url: setting.url, repo, user: setting.user, remoteUrl: gitRemoteUrl(setting) };

  if (provider === "custom") {
    try {
      const refs = await fetchRemoteRefs(base, repo, RECEIVE_PACK, gitAuthHeader({ provider, user: setting.user, token }));
      if (refs.status === 401 || refs.status === 403) {
        return jsonResponse({ valid: false, fieldErrors: { token: `This git server rejected the token for "${repo}" (HTTP ${refs.status}). It needs push access.` } }, 400);
      }
      if (refs.status === 404) return jsonResponse({ valid: false, fieldErrors: { url: `This git server has no repository "${repo}" (or the token cannot see it).` } }, 400);
      if (refs.status >= 400) return jsonResponse({ valid: false, fieldErrors: { url: `This git server answered HTTP ${refs.status} for "${repo}".` } }, 400);
      return jsonResponse({ valid: true, ...resolvedSetting, ...parseAdvertisedBranches(refs.advertisement) });
    } catch (error) {
      return jsonResponse({ valid: false, fieldErrors: { url: error instanceof Error ? error.message : "This git server could not be reached." } }, 502);
    }
  }

  const apiBase = provider === "gitlab" ? `${base}/api/v4` : "https://api.github.com";
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
        : `${providerName(provider)} rejected this access token.`;
      return jsonResponse({ valid: false, fieldErrors: { token: message } }, 400);
    }
    const repository = await fetch(provider === "gitlab" ? `${apiBase}/projects/${encodeURIComponent(repo)}` : `${apiBase}/repos/${repo}`, { headers, redirect: "manual" });
    if (!repository.ok) return jsonResponse({ valid: false, fieldErrors: { url: "Repository not found or this token cannot access it." } }, 400);
    const value = await repository.json() as { empty_repo?: boolean; default_branch?: string; permissions?: { push?: boolean; project_access?: { access_level?: number }; group_access?: { access_level?: number } } };
    if (provider === "gitlab" && value.empty_repo === true) return jsonResponse({ valid: false, fieldErrors: { url: "Initialize this GitLab repository with a default branch first." } }, 400);
    const gitlabAccessLevel = Math.max(value.permissions?.project_access?.access_level ?? 0, value.permissions?.group_access?.access_level ?? 0);
    const canPush = provider === "gitlab" ? gitlabAccessLevel >= 30 : value.permissions?.push === true;
    if (!canPush) {
      const gitlabRole = ({ 10: "Guest", 15: "Planner", 20: "Reporter", 30: "Developer", 40: "Maintainer", 50: "Owner" } as Record<number, string>)[gitlabAccessLevel] ?? "no project role";
      return jsonResponse({
        valid: false,
        fieldErrors: { token: provider === "gitlab" ? `This GitLab token has the ${gitlabRole} role. Create one with Developer or Maintainer access.` : "This token does not have push access to the repository." },
      }, 400);
    }
    return jsonResponse({ valid: true, ...resolvedSetting, defaultBranch: typeof value.default_branch === "string" ? value.default_branch : "" });
  } catch {
    return jsonResponse({ valid: false, fieldErrors: { token: `${providerName(provider)} could not be reached. Try again.` } }, 502);
  }
}

/**
 * `POST {path}/api/git/branches` - the branch list behind the settings
 * page's Branch combobox, read straight from the remote's `info/refs`
 * advertisement (no vendor API, so github/gitlab/self-hosted all work the
 * same way).
 *
 * The token comes from the request while the admin is typing one. A BLANK
 * token falls back to the stored one, but ONLY when the requested repository
 * is exactly the stored repository - otherwise this endpoint would be a way
 * to make the server hand the saved (write-only) PAT to any host an admin
 * names.
 */
async function branches(context: DryRouteContext): Promise<Response> {
  const body = await context.request.json().catch(() => ({})) as { url?: unknown; token?: unknown };
  let token = typeof body.token === "string" ? body.token.trim() : "";
  const parsed = parseGitRemoteUrl(typeof body.url === "string" ? body.url : "");
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  if (!token) {
    // The saved token, but ONLY for the saved repository - otherwise this
    // endpoint would hand the write-only PAT to any host an admin names.
    // Anything else is attempted anonymously, which is exactly right for a
    // public repository and fails with the host's own 401 otherwise.
    const stored = await loadGitConfig(context);
    const sameRepo = "config" in stored
      && stored.config.repo === parsed.setting.repo
      && (stored.config.url || GITHUB_URL) === parsed.setting.url;
    if (sameRepo && "config" in stored) token = stored.config.token;
  }

  const resolved = await resolveGitRemote(body.url, token);
  if ("fieldErrors" in resolved) return jsonResponse({ error: Object.values(resolved.fieldErrors)[0] ?? "This git URL is not valid." }, 400);
  const { setting, base } = resolved;
  if (!isValidRepoSlug(setting.repo, setting.provider)) return jsonResponse({ error: "This URL has no valid repository path." }, 400);

  try {
    const auth = token ? gitAuthHeader({ provider: setting.provider, user: setting.user, token }) : null;
    const refs = await fetchRemoteRefs(base, setting.repo, UPLOAD_PACK, auth);
    if (refs.status === 401 || refs.status === 403) {
      return jsonResponse({ error: token ? `${providerName(setting.provider)} rejected this access token (HTTP ${refs.status}).` : "This repository is private - add an access token to list its branches." }, 400);
    }
    if (refs.status === 404) return jsonResponse({ error: `No repository "${setting.repo}" is visible to this token.` }, 404);
    if (refs.status >= 400) return jsonResponse({ error: `The git server answered HTTP ${refs.status}.` }, 502);
    return jsonResponse({ provider: setting.provider, ...parseAdvertisedBranches(refs.advertisement) });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "The git server could not be reached." }, 502);
  }
}
export const POST: DryRouteHandler = (context) => {
  const slug = readSlug(context);
  if (slug === "validate") return validate(context);
  if (slug === "branches") return branches(context);
  return proxy(context, "POST");
};
