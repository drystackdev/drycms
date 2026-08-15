import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-pages-build-route-"));
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    pagesCacheStorage: { kind: "local", root: join(tempDirBox.path, "pages-cache") },
  };
});

const { GET, POST, DELETE } = await import("./pages-build.js");
const { createPagesRegistryAdapter, createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");
const { PAGE_BUILDER_RESOURCE_ID, permissionKeyFor } = await import("../../content-types/permissions.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

/** Every pre-existing test in this file assumes "this succeeds" - now that
 * `pages-build` is permission-checked per resource (see
 * `content-types/access.ts`), that assumption only holds for a Super Admin
 * or the code-edit permission, same seeding pattern
 * `content-entries.test.ts`/`dry-http.test.ts` already use. */
let superAdminSession: SessionPayload;
/** Only `view` on the `role` collection - exercises the new
 * "code + content = page" grant: can (re)publish a page whose recorded
 * deps are entirely within `role`, nothing else. */
let roleViewerSession: SessionPayload;
/** Only the code-edit permission - equivalent to the old, sole
 * `PAGE_BUILDER_RESOURCE_ID` gate: can publish ANY page regardless of its
 * recorded deps, including a page that's never been built before. */
let codePermissionSession: SessionPayload;

beforeAll(async () => {
  const schema = createContentEngineAdapter(content);
  const entries = createContentEntryEngineAdapter(content);
  const allTypes = await schema.listContentTypes();
  const userType = allTypes.find((t) => t.name === "user")!;
  const roleType = allTypes.find((t) => t.name === "role")!;

  async function makeSession(email: string, roleValue: Record<string, unknown>): Promise<SessionPayload> {
    const role = await entries.createEntry(roleType, allTypes, { name: email, description: "", isSuperAdmin: false, permissions: [], ...roleValue });
    const user = await entries.createEntry(userType, allTypes, {
      name: email,
      email,
      password: { hasExisting: false, new: "hunter2" },
      roles: [role.id],
    });
    return { id: user.id, name: email, email };
  }

  superAdminSession = await makeSession("pages-build-super-admin@example.com", { isSuperAdmin: true });
  roleViewerSession = await makeSession("pages-build-role-viewer@example.com", {
    permissions: [permissionKeyFor(roleType.id, "view")],
  });
  codePermissionSession = await makeSession("pages-build-code-permission@example.com", {
    permissions: [permissionKeyFor(PAGE_BUILDER_RESOURCE_ID, "setting")],
  });
});

function context(query: Record<string, string> = {}, session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/pages-build");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { params: {}, request: new Request(url), url, env: {}, session };
}

function deleteContext(pathname: string, session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/pages-build");
  url.searchParams.set("path", pathname);
  const request = new Request(url, { method: "DELETE" });
  return { params: {}, request, url, env: {}, session };
}

function postContext(body: unknown, session: SessionPayload | null = superAdminSession): DryRouteContext {
  const url = new URL("http://localhost/dry/api/pages-build");
  const request = new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { params: {}, request, url, env: {}, session };
}

function onePage(pathname: string, deps: { resource: string; version: number }[] = [], sourceHash: string | null = null) {
  return {
    pathname,
    entryPath: `pages${pathname === "/" ? "" : pathname}/page.tsx`,
    html: `<html><body>${pathname}</body></html>`,
    jsAssets: [{ jsPath: `${pathname.replace(/^\//, "") || "index"}.js`, source: "export default function(){}" }],
    buildId: crypto.randomUUID(),
    deps,
    inSitemap: true,
    sourceHash,
  };
}

describe("GET /dry/api/pages-build?byResource=", () => {
  it("returns an empty list when nothing depends on the resource", async () => {
    const response = await GET(context({ byResource: "nothing-reads-this" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paths: [] });
  });

  it("returns every path recorded as depending on the resource", async () => {
    const registry = createPagesRegistryAdapter(content);
    await registry.recordBuild(
      { path: "/blogs/hello-world", objectKey: "pages/x/blogs/hello-world.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "blog", version: 1 }],
    );
    await registry.recordBuild(
      { path: "/", objectKey: "pages/x/index.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "blog", version: 1 }, { resource: "homepage", version: 1 }],
    );
    await registry.recordBuild(
      { path: "/about", objectKey: "pages/x/about.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "aboutPage", version: 1 }],
    );

    const response = await GET(context({ byResource: "blog" }));
    const body = (await response.json()) as { paths: string[] };
    expect(new Set(body.paths)).toEqual(new Set(["/blogs/hello-world", "/"]));
  });

  it("unions and deduplicates across a comma-separated resource list", async () => {
    const response = await GET(context({ byResource: "homepage,aboutPage" }));
    const body = (await response.json()) as { paths: string[] };
    expect(new Set(body.paths)).toEqual(new Set(["/", "/about"]));
  });
});

describe("POST /dry/api/pages-build { pages: [...] } (batch)", () => {
  it("publishes every page in one call and each is readable back individually", async () => {
    const response = await POST(postContext({ pages: [onePage("/batch-a"), onePage("/batch-b"), onePage("/batch-c")] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { records: { path: string }[]; errors: unknown[] };
    expect(body.errors).toEqual([]);
    expect(body.records.map((r) => r.path).sort()).toEqual(["/batch-a", "/batch-b", "/batch-c"]);

    for (const pathname of ["/batch-a", "/batch-b", "/batch-c"]) {
      const get = await GET(context({ path: pathname }));
      expect(get.status).toBe(200);
      expect(await get.text()).toContain(pathname);
    }
  });

  it("reports a per-page error without failing the pages that ARE valid", async () => {
    const response = await POST(postContext({ pages: [onePage("/batch-ok"), { pathname: "/batch-bad" }] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { records: { path: string }[]; errors: { pathname: string }[] };
    expect(body.records.map((r) => r.path)).toEqual(["/batch-ok"]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.pathname).toBe("/batch-bad");
  });

  it("still accepts the original single-page body shape unchanged", async () => {
    const response = await POST(postContext(onePage("/single-page")));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { record: { path: string } };
    expect(body.record.path).toBe("/single-page");
  });

  it("persists a posted sourceHash, readable back through the full manifest GET", async () => {
    const response = await POST(postContext(onePage("/with-source-hash", [], "hash-abc")));
    expect(response.status).toBe(200);

    const list = await GET(context({}, codePermissionSession));
    const body = (await list.json()) as { pages: { path: string; sourceHash: string | null }[] };
    expect(body.pages.find((p) => p.path === "/with-source-hash")).toMatchObject({ sourceHash: "hash-abc" });
  });

  it("defaults to a null sourceHash when the caller doesn't send one (graceful wire-level degradation)", async () => {
    const response = await POST(postContext(onePage("/without-source-hash")));
    expect(response.status).toBe(200);

    const list = await GET(context({}, codePermissionSession));
    const body = (await list.json()) as { pages: { path: string; sourceHash: string | null }[] };
    expect(body.pages.find((p) => p.path === "/without-source-hash")).toMatchObject({ sourceHash: null });
  });
});

describe("POST /dry/api/pages-build - clears ai-page-source-flags.ts on a successful build", () => {
  it("clears the flag for the page's entryPath once it publishes", async () => {
    const { markAiPageSourceWrite, listAiPageSourceFlags } = await import("../ai-page-source-flags.js");
    await markAiPageSourceWrite("pages/build-clears-flag/page.tsx", {});
    expect((await listAiPageSourceFlags({})).some((f) => f.path === "pages/build-clears-flag/page.tsx")).toBe(true);

    const response = await POST(postContext(onePage("/build-clears-flag")));
    expect(response.status).toBe(200);

    expect((await listAiPageSourceFlags({})).some((f) => f.path === "pages/build-clears-flag/page.tsx")).toBe(false);
  });

  it("clears flags for layouts/components/styles included in the published source graph", async () => {
    const { markAiPageSourceWrite, listAiPageSourceFlags } = await import("../ai-page-source-flags.js");
    const sourcePaths = ["pages/source-graph/page.tsx", "pages/layout.tsx", "component/Card.tsx", "styles/globals.css"];
    for (const path of sourcePaths) await markAiPageSourceWrite(path, {});

    const body = { ...onePage("/source-graph"), sourcePaths };
    const response = await POST(postContext(body));
    expect(response.status).toBe(200);

    const flags = await listAiPageSourceFlags({});
    for (const path of sourcePaths) expect(flags.some((flag) => flag.path === path)).toBe(false);
  });

  it("leaves an UNRELATED flagged path untouched", async () => {
    const { markAiPageSourceWrite, listAiPageSourceFlags } = await import("../ai-page-source-flags.js");
    await markAiPageSourceWrite("pages/build-unrelated/page.tsx", {});

    await POST(postContext(onePage("/build-something-else")));

    expect((await listAiPageSourceFlags({})).some((f) => f.path === "pages/build-unrelated/page.tsx")).toBe(true);
  });

  it("clears every published page's own entryPath in a batch build", async () => {
    const { markAiPageSourceWrite, listAiPageSourceFlags } = await import("../ai-page-source-flags.js");
    await markAiPageSourceWrite("pages/batch-clear-a/page.tsx", {});
    await markAiPageSourceWrite("pages/batch-clear-b/page.tsx", {});

    const response = await POST(postContext({ pages: [onePage("/batch-clear-a"), onePage("/batch-clear-b")] }));
    expect(response.status).toBe(200);

    const flags = await listAiPageSourceFlags({});
    expect(flags.some((f) => f.path === "pages/batch-clear-a/page.tsx")).toBe(false);
    expect(flags.some((f) => f.path === "pages/batch-clear-b/page.tsx")).toBe(false);
  });
});

describe("authorization - \"code + content = page\", not just the code-edit permission", () => {
  it("401s an unauthenticated request", async () => {
    const response = await POST(postContext(onePage("/auth-anon"), null));
    expect(response.status).toBe(401);
  });

  it("denies a non-code session publishing a page that's never been built (nothing recorded to authorize against)", async () => {
    const response = await POST(postContext(onePage("/auth-never-built", [{ resource: "role", version: 1 }]), roleViewerSession));
    expect(response.status).toBe(403);
  });

  it("the code-edit permission can publish a brand new page unconditionally", async () => {
    const response = await POST(postContext(onePage("/auth-first-build", [{ resource: "role", version: 1 }]), codePermissionSession));
    expect(response.status).toBe(200);
  });

  it("a non-code session CAN republish a page once its recorded deps are entirely within what it can view", async () => {
    const registry = createPagesRegistryAdapter(content);
    await registry.recordBuild(
      { path: "/auth-role-scoped", objectKey: "pages/x/auth-role-scoped.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "role", version: 1 }],
    );
    const response = await POST(postContext(onePage("/auth-role-scoped", [{ resource: "role", version: 2 }]), roleViewerSession));
    expect(response.status).toBe(200);
  });

  it("a non-code session is denied once ANY recorded dependency is outside what it can view - client-submitted deps don't override this", async () => {
    const registry = createPagesRegistryAdapter(content);
    await registry.recordBuild(
      { path: "/auth-mixed-deps", objectKey: "pages/x/auth-mixed-deps.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "role", version: 1 }, { resource: "systemSettings", version: 1 }],
    );
    // Even claiming (falsely) that this build only touches `role` must not
    // help - authorization is checked against the SERVER's own prior
    // record, never the request body's own `deps`.
    const response = await POST(postContext(onePage("/auth-mixed-deps", [{ resource: "role", version: 2 }]), roleViewerSession));
    expect(response.status).toBe(403);
  });

  it("GET ?byResource= silently drops a resource the caller can't view instead of 403ing the whole request", async () => {
    const registry = createPagesRegistryAdapter(content);
    await registry.recordBuild(
      { path: "/auth-byresource-role", objectKey: "pages/x/auth-byresource-role.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "role", version: 1 }],
    );
    await registry.recordBuild(
      { path: "/auth-byresource-settings", objectKey: "pages/x/auth-byresource-settings.html", buildId: "x", builtAt: Date.now(), inSitemap: true, sourceHash: null },
      [{ resource: "systemSettings", version: 1 }],
    );
    const response = await GET(context({ byResource: "role,systemSettings" }, roleViewerSession));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { paths: string[] };
    // Other tests in this file also record pages depending on "role" - only
    // assert on what THIS test cares about (present vs. filtered out),
    // rather than the exact full set.
    expect(body.paths).toContain("/auth-byresource-role");
    expect(body.paths).not.toContain("/auth-byresource-settings");
  });

  it("full manifest GET (no query) requires the code-edit permission", async () => {
    const denied = await GET(context({}, roleViewerSession));
    expect(denied.status).toBe(403);
    const allowed = await GET(context({}, codePermissionSession));
    expect(allowed.status).toBe(200);
  });

  it("DELETE requires the code-edit permission", async () => {
    await POST(postContext(onePage("/auth-delete-me")));
    const denied = await DELETE(deleteContext("/auth-delete-me", roleViewerSession));
    expect(denied.status).toBe(403);
    const allowed = await DELETE(deleteContext("/auth-delete-me", codePermissionSession));
    expect(allowed.status).toBe(204);
  });
});
