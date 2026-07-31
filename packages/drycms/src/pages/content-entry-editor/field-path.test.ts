import { describe, expect, it, vi } from "vitest";
import { setValueAtPath } from "./field-path.js";

describe("setValueAtPath", () => {
  it("sets a plain top-level field, same as the old spread", () => {
    const value = { title: "old", other: 1 };
    const next = setValueAtPath(value, "title", "new");
    expect(next).toEqual({ title: "new", other: 1 });
    expect(value).toEqual({ title: "old", other: 1 });
  });

  it("writes into a nested flatten field", () => {
    const value = { seo: { metaTitle: "old", metaDescription: "d" } };
    const next = setValueAtPath(value, "seo.metaTitle", "new");
    expect(next).toEqual({ seo: { metaTitle: "new", metaDescription: "d" } });
    expect(value.seo.metaTitle).toBe("old");
  });

  it("writes into a component-repeat array item", () => {
    const value = { data: [{ label: "a" }, { label: "b" }] };
    const next = setValueAtPath(value, "data.1.label", "z");
    expect(next).toEqual({ data: [{ label: "a" }, { label: "z" }] });
    expect(value.data[1]!.label).toBe("b");
  });

  it("writes a deep mixed path (array + nested flatten)", () => {
    const value = { data: [{ name: { label: "a", note: "n" } }] };
    const next = setValueAtPath(value, "data.0.name.label", "x");
    expect(next).toEqual({ data: [{ name: { label: "x", note: "n" } }] });
  });

  it("only copies the containers actually on the path", () => {
    const untouched = { keep: true };
    const value = { data: [{ label: "a" }], untouched };
    const next = setValueAtPath(value, "data.0.label", "z") as typeof value;
    expect(next.untouched).toBe(untouched);
    expect(next.data).not.toBe(value.data);
  });

  it("no-ops (and warns) on an out-of-bounds array index", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = { data: [{ label: "a" }] };
    const next = setValueAtPath(value, "data.5.label", "z");
    expect(next).toBe(value);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no-ops (and warns) indexing an array segment into a non-array", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = { title: "not an array" };
    const next = setValueAtPath(value, "title.0", "z");
    expect(next).toBe(value);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no-ops (and warns) indexing a field segment into a non-object", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = { title: "plain string" };
    const next = setValueAtPath(value, "title.label", "z");
    expect(next).toBe(value);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no-ops (and warns) on an empty path segment", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const value = { title: "a" };
    const next = setValueAtPath(value, "data..label", "z");
    expect(next).toBe(value);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
