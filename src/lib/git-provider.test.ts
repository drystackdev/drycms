import { describe, expect, it } from "vitest";
import { DEFAULT_GITLAB_URL, detectGitProvider, gitRemoteUrl, parseGitRemoteUrl, parseGitRepositorySetting, serializeGitRepositorySetting } from "./git-provider.js";

describe("parseGitRemoteUrl", () => {
  it("derives the platform, origin and repository from one URL", () => {
    expect(parseGitRemoteUrl("https://gitlab.com/thanhkhan2k/drycms-storage")).toEqual({
      ok: true,
      setting: { provider: "gitlab", url: "https://gitlab.com", repo: "thanhkhan2k/drycms-storage", user: "" },
    });
    expect(parseGitRemoteUrl("https://github.com/acme/site.git/")).toEqual({
      ok: true,
      setting: { provider: "github", url: "https://github.com", repo: "acme/site", user: "" },
    });
  });

  it("treats an unknown host as a custom (self-hosted) git server", () => {
    const parsed = parseGitRemoteUrl("https://git.example.com/group/sub/site");
    expect(parsed).toEqual({ ok: true, setting: { provider: "custom", url: "https://git.example.com", repo: "group/sub/site", user: "" } });
  });

  it("keeps a userinfo name as the Basic-auth username", () => {
    const parsed = parseGitRemoteUrl("https://ci-bot@git.example.com/group/site.git");
    expect(parsed).toMatchObject({ ok: true, setting: { user: "ci-bot", url: "https://git.example.com" } });
    expect(gitRemoteUrl({ url: "https://git.example.com", repo: "group/site", user: "ci-bot" })).toBe("https://ci-bot@git.example.com/group/site");
  });

  it("accepts an SSH remote and the legacy bare owner/name", () => {
    expect(parseGitRemoteUrl("git@github.com:acme/site.git")).toMatchObject({ ok: true, setting: { provider: "github", repo: "acme/site" } });
    expect(parseGitRemoteUrl("acme/site")).toMatchObject({ ok: true, setting: { provider: "github", url: "https://github.com", repo: "acme/site" } });
  });

  it("rejects a URL with no repository path, a GitHub group path, and a non-http scheme", () => {
    expect(parseGitRemoteUrl("https://gitlab.com/only-group")).toMatchObject({ ok: false });
    expect(parseGitRemoteUrl("https://github.com/acme/site/extra")).toMatchObject({ ok: false });
    expect(parseGitRemoteUrl("file:///etc/passwd")).toMatchObject({ ok: false });
    expect(parseGitRemoteUrl("")).toMatchObject({ ok: false });
  });
});

describe("detectGitProvider", () => {
  it("only knows the two public hosts by name", () => {
    expect(detectGitProvider("github.com")).toBe("github");
    expect(detectGitProvider("GitLab.com")).toBe("gitlab");
    expect(detectGitProvider("git.example.com")).toBe("custom");
  });
});

describe("git repository settings", () => {
  it("round-trips the stored provider and URL", () => {
    const stored = serializeGitRepositorySetting({ provider: "gitlab", url: "https://git.example.com", repo: "acme/site", user: "" });
    expect(stored).toBe("gitlab|https://git.example.com/acme/site");
    // The host alone would read as `custom`; the stored provider wins, which
    // is the whole reason it is written out.
    expect(parseGitRepositorySetting(stored)).toEqual({ provider: "gitlab", url: "https://git.example.com", repo: "acme/site", user: "" });
  });

  it("keeps existing GitHub repository values backward compatible", () => {
    expect(parseGitRepositorySetting("acme/site")).toEqual({ provider: "github", url: "https://github.com", repo: "acme/site", user: "" });
  });

  it("keeps reading the previous gitlab|url|repo format", () => {
    expect(parseGitRepositorySetting("gitlab|https%3A%2F%2Fgitlab.example.com%2F|acme/site")).toEqual({
      provider: "gitlab",
      url: "https://gitlab.example.com",
      repo: "acme/site",
      user: "",
    });
    expect(parseGitRepositorySetting("gitlab||acme/site").url).toBe(DEFAULT_GITLAB_URL);
  });
});
