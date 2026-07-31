import { describe, expect, it } from "vitest";
import { joinStoragePath, normalizeStoragePath, resolveWithinRoot, storagePathName, storagePathParent } from "./path.js";
import { StorageError } from "./types.js";

describe("normalizeStoragePath", () => {
  it("treats undefined/empty/slash as root", () => {
    expect(normalizeStoragePath(undefined)).toBe("");
    expect(normalizeStoragePath("")).toBe("");
    expect(normalizeStoragePath("/")).toBe("");
  });

  it("passes through a clean relative path", () => {
    expect(normalizeStoragePath("docs/contract.docx")).toBe("docs/contract.docx");
  });

  it("collapses leading/trailing/duplicate slashes", () => {
    expect(normalizeStoragePath("/docs//contract.docx/")).toBe("docs/contract.docx");
  });

  it("rejects traversal segments", () => {
    expect(() => normalizeStoragePath("../etc/passwd")).toThrow(StorageError);
    expect(() => normalizeStoragePath("docs/../../etc")).toThrow(StorageError);
    expect(() => normalizeStoragePath(".")).toThrow(StorageError);
  });

  it("rejects backslashes", () => {
    expect(() => normalizeStoragePath("docs\\contract.docx")).toThrow(StorageError);
  });

  it("rejects the .dir marker as a direct target", () => {
    expect(() => normalizeStoragePath("docs/.dir")).toThrow(StorageError);
    expect(() => normalizeStoragePath(".dir")).toThrow(StorageError);
  });
});

describe("resolveWithinRoot", () => {
  const root = "/srv/storage";

  it("resolves a relative path under root", () => {
    expect(resolveWithinRoot(root, "docs/contract.docx")).toBe("/srv/storage/docs/contract.docx");
  });

  it("returns root itself for an empty relative path", () => {
    expect(resolveWithinRoot(root, "")).toBe(root);
  });

  it("rejects an escape attempt", () => {
    expect(() => resolveWithinRoot(root, "../outside")).toThrow(StorageError);
  });
});

describe("path helpers", () => {
  it("joinStoragePath", () => {
    expect(joinStoragePath("", "docs")).toBe("docs");
    expect(joinStoragePath("docs", "contract.docx")).toBe("docs/contract.docx");
  });

  it("storagePathName", () => {
    expect(storagePathName("docs")).toBe("docs");
    expect(storagePathName("docs/contract.docx")).toBe("contract.docx");
  });

  it("storagePathParent", () => {
    expect(storagePathParent("docs")).toBe("");
    expect(storagePathParent("docs/contract.docx")).toBe("docs");
  });
});
