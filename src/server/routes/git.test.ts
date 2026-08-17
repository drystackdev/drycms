import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGitTarget } from "./git.js";

describe("resolveGitTarget", () => {
  const repo = "acme/site";

  it("allows both info/refs services and rebuilds the query from scratch", () => {
    for (const service of ["git-upload-pack", "git-receive-pack"]) {
      const target = resolveGitTarget(repo, "info/refs", "GET", new URLSearchParams({ service, evil: "1" }));
      expect(target).toEqual({ url: `https://github.com/acme/site.git/info/refs?service=${service}`, service });
    }
  });

  it("allows the two pack POSTs", () => {
    expect(resolveGitTarget(repo, "git-upload-pack", "POST", new URLSearchParams())?.url).toBe(
      "https://github.com/acme/site.git/git-upload-pack",
    );
    expect(resolveGitTarget(repo, "git-receive-pack", "POST", new URLSearchParams())?.url).toBe(
      "https://github.com/acme/site.git/git-receive-pack",
    );
  });

  it("rejects everything else: unknown paths, wrong method, missing/unknown service", () => {
    expect(resolveGitTarget(repo, "info/refs", "GET", new URLSearchParams())).toBeNull();
    expect(resolveGitTarget(repo, "info/refs", "GET", new URLSearchParams({ service: "git-shell" }))).toBeNull();
    // A read endpoint may not be reached with POST, nor a pack with GET.
    expect(resolveGitTarget(repo, "info/refs", "POST", new URLSearchParams({ service: "git-upload-pack" }))).toBeNull();
    expect(resolveGitTarget(repo, "git-upload-pack", "GET", new URLSearchParams())).toBeNull();
    // Nothing else about github.com is proxyable - including the REST API,
    // raw content, or a traversal back out of the repo.
    expect(resolveGitTarget(repo, "objects/info/packs", "GET", new URLSearchParams())).toBeNull();
    expect(resolveGitTarget(repo, "", "GET", new URLSearchParams())).toBeNull();
    expect(resolveGitTarget(repo, "../../user", "GET", new URLSearchParams())).toBeNull();
  });
});

/** The route module reads `git-config.ts` and the global `fetch`; both are
 * mocked so these exercise the proxy's own decisions, never the network. */
const configBox = vi.hoisted(() => ({ result: {} as unknown }));
vi.mock("../git-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git-config.js")>();
  return { ...actual, loadGitConfig: async () => configBox.result };
});

const { GET, POST } = await import("./git.js");

function context(url: string, init: RequestInit = {}, slug = "info/refs") {
  const request = new Request(url, init);
  return { request, url: new URL(url), params: { slug }, env: {}, session: { id: 1, name: "A", email: "a@b.c" } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("git proxy route", () => {
  it("412s with an actionable message when no repository is connected", async () => {
    configBox.result = { error: "not-configured" };
    const response = await GET(context("https://site.test/dry/api/git/info/refs?service=git-upload-pack"));
    expect(response.status).toBe(412);
    expect((await response.json()).message).toContain("Settings -> GitHub");
  });

  it("refuses a repo value that is not owner/name", async () => {
    configBox.result = { config: { repo: "https://evil.test/x", branch: "main", token: "" } };
    const response = await GET(context("https://site.test/dry/api/git/info/refs?service=git-upload-pack"));
    expect(response.status).toBe(412);
  });

  it("404s a path outside the three git endpoints without calling GitHub", async () => {
    configBox.result = { config: { repo: "acme/site", branch: "main", token: "t" } };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(context("https://site.test/dry/api/git/user", {}, "user"));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the PAT as HTTP Basic, drops the admin's cookies, and never echoes content-encoding", async () => {
    configBox.result = { config: { repo: "acme/site", branch: "main", token: "ghp_secret" } };
    const fetchMock = vi.fn(async () =>
      new Response("0000", {
        status: 200,
        headers: {
          "Content-Type": "application/x-git-upload-pack-advertisement",
          "Content-Encoding": "gzip",
          "Set-Cookie": "upstream=1",
          "WWW-Authenticate": "Basic realm=github",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      context("https://site.test/dry/api/git/info/refs?service=git-upload-pack", {
        headers: { Cookie: "drycms_session=abc", Accept: "*/*" },
      }),
    );

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://github.com/acme/site.git/info/refs?service=git-upload-pack");
    const sent = new Headers((init as RequestInit).headers);
    expect(sent.get("Authorization")).toBe(`Basic ${btoa("x-access-token:ghp_secret")}`);
    expect(sent.get("Cookie")).toBeNull();
    expect(sent.get("Accept")).toBe("*/*");
    // A decoded body must not be described as still-encoded, and nothing the
    // upstream sets about identity comes back to the browser.
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("0000");
  });

  it("omits Authorization entirely when no token is stored (public repo, read-only)", async () => {
    configBox.result = { config: { repo: "acme/site", branch: "main", token: "" } };
    const fetchMock = vi.fn(async () => new Response("0000", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await GET(context("https://site.test/dry/api/git/info/refs?service=git-upload-pack"));
    expect(new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers).get("Authorization")).toBeNull();
  });

  it("turns an upstream redirect into a repository-moved error rather than following it", async () => {
    configBox.result = { config: { repo: "acme/site", branch: "main", token: "t" } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 301, headers: { Location: "https://evil.test/" } })));
    const response = await GET(context("https://site.test/dry/api/git/info/refs?service=git-upload-pack"));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toContain("renamed or moved");
  });

  it("explains a 401 differently depending on whether a token was stored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    configBox.result = { config: { repo: "acme/site", branch: "main", token: "t" } };
    const withToken = await POST(context("https://site.test/dry/api/git/git-receive-pack", { method: "POST" }, "git-receive-pack"));
    expect(withToken.status).toBe(401);
    expect((await withToken.json()).message).toContain("stored token");

    configBox.result = { config: { repo: "acme/site", branch: "main", token: "" } };
    const withoutToken = await POST(context("https://site.test/dry/api/git/git-receive-pack", { method: "POST" }, "git-receive-pack"));
    expect((await withoutToken.json()).message).toContain("needs a personal access token");
  });

  it("GET config reports the branch and whether a token exists, never the token", async () => {
    configBox.result = { config: { repo: "acme/site", branch: "release", token: "ghp_secret" } };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(context("https://site.test/dry/api/git/config", {}, "config"));
    const body = await response.json();
    expect(body).toEqual({ configured: true, repo: "acme/site", branch: "release", hasToken: true });
    expect(JSON.stringify(body)).not.toContain("ghp_secret");
    // Purely local - config must never cost a GitHub round trip.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET config reports unconfigured (rather than 412) so the client can show a setup state", async () => {
    configBox.result = { error: "not-configured" };
    const response = await GET(context("https://site.test/dry/api/git/config", {}, "config"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, repo: "", branch: "", hasToken: false });
  });

  it("reports an unreachable upstream as 502 instead of throwing", async () => {
    configBox.result = { config: { repo: "acme/site", branch: "main", token: "t" } };
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const response = await GET(context("https://site.test/dry/api/git/info/refs?service=git-upload-pack"));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toContain("network down");
  });
});
