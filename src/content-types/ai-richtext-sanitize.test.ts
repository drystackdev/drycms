import { describe, expect, it } from "vitest";
import { sanitizeAiRichTextHtml } from "./ai-richtext-sanitize.js";

describe("sanitizeAiRichTextHtml", () => {
  it("keeps allowed formatting tags untouched", () => {
    const html = "<p>Hello <strong>world</strong>, <em>this</em> is <u>fine</u>.</p>";
    expect(sanitizeAiRichTextHtml(html)).toBe(html);
  });

  it("strips <script> tags and their content entirely", () => {
    const html = '<p>safe</p><script>alert(1)</script>';
    expect(sanitizeAiRichTextHtml(html)).toBe("<p>safe</p>");
  });

  it("unwraps a disallowed tag but keeps its text", () => {
    const html = '<div onclick="evil()">still here</div>';
    expect(sanitizeAiRichTextHtml(html)).toBe("still here");
  });

  it("strips a javascript: href but keeps the tag/text", () => {
    const html = '<a href="javascript:alert(1)">click</a>';
    expect(sanitizeAiRichTextHtml(html)).toBe("<a>click</a>");
  });

  it("keeps a safe href and normalizes target=_blank with rel", () => {
    const html = '<a href="https://example.com" target="_blank">link</a>';
    expect(sanitizeAiRichTextHtml(html)).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
  });

  it("drops an img whose src is not in the allow-list", () => {
    const html = '<p><img src="photos/cover.jpg" alt="cover"></p>';
    expect(sanitizeAiRichTextHtml(html, new Set())).toBe("<p></p>");
  });

  it("keeps an img whose src is explicitly allowed", () => {
    const html = '<p><img src="photos/cover.jpg" alt="cover"></p>';
    expect(sanitizeAiRichTextHtml(html, new Set(["photos/cover.jpg"]))).toBe('<p><img src="photos/cover.jpg" alt="cover"></p>');
  });

  it("strips attributes not on an allowed tag's own allow-list", () => {
    const html = '<p style="color:red" onmouseover="evil()">text</p>';
    expect(sanitizeAiRichTextHtml(html)).toBe("<p>text</p>");
  });

  it("removes an iframe and its content", () => {
    const html = '<p>before</p><iframe src="https://evil.example"></iframe><p>after</p>';
    expect(sanitizeAiRichTextHtml(html)).toBe("<p>before</p><p>after</p>");
  });
});
