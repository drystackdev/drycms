import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import type { DryComponentRecord } from "./component-registry-types.js";
import { filteredCandidates, mentionAtCursor, scopedCandidates } from "./dry-component-mention-utils.js";

function record(name: string, refs: string[] = []): DryComponentRecord {
  return {
    name,
    label: name,
    description: "",
    requiredInput: true,
    type: "block",
    shadow: true,
    children: true,
    refs,
    props: {},
    defaults: {},
    sourcePath: "",
    enabled: true,
  };
}

function fakeView(text: string, from = text.length + 1): EditorView {
  return {
    state: {
      selection: {
        empty: true,
        from,
        $from: {
          parent: { isTextblock: true, textBetween: () => text } as unknown as PMNode,
          parentOffset: text.length,
        },
      },
    },
  } as unknown as EditorView;
}

describe("richtext component mentions", () => {
  it("only recognizes an @ token at the start of a run or after whitespace", () => {
    expect(mentionAtCursor(fakeView("hello @car"))).toMatchObject({ raw: "@car", query: "car", topLevel: false });
    expect(mentionAtCursor(fakeView("@@car"))).toMatchObject({ raw: "@@car", query: "car", topLevel: true });
    expect(mentionAtCursor(fakeView("hello@car"))).toBeNull();
    expect(mentionAtCursor(fakeView("hello @car next"))).toBeNull();
  });

  it("lists nested refs with dotted paths and fuzzy-matches them", () => {
    const child = record("carousel", ["slide"]);
    const root = { ...record("color-text", ["carousel"]), refRecords: [child, record("slide")] };
    const context = { pos: 1, node: {} as PMNode, record: root, path: "color-text" };
    const nested = scopedCandidates([root], context, false);
    expect(nested.map((candidate) => candidate.path)).toEqual(["color-text.carousel", "color-text.carousel.slide"]);
    expect(filteredCandidates(nested, "slid").map((candidate) => candidate.path)).toEqual(["color-text.carousel.slide"]);
  });

  it("uses only top-level records for @@", () => {
    const root = { ...record("color-text", ["carousel"]), refRecords: [record("carousel")] };
    expect(scopedCandidates([root], null, true).map((candidate) => candidate.path)).toEqual(["color-text"]);
  });
});
