import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appRouterPlugin } from "./app-router-plugin.js";

const plugin = appRouterPlugin();

function transform(code: string, id: string, consumer: "server" | "client" = "server") {
  return plugin.transform.call({ environment: { config: { consumer } } } as never, code, id);
}

/** Real absolute paths under this repo's own cwd - `app-router-plugin.ts`
 * computes its injected specifier relative to `process.cwd()`, so a fake
 * `/repo/...` id would produce an unpredictable relative path. */
function pagePath(rel: string): string {
  return join(process.cwd(), "src/apps/pages", rel);
}

describe("appRouterPlugin transform", () => {
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

  it("injects the client dry-reader-client for the client build (consumer=client)", () => {
    const id = pagePath("blog/[slug]/page.tsx");
    const code = `export default async function Page() { const post = await dry().collection("post").get(1); return post; }`;
    const result = transform(code, id, "client");
    expect(result).not.toBeNull();
    expect(result!.code).toMatch(/^import \{ dry \} from "..\/..\/..\/..\/content-types\/dry-reader-client\.js";\n/);
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

  it("broadcasts full-reload for a page.tsx change", () => {
    const { result, send } = hotUpdate(join(process.cwd(), "src/apps/pages/page.tsx"));
    expect(send).toHaveBeenCalledWith({ type: "full-reload" });
    expect(result).toEqual([]);
  });

  it("broadcasts full-reload for a globals.css change", () => {
    const { result, send } = hotUpdate(join(process.cwd(), "src/apps/globals.css"));
    expect(send).toHaveBeenCalledWith({ type: "full-reload" });
    expect(result).toEqual([]);
  });

  it("ignores files outside src/apps/pages and globals.css", () => {
    const { result, send } = hotUpdate(join(process.cwd(), "src/apps/dry.generated.d.ts"));
    expect(send).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
