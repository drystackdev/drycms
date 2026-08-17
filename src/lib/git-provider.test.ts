import { describe, expect, it } from "vitest";
import { DEFAULT_GITLAB_URL, parseGitRepositorySetting, serializeGitRepositorySetting } from "./git-provider.js";

describe("git repository settings", () => {
  it("keeps existing GitHub repository values backward compatible", () => {
    expect(parseGitRepositorySetting("acme/site")).toEqual({ provider: "github", url: "", repo: "acme/site" });
    expect(serializeGitRepositorySetting({ provider: "github", url: "ignored", repo: "acme/site" })).toBe("acme/site");
  });

  it("round-trips a GitLab provider, URL, and repository", () => {
    const stored = serializeGitRepositorySetting({ provider: "gitlab", url: "https://gitlab.example.com/", repo: "acme/site" });
    expect(parseGitRepositorySetting(stored)).toEqual({ provider: "gitlab", url: "https://gitlab.example.com", repo: "acme/site" });
  });

  it("uses gitlab.com when the stored GitLab URL is empty", () => {
    expect(parseGitRepositorySetting("gitlab||acme/site").url).toBe(DEFAULT_GITLAB_URL);
  });
});
