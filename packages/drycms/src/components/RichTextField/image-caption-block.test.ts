import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import { setImageAttrs } from "./commands.js";
import { DEFAULT_GRID_COLUMNS, schema } from "./schema.js";

/**
 * Covers `commands.ts`'s `setImageAttrs` caption transitions - the
 * `extractImageBlock`/`collapseImageBlock` split/merge it runs whenever a
 * `caption` patch crosses the empty<->non-empty boundary. DOM-free, same gap
 * `grid.test.ts` already notes for `image` (no existing unit tests) - this
 * fills that in for the one behavior that's pure doc-structure logic.
 */

function docOf(...blocks: PMNode[]) {
  return schema.nodes.doc!.create(null, blocks);
}

function paragraph(...content: PMNode[]) {
  return schema.nodes.paragraph!.create(null, content);
}

function image(attrs?: Partial<{ src: string; caption: string }>) {
  return schema.nodes.image!.create({ src: "a.png", caption: "", ...attrs });
}

function gridItem(text: string) {
  return schema.nodes.grid_item!.create({ colSpan: DEFAULT_GRID_COLUMNS, rowSpan: 1 }, paragraph(schema.text(text)));
}

function grid() {
  return schema.nodes.grid!.create(null, gridItem("cell"));
}

function runCommand(state: EditorState, command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) {
  let tr: Transaction | null = null;
  const ok = command(state, (t) => (tr = t));
  return { ok, next: tr ? state.apply(tr as Transaction) : state };
}

function findImagePos(doc: PMNode): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.image) found = pos;
  });
  if (found < 0) throw new Error("no image in doc");
  return found;
}

describe("setImageAttrs caption -> block split", () => {
  it("splits into a leading and trailing paragraph when text surrounds the image", () => {
    const doc = docOf(paragraph(schema.text("before "), image(), schema.text(" after")));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "cap" }));

    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(0).textContent).toBe("before ");
    expect(next.doc.child(1).childCount).toBe(1);
    expect(next.doc.child(1).firstChild!.type).toBe(schema.nodes.image);
    expect(next.doc.child(1).firstChild!.attrs.caption).toBe("cap");
    expect(next.doc.child(2).textContent).toBe(" after");
  });

  it("inserts the new block right after when the image was flush against the end", () => {
    const doc = docOf(paragraph(schema.text("before "), image()));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "cap" }));

    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).textContent).toBe("before ");
    expect(next.doc.child(1).firstChild!.type).toBe(schema.nodes.image);
  });

  it("inserts the new block right before when the image was flush against the start", () => {
    const doc = docOf(paragraph(image(), schema.text(" after")));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "cap" }));

    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).firstChild!.type).toBe(schema.nodes.image);
    expect(next.doc.child(1).textContent).toBe(" after");
  });

  it("no-ops structurally when the image already has its paragraph to itself", () => {
    const doc = docOf(paragraph(image()));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "cap" }));

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).childCount).toBe(1);
    expect(next.doc.child(0).firstChild!.attrs.caption).toBe("cap");
  });
});

describe("setImageAttrs caption -> block collapse", () => {
  it("merges into the previous paragraph when the image is alone in its own block", () => {
    const doc = docOf(paragraph(schema.text("before")), paragraph(image({ caption: "cap" })));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "" }));

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).childCount).toBe(2);
    expect(next.doc.child(0).child(0).text).toBe("before");
    expect(next.doc.child(0).child(1).type).toBe(schema.nodes.image);
  });

  it("falls back to the next paragraph when there's no textblock before it", () => {
    const doc = docOf(paragraph(image({ caption: "cap" })), paragraph(schema.text("after")));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "" }));

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).childCount).toBe(2);
    expect(next.doc.child(0).child(0).type).toBe(schema.nodes.image);
    expect(next.doc.child(0).child(1).text).toBe("after");
  });

  it("leaves the image in its own block when neither neighbor can take inline content", () => {
    const doc = docOf(grid(), paragraph(image({ caption: "cap" })), grid());
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "" }));

    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(1).type).toBe(schema.nodes.paragraph);
    expect(next.doc.child(1).firstChild!.type).toBe(schema.nodes.image);
  });

  it("leaves the image alone when it's the only block in the doc", () => {
    const doc = docOf(paragraph(image({ caption: "cap" })));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "" }));

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).firstChild!.type).toBe(schema.nodes.image);
    expect(next.doc.child(0).firstChild!.attrs.caption).toBe("");
  });

  it("does not collapse when the image still shares its paragraph with other content", () => {
    const doc = docOf(paragraph(schema.text("x "), image({ caption: "cap" })));
    const state = EditorState.create({ schema, doc });
    const { next } = runCommand(state, setImageAttrs(findImagePos(doc), { caption: "" }));

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).childCount).toBe(2);
  });
});
