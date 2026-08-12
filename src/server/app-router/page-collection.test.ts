import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { collectionTypeForPageSource } from "./page-collection.js";

function type(name: string, overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: `${name}-id`, kind: "collection", name, label: name, fields: [], version: 0, features: { slug: true }, ...overrides };
}

const ARTICLE = type("demoArticle");
const SETTING = type("setting", { features: {} });
const LANDING = type("demoLanding", { kind: "singleton" });
const ALL = [ARTICLE, SETTING, LANDING];

describe("collectionTypeForPageSource", () => {
  it("reads the collection a dynamic page gets its entry from", () => {
    const source = `export default async function Page() {
      const { slug } = params();
      const article = await dry().collection("demoArticle").get(String(slug));
      return <h1>{article.heading}</h1>;
    }`;
    expect(collectionTypeForPageSource(source, ALL)).toBe(ARTICLE);
  });

  it("matches across the line breaks a formatter introduces", () => {
    const source = `const article = await dry()\n  .collection("demoArticle")\n  .get(slug);`;
    expect(collectionTypeForPageSource(source, ALL)).toBe(ARTICLE);
  });

  it("ignores a singleton read and a list read on the same page", () => {
    const source = `const landing = await dry().singleton("demoLanding").get();
      const related = await dry().collection("demoArticle").list({ pageSize: 3 });`;
    expect(collectionTypeForPageSource(source, ALL)).toBeNull();
  });

  it("skips a get() on a collection with no slug feature and keeps looking", () => {
    const source = `const header = await dry().collection("setting").get("main");
      const article = await dry().collection("demoArticle").get(slug);`;
    expect(collectionTypeForPageSource(source, ALL)).toBe(ARTICLE);
  });

  it("returns null for an unknown collection name, and for no source at all", () => {
    expect(collectionTypeForPageSource(`dry().collection("gone").get(slug)`, ALL)).toBeNull();
    expect(collectionTypeForPageSource(undefined, ALL)).toBeNull();
  });

  /** The regex is `/g`, so a shared `lastIndex` would make consecutive calls
   * resume mid-string and miss a match the first call already passed. */
  it("is not stateful across calls", () => {
    const source = `dry().collection("demoArticle").get(slug)`;
    expect(collectionTypeForPageSource(source, ALL)).toBe(ARTICLE);
    expect(collectionTypeForPageSource(source, ALL)).toBe(ARTICLE);
  });
});
