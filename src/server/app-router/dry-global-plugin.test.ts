import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dryGlobalPlugin } from "./dry-global-plugin.js";

const plugin = dryGlobalPlugin();

function transform(code: string, id: string) {
  return plugin.transform.call({} as never, code, id);
}

/** Real absolute paths under this repo's own cwd - `dry-global-plugin.ts`
 * computes its injected specifier relative to `process.cwd()`, so a fake
 * `/repo/...` id would produce an unpredictable relative path. */
function pagePath(rel: string): string {
  return join(process.cwd(), "src/apps/pages", rel);
}

describe("dryGlobalPlugin", () => {
  it("injects a dry-reader import for a page.tsx calling dry() without importing it", () => {
    const id = pagePath("blog/[slug]/page.tsx");
    const code = `export default async function Page() { const post = await dry().collection("post").get(1); return post; }`;
    const result = transform(code, id);
    expect(result).not.toBeNull();
    expect(result!.code).toMatch(/^import \{ dry \} from "..\/..\/..\/..\/content-types\/dry-reader\.js";\n/);
    expect(result!.code).toContain(code);
  });

  it("leaves a file alone that already imports dry itself", () => {
    const id = pagePath("page.tsx");
    const code = `import { dry } from "../../content-types/dry-reader.js";\nexport default async function Page() { return dry(); }`;
    expect(transform(code, id)).toBeNull();
  });

  it("leaves a file alone that never calls dry(", () => {
    const id = pagePath("about/page.tsx");
    const code = `export default function Page() { return "static"; }`;
    expect(transform(code, id)).toBeNull();
  });

  it("ignores files outside src/apps/pages", () => {
    const id = join(process.cwd(), "src/pages/Dashboard.tsx");
    const code = `dry();`;
    expect(transform(code, id)).toBeNull();
  });
});
