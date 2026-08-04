import { afterEach, describe, expect, it, vi } from "vitest";
import type { DryCallLogEntry } from "./dry-context.js";
import { dry, setReplayLog } from "./dry-reader-client.js";

afterEach(() => {
  setReplayLog([]);
  vi.restoreAllMocks();
});

describe("dry-reader-client", () => {
  it("replays collection.list/get and singleton.get in call order", async () => {
    const log: DryCallLogEntry[] = [
      { kind: "collection", name: "user", method: "list", result: { rows: [{ id: 1 }], total: 1 } },
      { kind: "collection", name: "post", method: "get", result: { id: 1, title: "hi" } },
      { kind: "singleton", name: "settings", method: "get", result: { theme: "dark" } },
    ];
    setReplayLog(log);

    await expect(dry().collection("user").list()).resolves.toEqual({ rows: [{ id: 1 }], total: 1 });
    await expect(dry().collection("post").get(1)).resolves.toEqual({ id: 1, title: "hi" });
    await expect(dry().singleton("settings").get()).resolves.toEqual({ theme: "dark" });
  });

  it("warns and falls back to an empty result once the log is exhausted", async () => {
    setReplayLog([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await dry().collection("user").list()).toEqual({ rows: [], total: 0 });
    expect(await dry().collection("user").get(1)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("warns (but still returns the positional result) when kind/name/method don't match", async () => {
    setReplayLog([{ kind: "collection", name: "user", method: "list", result: { rows: [], total: 0 } }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await dry().singleton("settings").get();
    expect(result).toEqual({ rows: [], total: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("mismatch"));
  });
});
