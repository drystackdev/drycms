import { describe, expect, it } from "vitest";
import { buildEntryFieldTree } from "../../content-types/engine/entry-tree.js";
import { defaultContentTypeDefinitions } from "../../content-types/seed.js";
import { SEO_DEFAULTS_TYPE_ID } from "../../content-types/system-fields.js";
import { editableEntryNodes } from "./editable-nodes.js";

describe("editableEntryNodes", () => {
  it("hides noIndex only from the built-in SEO Defaults form", () => {
    const types = defaultContentTypeDefinitions();
    const defaults = types.find((type) => type.id === SEO_DEFAULTS_TYPE_ID)!;
    const article = { ...defaults, id: "article", kind: "collection" as const, name: "article" };

    const defaultsSeo = editableEntryNodes(defaults, buildEntryFieldTree(defaults, types)).find((node) => node.kind === "flatten");
    const articleSeo = editableEntryNodes(article, buildEntryFieldTree(article, [...types, article])).find((node) => node.kind === "flatten");

    expect(defaultsSeo?.kind === "flatten" && defaultsSeo.children.map((child) => child.fieldName)).not.toContain("noIndex");
    expect(articleSeo?.kind === "flatten" && articleSeo.children.map((child) => child.fieldName)).toContain("noIndex");
  });
});
