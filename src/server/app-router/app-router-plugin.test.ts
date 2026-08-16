import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appRouterPlugin } from "./app-router-plugin.js";
import { resolveOptions } from "../options.js";

const plugin = appRouterPlugin();

function transform(code: string, id: string, consumer: "server" | "client" = "server") {
  return plugin.transform.call({ environment: { config: { consumer } } } as never, code, id);
}

/** Real absolute paths under this repo's own cwd - `app-router-plugin.ts`
 * computes its injected specifier relative to `process.cwd()`, so a fake
 * `/repo/...` id would produce an unpredictable relative path. */
function pagePath(rel: string): string {
  const storage = resolveOptions({ kind: "local" }).pagesSource.storage;
  if (storage.kind !== "local") throw new Error("expected a local pagesSource root in tests");
  return join(storage.root, "pages", rel);
}

describe("appRouterPlugin transform", () => {
  it("injects a dry-reader import for a page.tsx calling dry() without importing it", () => {
    const id = pagePath("blog/[slug]/page.tsx");
    const code = `export default async function Page() { const post = await dry().collection("post").get(1); return post; }`;
    const result = transform(code, id);
    expect(result).not.toBeNull();
    expect(result!.code).toMatch(/^import \{ dry \} from ".*\/src\/content-types\/dry-reader\.js";\n/);
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

  it("ignores files outside pagesSourceStorage", () => {
    const id = join(process.cwd(), "src/pages/Dashboard.tsx");
    const code = `dry();`;
    expect(transform(code, id)).toBeNull();
  });

  it("injects the client dry-reader-client for the client build (consumer=client)", () => {
    const id = pagePath("blog/[slug]/page.tsx");
    const code = `export default async function Page() { const post = await dry().collection("post").get(1); return post; }`;
    const result = transform(code, id, "client");
    expect(result).not.toBeNull();
    expect(result!.code).toMatch(/^import \{ dry \} from ".*\/src\/content-types\/dry-reader-client\.js";\n/);
  });

  it("injects a params-reader import for a page calling params() without importing it", () => {
    const id = pagePath("blog/[slug]/page.tsx");
    const code = `export default function Page() { return params().slug; }`;
    const result = transform(code, id);
    expect(result!.code).toMatch(/^import \{ params \} from ".*\/src\/content-types\/params-reader\.js";\n/);

    const client = transform(code, id, "client");
    expect(client!.code).toMatch(/^import \{ params \} from ".*\/src\/content-types\/params-reader-client\.js";\n/);
  });

  it("injects a dry-title import for a page calling setTitle() without importing it", () => {
    const id = pagePath("about/page.tsx");
    const code = `export default function Page() { setTitle("About us"); return null; }`;
    const result = transform(code, id);
    expect(result!.code).toMatch(/^import \{ setTitle \} from ".*\/src\/content-types\/dry-title\.js";\n/);

    const client = transform(code, id, "client");
    expect(client!.code).toMatch(/^import \{ setTitle \} from ".*\/src\/content-types\/dry-title-client\.js";\n/);
  });

  it("injects one import per global actually called, in a file using several", () => {
    const id = pagePath("blog/[slug]/page.tsx");
    const code = `export default async function Page() { const p = params(); setTitle(p.slug); return dry(); }`;
    const result = transform(code, id);
    expect(result!.code).toMatch(/import \{ dry \} from ".*\/src\/content-types\/dry-reader\.js";/);
    expect(result!.code).toMatch(/import \{ params \} from ".*\/src\/content-types\/params-reader\.js";/);
    expect(result!.code).toMatch(/import \{ setTitle \} from ".*\/src\/content-types\/dry-title\.js";/);
    expect(result!.code).toContain(code);
  });

  it("leaves a file alone that already imports params/setTitle itself", () => {
    const id = pagePath("page.tsx");
    const code = `import { params } from "../../content-types/params-reader.js";\nimport { setTitle } from "../../content-types/dry-title.js";\nexport default function Page() { setTitle("x"); return params(); }`;
    expect(transform(code, id)).toBeNull();
  });
});

describe("appRouterPlugin handleHotUpdate", () => {
  function hotUpdate(file: string) {
    const send = vi.fn();
    const result = plugin.handleHotUpdate!.call({} as never, {
      file,
      server: { ws: { send } },
    } as never);
    return { result, send };
  }

  it("broadcasts a source-change event for a page.tsx change", () => {
    const { result, send } = hotUpdate(pagePath("page.tsx"));
    expect(send).toHaveBeenCalledWith({ type: "custom", event: "dry:pages-source-change", data: { path: "pages/page.tsx" } });
    expect(result).toEqual([]);
  });

  it("broadcasts a source-change event for live pages-source styles", () => {
    // Any file under the live storage root shares the same reload path.
    const storage = resolveOptions({ kind: "local" }).pagesSource.storage;
    if (storage.kind !== "local") throw new Error("expected a local pagesSource root in tests");
    const { result, send } = hotUpdate(join(storage.root, "styles/globals.css"));
    expect(send).toHaveBeenCalledWith({ type: "custom", event: "dry:pages-source-change", data: { path: "styles/globals.css" } });
    expect(result).toEqual([]);
  });

  it("ignores files outside pagesSourceStorage", () => {
    const { result, send } = hotUpdate(join(process.cwd(), ".dry/dry.generated.d.ts"));
    expect(send).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
