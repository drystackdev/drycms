import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchBox = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./outbound-url.js", () => ({
  validateOutboundUrlForRequest: async (url: string) => url.replace(/\/+$/, ""),
  fetchNoRedirect: (...args: unknown[]) => fetchBox.fetch(...args),
}));

const { pushPagesSourceSnapshot } = await import("./gitlab-source-sync.js");
const config = { url: "https://gitlab.example.com", repo: "group/site", branch: "drycms", token: "glpat-secret" };

describe("GitLab source sync adapter", () => {
  beforeEach(() => fetchBox.fetch.mockReset());

  it("creates the configured branch from the default branch and commits source files", async () => {
    fetchBox.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "404 Branch Not Found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "404 Branch Not Found" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ default_branch: "main" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "commit-1" }), { status: 201 }));

    await expect(pushPagesSourceSnapshot({ "pages/page.tsx": "export default 1" }, config, "Build")).resolves.toEqual({ pushed: true, commitSha: "commit-1" });
    const [url, init] = fetchBox.fetch.mock.calls[3]!;
    expect(url).toBe("https://gitlab.example.com/api/v4/projects/group%2Fsite/repository/commits");
    expect(new Headers((init as RequestInit).headers).get("PRIVATE-TOKEN")).toBe("glpat-secret");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ branch: "drycms", start_branch: "main", commit_message: "Build" });
  });
});
