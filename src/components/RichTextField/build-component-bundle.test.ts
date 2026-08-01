import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildComponentBundle, buildSharedPreactBundle } from "./build-component-bundle.js";

describe("buildComponentBundle", () => {
  it("inlines statically imported dry components into the owner bundle", async () => {
    const code = await buildComponentBundle(
      resolve(process.cwd(), "src/dry-components/dry.color-text.tsx"),
    );

    expect(code).toContain("site-carousel-1");
    expect(code).toContain("carousel__content");
    expect(code).not.toMatch(/from["']\.\/dry\.carousel/);

    const imports = code.match(/\bimport\b[^;]*;/g) ?? [];
    expect(imports.every((statement) => statement.includes("./preact.js"))).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), "drycms-component-bundle-"));
    try {
      await Promise.all([
        writeFile(join(dir, "color-text.js"), code, "utf8"),
        writeFile(join(dir, "preact.js"), await buildSharedPreactBundle(), "utf8"),
      ]);
      const mod = await import(`${pathToFileURL(join(dir, "color-text.js")).href}?test=${Date.now()}`);
      expect(mod.default.name).toBe("color-text");
      expect(mod.default.refs[0]?.name).toBe("carousel");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
