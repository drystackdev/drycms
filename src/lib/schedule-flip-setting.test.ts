import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES, parseScheduleFlipIntervalMinutes } from "./schedule-flip-setting.js";

describe("parseScheduleFlipIntervalMinutes", () => {
  it("falls back to the default when there's nothing stored yet", () => {
    expect(parseScheduleFlipIntervalMinutes(undefined)).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
    expect(parseScheduleFlipIntervalMinutes(null)).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
    expect(parseScheduleFlipIntervalMinutes("")).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
  });

  it("reads a valid stored value, alongside other unrelated keys in the same blob", () => {
    expect(parseScheduleFlipIntervalMinutes(JSON.stringify({ primaryColor: "#00a76f", scheduleFlipIntervalMinutes: 30 }))).toBe(30);
  });

  it("falls back to the default for a non-positive or non-numeric value", () => {
    expect(parseScheduleFlipIntervalMinutes(JSON.stringify({ scheduleFlipIntervalMinutes: 0 }))).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
    expect(parseScheduleFlipIntervalMinutes(JSON.stringify({ scheduleFlipIntervalMinutes: -5 }))).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
    expect(parseScheduleFlipIntervalMinutes(JSON.stringify({ scheduleFlipIntervalMinutes: "60" }))).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
    expect(parseScheduleFlipIntervalMinutes(JSON.stringify({ scheduleFlipIntervalMinutes: Number.NaN }))).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
  });

  it("falls back to the default for malformed JSON rather than throwing", () => {
    expect(parseScheduleFlipIntervalMinutes("{not json")).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
    expect(parseScheduleFlipIntervalMinutes("[1,2,3]")).toBe(DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES);
  });
});
