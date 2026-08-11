import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import { afterAll, describe, expect, it, vi } from "vitest";

const testSession: SessionPayload = { id: 1, name: "Test Admin", email: "test-admin@example.com" };

const tempDirBox = vi.hoisted(() => ({ path: "" }));
const superAdminBox = vi.hoisted(() => ({ value: false }));

vi.mock("../admin-access.js", () => ({
  isSuperAdminSession: async () => superAdminBox.value,
}));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-storage-route-"));
  return { storage: { kind: "local", root: tempDirBox.path } };
});

const { GET, POST, PUT, PATCH, DELETE } = await import("./storage.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(opts: {
  slug?: string;
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  session?: SessionPayload | null;
}): DryRouteContext {
  const url = new URL(`http://localhost/dry/api/storage/${opts.slug ?? ""}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value);
  const request = new Request(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: opts.headers,
  });
  const session = opts.session !== undefined ? opts.session : testSession;
  return { params: { slug: opts.slug }, request, url, env: {}, session };
}

function jsonBody(body: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

async function mkdir(name: string): Promise<Response> {
  return POST(context({ slug: "", method: "POST", ...jsonBody({ action: "mkdir", name }) }));
}

async function upload(folder: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append("files", file);
  return POST(context({ slug: folder, method: "POST", body: form }));
}

describe("GET /dry/api/storage/[...slug]", () => {
  it("lists an empty root", async () => {
    const response = await GET(context({ slug: "" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "", entries: [] });
  });

  it("404s a missing path", async () => {
    const response = await GET(context({ slug: "nope" }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("not_found");
  });

  it("decodes a percent-encoded slug - `params.slug` from Astro is raw, not pre-decoded", async () => {
    const name = "vacation photo, July 2026.txt";
    await upload("", new File(["x"], name, { type: "text/plain" }));

    // Simulates the real request Astro hands the route: the raw (still-encoded)
    // path segment, same as what `previewUrl`/`file-manager-http-source.ts`
    // build via `encodeURIComponent`.
    const response = await GET(context({ slug: encodeURIComponent(name) }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("x");
  });

  it("lists a folder after mkdir, with previewUrl on images", async () => {
    await mkdir("photos");
    await upload("photos", new File(["data"], "cover.jpg", { type: "image/jpeg" }));

    const response = await GET(context({ slug: "photos" }));
    const data = (await response.json()) as { path: string; entries: { name: string; previewUrl?: string }[] };
    expect(data.path).toBe("photos");
    const entry = data.entries.find((e) => e.name === "cover.jpg");
    expect(entry?.previewUrl).toBe("/dry/api/storage/photos/cover.jpg");
  });

  it("streams a file's bytes with the right content-type", async () => {
    await upload("", new File(["hello world"], "notes.txt", { type: "text/plain" }));
    const response = await GET(context({ slug: "notes.txt" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("hello world");
  });

  it("serves a file's bytes with no session - uploaded media backs public reader pages", async () => {
    await upload("", new File(["hello world"], "public-notes.txt", { type: "text/plain" }));
    const response = await GET(context({ slug: "public-notes.txt", session: null }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
  });

  it("401s a folder listing with no session - only single-file reads are public", async () => {
    await mkdir("private-listing");
    const response = await GET(context({ slug: "private-listing", session: null }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("unauthenticated");
  });

  // New uploads reject `.svg` outright (see the POST/PUT tests below), so the
  // only way one ever ends up in storage is a pre-existing/legacy file -
  // simulated here by writing straight to the temp root instead of through
  // the upload endpoint.
  describe("legacy .svg files", () => {
    async function writeLegacySvg(name: string, contents: string): Promise<void> {
      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await writeFile(join(tempDirBox.path, name), contents);
    }

    it("still forces a raw download, unsanitized", async () => {
      await writeLegacySvg("legacy.svg", '<svg><script>alert(1)</script></svg>');
      const response = await GET(context({ slug: "legacy.svg" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
      expect(response.headers.get("content-disposition")).toContain("attachment");
      expect(await response.text()).toContain("<script>");
    });

    it("`?preview` serves it sanitized as real image/svg+xml", async () => {
      await writeLegacySvg(
        "legacy-preview.svg",
        '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/><script>alert(1)</script></svg>',
      );
      const response = await GET(context({ slug: "legacy-preview.svg", query: { preview: "" } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("content-disposition")).toBeNull();
      const body = await response.text();
      expect(body).toContain("<path");
      expect(body).not.toContain("<script");
    });

    it("`?preview` on a payload with no <svg> root has nothing safe to show", async () => {
      await writeLegacySvg("legacy-malicious.svg", '<script>alert(1)</script>');
      const response = await GET(context({ slug: "legacy-malicious.svg", query: { preview: "" } }));
      expect(response.status).toBe(501);
      expect((await response.json()).error).toBe("unsupported");
    });
  });
});

describe("GET /dry/api/storage?tree (listAll prefetch)", () => {
  it("returns the whole tree flattened when the adapter supports it (local does)", async () => {
    await mkdir("tree-docs");
    await upload("tree-docs", new File(["x"], "a.txt", { type: "text/plain" }));

    const response = await GET(context({ slug: "", query: { tree: "1" } }));
    expect(response.status).toBe(200);
    const data = (await response.json()) as { supported: boolean; entries: { id: string }[] };
    expect(data.supported).toBe(true);
    expect(data.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(["tree-docs", "tree-docs/a.txt"]),
    );
  });

  it("400s when ?tree is requested for a non-root path", async () => {
    const response = await GET(context({ slug: "somewhere", query: { tree: "1" } }));
    expect(response.status).toBe(400);
  });
});

describe("POST /dry/api/storage/[...slug] (multipart upload)", () => {
  it("uploads into an existing folder", async () => {
    await mkdir("uploads");
    const response = await upload("uploads", new File(["x"], "a.txt", { type: "text/plain" }));
    expect(response.status).toBe(201);
    const data = (await response.json()) as { entries: { id: string }[] };
    expect(data.entries).toEqual([expect.objectContaining({ id: "uploads/a.txt" })]);
  });

  it("includes previewUrl on an uploaded image, matching what GET/list() would report", async () => {
    await mkdir("photos-upload");
    const response = await upload("photos-upload", new File(["data"], "cover.jpg", { type: "image/jpeg" }));
    const data = (await response.json()) as { entries: { previewUrl?: string }[] };
    expect(data.entries[0]?.previewUrl).toBe("/dry/api/storage/photos-upload/cover.jpg");
  });

  it("409s on a colliding filename", async () => {
    await mkdir("dup");
    await upload("dup", new File(["x"], "a.txt", { type: "text/plain" }));
    const response = await upload("dup", new File(["y"], "a.txt", { type: "text/plain" }));
    expect(response.status).toBe(409);
  });

  it("404s when the target folder does not exist", async () => {
    const response = await upload("missing-folder", new File(["x"], "a.txt", { type: "text/plain" }));
    expect(response.status).toBe(404);
  });

  it("rejects SVG uploads in generic storage", async () => {
    const response = await upload("", new File(["<svg></svg>"], "unsafe.svg", { type: "image/svg+xml" }));
    expect(response.status).toBe(501);
  });
});

describe("POST /dry/api/storage/[...slug] (mkdir)", () => {
  it("creates a folder", async () => {
    const response = await mkdir("archive");
    expect(response.status).toBe(201);
    const data = (await response.json()) as { entry: { id: string; kind: string } };
    expect(data.entry).toMatchObject({ id: "archive", kind: "folder" });
  });

  it("409s on a colliding folder name", async () => {
    await mkdir("dup-folder");
    const response = await mkdir("dup-folder");
    expect(response.status).toBe(409);
  });

  it("415s an unrecognized content-type", async () => {
    const response = await POST(context({ slug: "", method: "POST", body: "raw" }));
    expect(response.status).toBe(415);
  });
});

describe("POST /dry/api/storage/[...slug] (remote image import)", () => {
  it("downloads a public raster image and auto-suffixes a repeated filename", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "3" },
    })) as typeof fetch;
    try {
      await mkdir("pasted");
      const body = jsonBody({ action: "import-url", url: "https://93.184.216.34/photo.jpg" });
      const first = await POST(context({ slug: "pasted", method: "POST", ...body }));
      const second = await POST(context({ slug: "pasted", method: "POST", ...body }));

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((await first.json()).entry).toMatchObject({ id: "pasted/photo.jpg", previewUrl: "/dry/api/storage/pasted/photo.jpg" });
      expect((await second.json()).entry).toMatchObject({ id: "pasted/photo-2.jpg" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a remote response that is not an image", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("hello", { headers: { "content-type": "text/plain" } })) as typeof fetch;
    try {
      await mkdir("pasted-invalid");
      const response = await POST(context({
        slug: "pasted-invalid",
        method: "POST",
        ...jsonBody({ action: "import-url", url: "https://93.184.216.34/file.txt" }),
      }));
      expect(response.status).toBe(501);
      expect((await response.json()).error).toBe("unsupported");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("PUT /dry/api/storage/[...slug]", () => {
  it("creates/overwrites a file's bytes", async () => {
    const first = await PUT(context({ slug: "replace.txt", method: "PUT", body: "v1" }));
    expect(first.status).toBe(200);
    const second = await PUT(context({ slug: "replace.txt", method: "PUT", body: "v2-longer" }));
    expect(second.status).toBe(200);

    const read = await GET(context({ slug: "replace.txt" }));
    expect(await read.text()).toBe("v2-longer");
  });

  it("404s when the parent folder does not exist", async () => {
    const response = await PUT(context({ slug: "no-parent/file.txt", method: "PUT", body: "x" }));
    expect(response.status).toBe(404);
  });

  it("400s an empty path", async () => {
    const response = await PUT(context({ slug: "", method: "PUT", body: "x" }));
    expect(response.status).toBe(400);
  });

  it("rejects SVG replacement targets", async () => {
    const response = await PUT(context({ slug: "unsafe.svg", method: "PUT", body: "<svg></svg>" }));
    expect(response.status).toBe(501);
  });

  it("includes previewUrl when overwriting an image, matching what GET/list() would report", async () => {
    const response = await PUT(context({ slug: "photo.jpg", method: "PUT", body: "bytes" }));
    const data = (await response.json()) as { entry: { previewUrl?: string } };
    expect(data.entry.previewUrl).toBe("/dry/api/storage/photo.jpg");
  });
});

describe("PATCH /dry/api/storage/[...slug] (move/copy)", () => {
  it("moves a file", async () => {
    await upload("", new File(["x"], "move-me.txt", { type: "text/plain" }));
    const response = await PATCH(
      context({ slug: "move-me.txt", method: "PATCH", ...jsonBody({ action: "move", to: "moved.txt" }) }),
    );
    expect(response.status).toBe(200);
    expect((await GET(context({ slug: "move-me.txt" }))).status).toBe(404);
    expect((await GET(context({ slug: "moved.txt" }))).status).toBe(200);
  });

  it("includes previewUrl on a moved image, matching what GET/list() would report", async () => {
    await upload("", new File(["data"], "pic.jpg", { type: "image/jpeg" }));
    const response = await PATCH(
      context({ slug: "pic.jpg", method: "PATCH", ...jsonBody({ action: "move", to: "pic-2.jpg" }) }),
    );
    const data = (await response.json()) as { entry: { previewUrl?: string } };
    expect(data.entry.previewUrl).toBe("/dry/api/storage/pic-2.jpg");
  });

  it("copies a folder recursively, leaving the source in place", async () => {
    await mkdir("copy-src");
    await upload("copy-src", new File(["x"], "a.txt", { type: "text/plain" }));
    const response = await PATCH(
      context({ slug: "copy-src", method: "PATCH", ...jsonBody({ action: "copy", to: "copy-dst" }) }),
    );
    expect(response.status).toBe(200);
    expect((await GET(context({ slug: "copy-src/a.txt" }))).status).toBe(200);
    expect((await GET(context({ slug: "copy-dst/a.txt" }))).status).toBe(200);
  });

  it("400s pasting a folder into its own subtree", async () => {
    await mkdir("self-nest");
    const response = await PATCH(
      context({
        slug: "self-nest",
        method: "PATCH",
        ...jsonBody({ action: "move", to: "self-nest/inner" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("409s when the destination already exists", async () => {
    await mkdir("dest-a");
    await mkdir("dest-b");
    const response = await PATCH(
      context({ slug: "dest-a", method: "PATCH", ...jsonBody({ action: "move", to: "dest-b" }) }),
    );
    expect(response.status).toBe(409);
  });

  it("404s a missing source", async () => {
    const response = await PATCH(
      context({ slug: "does-not-exist", method: "PATCH", ...jsonBody({ action: "move", to: "elsewhere" }) }),
    );
    expect(response.status).toBe(404);
  });
});

describe("DELETE /dry/api/storage/[...slug]", () => {
  it("deletes a file", async () => {
    await upload("", new File(["x"], "delete-me.txt", { type: "text/plain" }));
    const response = await DELETE(context({ slug: "delete-me.txt", method: "DELETE" }));
    expect(response.status).toBe(204);
    expect((await GET(context({ slug: "delete-me.txt" }))).status).toBe(404);
  });

  it("404s a missing path", async () => {
    const response = await DELETE(context({ slug: "already-gone.txt", method: "DELETE" }));
    expect(response.status).toBe(404);
  });

  it("400s deleting the storage root", async () => {
    const response = await DELETE(context({ slug: "", method: "DELETE" }));
    expect(response.status).toBe(400);
  });
});

describe("hidden .avatar/.tmp.* folders", () => {
  afterAll(() => {
    superAdminBox.value = false;
  });

  it("stays out of list/tree for an ordinary session", async () => {
    await mkdir(".avatar");
    const listResponse = await GET(context({ slug: "" }));
    const listData = (await listResponse.json()) as { entries: { id: string }[] };
    expect(listData.entries.some((e) => e.id === ".avatar")).toBe(false);

    const treeResponse = await GET(context({ slug: "", query: { tree: "1" } }));
    const treeData = (await treeResponse.json()) as { entries: { id: string }[] };
    expect(treeData.entries.some((e) => e.id === ".avatar")).toBe(false);
  });

  it("shows up in list/tree for a super-admin session", async () => {
    superAdminBox.value = true;
    const listResponse = await GET(context({ slug: "" }));
    const listData = (await listResponse.json()) as { entries: { id: string }[] };
    expect(listData.entries.some((e) => e.id === ".avatar")).toBe(true);

    const treeResponse = await GET(context({ slug: "", query: { tree: "1" } }));
    const treeData = (await treeResponse.json()) as { entries: { id: string }[] };
    expect(treeData.entries.some((e) => e.id === ".avatar")).toBe(true);
  });
});
