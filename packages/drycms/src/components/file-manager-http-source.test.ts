import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpFileSource } from "./file-manager-http-source.js";
import type { FileEntry } from "./file-manager-types.js";

const API_BASE = "/dry/api/storage";

const fileEntry = (overrides: Partial<FileEntry> = {}): FileEntry => ({
  id: "docs/a.txt",
  name: "a.txt",
  parentId: "docs",
  kind: "file",
  ext: "txt",
  size: 5,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createHttpFileSource", () => {
  it("list() GETs the root when folderId is null", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ path: "", entries: [fileEntry()] }));
    const source = createHttpFileSource(API_BASE);

    const entries = await source.list(null);

    expect(fetchMock).toHaveBeenCalledWith(API_BASE);
    expect(entries).toEqual([fileEntry()]);
  });

  it("list() GETs an encoded folder path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ path: "my docs", entries: [] }));
    const source = createHttpFileSource(API_BASE);

    await source.list("my docs");

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/my%20docs`);
  });

  it("list() throws the server's message on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not_found", message: "nope" }, 404));
    const source = createHttpFileSource(API_BASE);

    await expect(source.list("missing")).rejects.toThrow("nope");
  });

  it("upload() POSTs a multipart form under the 'files' field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ entries: [fileEntry()] }, 201));
    const source = createHttpFileSource(API_BASE);
    const file = new File(["hello"], "a.txt", { type: "text/plain" });

    const entries = await source.upload!("docs", [file]);

    expect(entries).toEqual([fileEntry()]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/docs`);
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.getAll("files")).toEqual([file]);
  });

  it("createFolder() POSTs a mkdir action", async () => {
    const entry = fileEntry({ id: "docs/nested", name: "nested", kind: "folder", ext: undefined });
    fetchMock.mockResolvedValueOnce(jsonResponse({ entry }, 201));
    const source = createHttpFileSource(API_BASE);

    const created = await source.createFolder!("docs", "nested");

    expect(created).toEqual(entry);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/docs`);
    expect(JSON.parse(init.body as string)).toEqual({ action: "mkdir", name: "nested" });
  });

  it("move() PATCHes each id to targetFolder/basename in parallel", async () => {
    // A fresh Response per call - `Promise.all` reads both bodies concurrently,
    // and a `Response` body can only be read once.
    fetchMock.mockImplementation(async () =>
      jsonResponse({ entry: fileEntry({ id: "archive/a.txt", parentId: "archive" }) }),
    );
    const source = createHttpFileSource(API_BASE);

    await source.move!(["docs/a.txt", "docs/b.txt"], "archive");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const bodies = calls.map(([, init]) => JSON.parse(init.body as string));
    expect(calls.map(([url]) => url)).toEqual([`${API_BASE}/docs/a.txt`, `${API_BASE}/docs/b.txt`]);
    expect(bodies).toEqual([
      { action: "move", to: "archive/a.txt" },
      { action: "move", to: "archive/b.txt" },
    ]);
  });

  it("copy() retries with a ' copy' suffix on a 409, sequentially", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "already_exists", message: "x" }, 409))
      .mockResolvedValueOnce(jsonResponse({ entry: fileEntry({ id: "docs/a copy.txt" }) }));
    const source = createHttpFileSource(API_BASE);

    const [copied] = await source.copy!(["docs/a.txt"], "docs");

    expect(copied).toEqual(fileEntry({ id: "docs/a copy.txt" }));
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual([
      { action: "copy", to: "docs/a.txt" },
      { action: "copy", to: "docs/a copy.txt" },
    ]);
  });

  it("remove() DELETEs each id and throws on failure", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const source = createHttpFileSource(API_BASE);

    await source.remove!(["docs/a.txt", "docs/b.txt"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.method).toBe("DELETE");
    }
  });

  it("remove() surfaces a 404 rather than swallowing it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not_found", message: "gone" }, 404));
    const source = createHttpFileSource(API_BASE);

    await expect(source.remove!(["docs/a.txt"])).rejects.toThrow("gone");
  });

  it("rename() PATCHes a move to the same parent with the new name", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ entry: fileEntry({ id: "docs/b.txt", name: "b.txt" }) }));
    const source = createHttpFileSource(API_BASE);

    await source.rename!("docs/a.txt", "b.txt");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/docs/a.txt`);
    expect(JSON.parse(init.body as string)).toEqual({ action: "move", to: "docs/b.txt" });
  });

  it("listAll() GETs ?tree=1 and returns the flattened entries when supported", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ supported: true, entries: [fileEntry()] }));
    const source = createHttpFileSource(API_BASE);

    const all = await source.listAll!();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}?tree=1`);
    expect(all).toEqual([fileEntry()]);
  });

  it("listAll() returns null when the backend reports it isn't supported", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ supported: false }));
    const source = createHttpFileSource(API_BASE);

    expect(await source.listAll!()).toBeNull();
  });

  it("replace() PUTs the raw file", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ entry: fileEntry({ size: 3 }) }));
    const source = createHttpFileSource(API_BASE);
    const file = new File(["xyz"], "a.txt", { type: "text/plain" });

    const updated = await source.replace!("docs/a.txt", file);

    expect(updated).toEqual(fileEntry({ size: 3 }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/docs/a.txt`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(file);
  });
});
