import { describe, expect, it } from "vitest";
import type { Mark, Node as PMNode } from "prosemirror-model";
import { exportCleanHtml } from "./html.js";
import { schema } from "./schema.js";

/**
 * Covers `html.ts`'s inline mark export - the half that used to wrap every
 * ProseMirror text node in its own set of tags, so a single link/color span
 * whose text only partly overlapped another mark came out as several
 * adjacent `<a>`/`<span>` elements instead of one (the editor's own DOM,
 * built by ProseMirror's `DOMSerializer`, never split them - only the
 * exported HTML did). Export-side only, same DOM-free constraint
 * `grid.test.ts` documents for itself: the import half goes through
 * `DOMParser`, which this repo has no jsdom/happy-dom dependency to run
 * under vitest, and is covered by the real-browser Playwright checks.
 */

const bold = () => schema.marks.bold!.create();
const italic = () => schema.marks.italic!.create();
const underline = () => schema.marks.underline!.create();
const color = (value: string) => schema.marks.textColor!.create({ value });
const link = (href: string, target: string | null = null) => schema.marks.link!.create({ href, target });

function text(value: string, marks: Mark[] = []) {
  return schema.text(value, marks);
}

function docOf(...inline: PMNode[]) {
  return schema.nodes.doc!.create(null, schema.nodes.paragraph!.create(null, inline));
}

describe("exportCleanHtml inline marks", () => {
  it("writes each mark as its own tag", () => {
    expect(exportCleanHtml(docOf(text("a", [bold()])))).toBe("<p><strong>a</strong></p>");
    expect(exportCleanHtml(docOf(text("a", [italic()])))).toBe("<p><em>a</em></p>");
    expect(exportCleanHtml(docOf(text("a", [underline()])))).toBe("<p><u>a</u></p>");
    expect(exportCleanHtml(docOf(text("a", [color("#c81e1e")])))).toBe('<p><span style="color: #c81e1e">a</span></p>');
    expect(exportCleanHtml(docOf(text("a", [link("/x")])))).toBe('<p><a href="/x">a</a></p>');
  });

  it("adds rel only alongside an explicit target", () => {
    expect(exportCleanHtml(docOf(text("a", [link("/x", "_blank")])))).toBe(
      '<p><a href="/x" target="_blank" rel="noopener noreferrer">a</a></p>',
    );
  });

  it("keeps a link open across text nodes that only differ in other marks", () => {
    const doc = docOf(text("Hello", [bold(), link("/x")]), text(" world", [link("/x")]));
    expect(exportCleanHtml(doc)).toBe('<p><a href="/x"><strong>Hello</strong> world</a></p>');
  });

  it("keeps a color span open across an inner bold run", () => {
    const doc = docOf(text("red ", [color("#ff0000")]), text("bold", [color("#ff0000"), bold()]), text(" tail", [color("#ff0000")]));
    expect(exportCleanHtml(doc)).toBe('<p><span style="color: #ff0000">red <strong>bold</strong> tail</span></p>');
  });

  it("closes a run when the mark's own attrs change", () => {
    const doc = docOf(text("a", [link("/x")]), text("b", [link("/y")]));
    expect(exportCleanHtml(doc)).toBe('<p><a href="/x">a</a><a href="/y">b</a></p>');
  });

  it("keeps a run open across a marked hard break", () => {
    const doc = docOf(text("a", [bold()]), schema.nodes.hard_break!.create(null, null, [bold()]), text("b", [bold()]));
    expect(exportCleanHtml(doc)).toBe("<p><strong>a<br>b</strong></p>");
  });

  it("nests link outside color outside the formatting marks", () => {
    const marks = [bold(), italic(), underline(), color("#ff0000"), link("/x")];
    expect(exportCleanHtml(docOf(text("X", marks)))).toBe(
      '<p><a href="/x"><span style="color: #ff0000"><u><em><strong>X</strong></em></u></span></a></p>',
    );
  });

  it("escapes text and attribute values", () => {
    const doc = docOf(text("a < b & c", [link('/x?a=1&b="2"')]));
    expect(exportCleanHtml(doc)).toBe('<p><a href="/x?a=1&amp;b=&quot;2&quot;">a &lt; b &amp; c</a></p>');
  });
});
