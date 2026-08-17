import { beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_SYNC_TYPE_ID } from "../content-types/system-fields.js";

const box = vi.hoisted(() => ({
  types: [] as Array<{ id: string }>,
  row: null as null | { id: number; value: Record<string, unknown> },
  raw: null as null | Record<string, unknown>,
}));

vi.mock("./content-adapters.js", () => ({
  getContentAdapters: () => ({
    schema: { listContentTypes: async () => box.types },
    entries: {
      getSingletonEntry: async () => box.row,
      getRawEntry: async () => box.raw,
    },
  }),
}));
vi.mock("../lib/secret-crypto.js", () => ({ decryptSecret: async (value: string) => `decrypted:${value}` }));

const { loadGitConfig } = await import("./git-config.js");
const context = { env: {} } as Parameters<typeof loadGitConfig>[0];

describe("loadGitConfig", () => {
  beforeEach(() => {
    box.types = [];
    box.row = null;
    box.raw = null;
    vi.stubEnv("GITHUB_REPO", "env-owner/env-repo");
    vi.stubEnv("GITHUB_BRANCH", "env-branch");
    vi.stubEnv("GITHUB_PAT_KEY", "env-token");
  });

  it("does not let environment variables bypass database setup", async () => {
    await expect(loadGitConfig(context)).resolves.toEqual({ error: "not-configured" });
  });

  it("loads repository, branch and encrypted token from the githubSync singleton", async () => {
    box.types = [{ id: GITHUB_SYNC_TYPE_ID }];
    box.row = { id: 7, value: { enabled: true, repo: "db-owner/db-repo", branch: "main" } };
    box.raw = { token: "ciphertext" };
    await expect(loadGitConfig(context)).resolves.toEqual({
      config: { repo: "db-owner/db-repo", branch: "main", token: "decrypted:ciphertext" },
    });
  });
});
