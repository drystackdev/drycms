import { beforeAll, describe, expect, it } from "vitest";
import { generateDryTypes } from "../../content-types/codegen.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";

/**
 * Drives the REAL `ts-worker.ts` module (not a re-implementation of its host)
 * over the REAL `generateDryTypes` output, because the thing under test is
 * exactly the seam between them: the generated `.d.ts` imports `DryReader`
 * from `"../content-types/dry-reader.js"`, and that import has to resolve
 * inside the worker's virtual FS or `dry()` silently becomes `any` - no
 * error anywhere (`skipLibCheck` swallows it, the file being a `.d.ts`),
 * just every `dry()` completion in the page editor quietly gone, which is
 * how it shipped broken. A fixture copy of either side would let that seam
 * drift right back open.
 *
 * `ts-worker.ts` is a module-scope `self.onmessage = ...` worker entry, so
 * `self`/`postMessage` are stubbed before importing it and requests are
 * delivered by hand.
 */
const responses: WorkerResponse[] = [];

function send(request: WorkerRequest): void {
  (globalThis.self as unknown as { onmessage: (event: { data: WorkerRequest }) => void }).onmessage({ data: request });
}

/** The one collection + one singleton a page author would complete against. */
const CONTENT_TYPES: ContentTypeDefinition[] = [
  {
    id: "blog",
    kind: "collection",
    name: "blog",
    label: "Blog",
    version: 0,
    fields: [
      { id: "f1", name: "title", label: "Title", type: "text", config: {}, validation: { required: true }, order: 0 },
    ],
  },
  {
    id: "homepage",
    kind: "singleton",
    name: "homepage",
    label: "Homepage",
    version: 0,
    fields: [
      { id: "f2", name: "headline", label: "Headline", type: "text", config: {}, validation: { required: true }, order: 0 },
    ],
  },
];

function completionsAt(code: string, marker: string): string[] {
  send({
    kind: "update",
    code,
    extraFiles: { "dry.generated.d.ts": generateDryTypes(CONTENT_TYPES) },
    emitDiagnostics: false,
  });
  const pos = code.indexOf(marker) + marker.length;
  expect(pos).toBeGreaterThan(marker.length - 1);
  send({ kind: "completions", requestId: responses.length + 1, pos });
  const last = responses.at(-1);
  if (last?.kind !== "completions") throw new Error("expected a completions response");
  return last.items.map((item) => item.label);
}

describe("dry() completions in the page editor", () => {
  beforeAll(async () => {
    Object.defineProperty(globalThis, "self", { value: {}, configurable: true, writable: true });
    Object.defineProperty(globalThis, "postMessage", {
      value: (response: WorkerResponse) => responses.push(response),
      configurable: true,
      writable: true,
    });
    await import("./ts-worker.js");
  });

  it("offers the reader's own methods after `dry().`", () => {
    const labels = completionsAt(`const r = dry().;\n`, "dry().");
    expect(labels).toContain("collection");
    expect(labels).toContain("singleton");
  });

  it("offers the site's collection names inside `collection(\"\")`", () => {
    const labels = completionsAt(`const r = dry().collection("");\n`, 'collection("');
    expect(labels).toContain("blog");
    expect(labels).not.toContain("homepage");
  });

  it("offers the site's singleton names inside `singleton(\"\")`", () => {
    const labels = completionsAt(`const r = dry().singleton("");\n`, 'singleton("');
    expect(labels).toContain("homepage");
    expect(labels).not.toContain("blog");
  });

  it("offers the entry's own fields on an awaited result", () => {
    const code = `export default async function Page() {\n  const home = await dry().singleton("homepage").get();\n  home?.;\n}\n`;
    const labels = completionsAt(code, "home?.");
    expect(labels).toContain("headline");
    // `$` is `DryEntry`'s VEI ref map (`dry-vei.ts`) - present only if that
    // module resolved too, not just `dry-reader.ts` itself.
    expect(labels).toContain("$");
  });
});
