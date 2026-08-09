import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushPagesSourceSnapshot } from "./github-source-sync.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CONFIG = { repo: "acme/site", branch: "main", token: "ghp_test" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pushPagesSourceSnapshot", () => {
  it("returns pushed:false without calling GitHub when there are no source files", async () => {
    const result = await pushPagesSourceSnapshot({}, CONFIG, "empty");
    expect(result).toEqual({ pushed: false, reason: "No pages-source files to snapshot." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("commits blob->tree->commit->ref-patch, in order, when the branch already exists", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-commit-sha" } })) // GET ref/heads/main
      .mockResolvedValueOnce(jsonResponse({ sha: "base-commit-sha", tree: { sha: "base-tree-sha" } })) // GET commits/base-commit-sha
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-sha-1" })) // POST blobs (page.tsx)
      .mockResolvedValueOnce(jsonResponse({ sha: "new-tree-sha" })) // POST trees
      .mockResolvedValueOnce(jsonResponse({ sha: "new-commit-sha" })) // POST commits
      .mockResolvedValueOnce(jsonResponse({})); // PATCH refs/heads/main

    const result = await pushPagesSourceSnapshot({ "page.tsx": "export default function Page(){}" }, CONFIG, "snapshot");

    expect(result).toEqual({ pushed: true, commitSha: "new-commit-sha" });
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const [refUrl, refInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refUrl).toBe("https://api.github.com/repos/acme/site/git/ref/heads/main");
    expect((refInit.headers as Record<string, string>).Authorization).toBe("Bearer ghp_test");

    const [blobUrl, blobInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(blobUrl).toBe("https://api.github.com/repos/acme/site/git/blobs");
    expect(JSON.parse(blobInit.body as string)).toEqual({ content: "export default function Page(){}", encoding: "utf-8" });

    const [treeUrl, treeInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(treeUrl).toBe("https://api.github.com/repos/acme/site/git/trees");
    expect(JSON.parse(treeInit.body as string)).toEqual({
      base_tree: "base-tree-sha",
      tree: [{ path: "page.tsx", mode: "100644", type: "blob", sha: "blob-sha-1" }],
    });

    const [commitUrl, commitInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(commitUrl).toBe("https://api.github.com/repos/acme/site/git/commits");
    expect(JSON.parse(commitInit.body as string)).toEqual({ message: "snapshot", tree: "new-tree-sha", parents: ["base-commit-sha"] });

    const [patchUrl, patchInit] = fetchMock.mock.calls[5] as [string, RequestInit];
    expect(patchUrl).toBe("https://api.github.com/repos/acme/site/git/refs/heads/main");
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(patchInit.body as string)).toEqual({ sha: "new-commit-sha", force: false });
  });

  it("falls back to the default branch's commit and creates a new ref when the target branch doesn't exist yet", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404)) // GET ref/heads/feature (missing)
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" })) // GET repo
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "default-commit-sha" } })) // GET ref/heads/main
      .mockResolvedValueOnce(jsonResponse({ sha: "default-commit-sha", tree: { sha: "default-tree-sha" } })) // GET commits/default-commit-sha
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-sha-1" })) // POST blobs
      .mockResolvedValueOnce(jsonResponse({ sha: "new-tree-sha" })) // POST trees
      .mockResolvedValueOnce(jsonResponse({ sha: "new-commit-sha" })) // POST commits
      .mockResolvedValueOnce(jsonResponse({}, 201)); // POST refs (create)

    const result = await pushPagesSourceSnapshot(
      { "page.tsx": "x" },
      { repo: "acme/site", branch: "feature", token: "ghp_test" },
      "snapshot",
    );

    expect(result).toEqual({ pushed: true, commitSha: "new-commit-sha" });
    const [createRefUrl, createRefInit] = fetchMock.mock.calls[7] as [string, RequestInit];
    expect(createRefUrl).toBe("https://api.github.com/repos/acme/site/git/refs");
    expect(createRefInit.method).toBe("POST");
    expect(JSON.parse(createRefInit.body as string)).toEqual({ ref: "refs/heads/feature", sha: "new-commit-sha" });
  });

  it("creates a parentless root commit when the repo has no commits at all", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404)) // GET ref/heads/main (missing)
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" })) // GET repo - default IS the requested branch
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-sha-1" })) // POST blobs
      .mockResolvedValueOnce(jsonResponse({ sha: "root-tree-sha" })) // POST trees (no base_tree)
      .mockResolvedValueOnce(jsonResponse({ sha: "root-commit-sha" })) // POST commits (no parents)
      .mockResolvedValueOnce(jsonResponse({}, 201)); // POST refs (create)

    const result = await pushPagesSourceSnapshot({ "page.tsx": "x" }, CONFIG, "first commit");

    expect(result).toEqual({ pushed: true, commitSha: "root-commit-sha" });
    const [treeUrl, treeInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(treeUrl).toBe("https://api.github.com/repos/acme/site/git/trees");
    expect(JSON.parse(treeInit.body as string)).toEqual({
      base_tree: undefined,
      tree: [{ path: "page.tsx", mode: "100644", type: "blob", sha: "blob-sha-1" }],
    });
    const [commitUrl, commitInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(commitUrl).toBe("https://api.github.com/repos/acme/site/git/commits");
    expect(JSON.parse(commitInit.body as string)).toEqual({ message: "first commit", tree: "root-tree-sha", parents: [] });
  });

  it("never throws - a GitHub API error comes back as pushed:false with the error message", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-commit-sha" } }))
      .mockResolvedValueOnce(jsonResponse({ sha: "base-commit-sha", tree: { sha: "base-tree-sha" } }))
      .mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, 401));

    const result = await pushPagesSourceSnapshot({ "page.tsx": "x" }, CONFIG, "snapshot");
    expect(result).toEqual({ pushed: false, reason: "Bad credentials" });
  });

  it("never throws on a network failure either", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await pushPagesSourceSnapshot({ "page.tsx": "x" }, CONFIG, "snapshot");
    expect(result).toEqual({ pushed: false, reason: "network down" });
  });
});
