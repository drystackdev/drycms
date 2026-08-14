import { afterEach, describe, expect, it, vi } from "vitest";
import { publishStatus, showPublishStatus } from "./sync.js";

describe("publish status", () => {
  afterEach(() => {
    vi.useRealTimers();
    publishStatus.value = null;
  });

  it("keeps publishing progress visible until another status replaces it", () => {
    vi.useFakeTimers();
    showPublishStatus("Publishing 2 pages…", true);
    vi.advanceTimersByTime(10_000);
    expect(publishStatus.value).toEqual({ message: "Publishing 2 pages…", loading: true });
  });

  it("clears a completed publish status after the topbar flash", () => {
    vi.useFakeTimers();
    showPublishStatus("Published 2 pages", false);
    expect(publishStatus.value).toEqual({ message: "Published 2 pages", loading: false });
    vi.advanceTimersByTime(3000);
    expect(publishStatus.value).toBeNull();
  });
});
