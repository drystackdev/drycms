import type { APIContext } from "astro";
import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("virtual:drycms/storage-config", async () => {
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
}): APIContext {
  const url = new URL(`http://localhost/dry/api/storage/${opts.slug ?? ""}`);
  const request = new Request(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: opts.headers,
  });
  return { params: { slug: opts.slug }, request, url } as unknown as APIContext;
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
});

describe("POST /dry/api/storage/[...slug] (multipart upload)", () => {
  it("uploads into an existing folder", async () => {
    await mkdir("uploads");
    const response = await upload("uploads", new File(["x"], "a.txt", { type: "text/plain" }));
    expect(response.status).toBe(201);
    const data = (await response.json()) as { entries: { id: string }[] };
    expect(data.entries).toEqual([expect.objectContaining({ id: "uploads/a.txt" })]);
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
