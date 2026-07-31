import { describe, expect, it } from "vitest";
import { IconValidationError, sanitizeSvg } from "./sanitize-svg.js";

describe("sanitizeSvg", () => {
  it("strips <script> tags and their content", () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  it("strips on* event-handler attributes", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0" onclick="alert(2)" fill="red"/></svg>',
    );
    expect(out).not.toContain("onload");
    expect(out).not.toContain("onclick");
    expect(out).toContain('fill="red"');
  });

  it("strips <foreignObject> and its content", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>bad</div></foreignObject><path d="M0 0"/></svg>',
    );
    expect(out).not.toContain("foreignObject");
    expect(out).not.toContain("<div>");
    expect(out).toContain("<path");
  });

  it("drops external href/xlink:href references but keeps local #fragment ones", () => {
    // Real fixture shape from Iconify's solar:home-bold body.
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<defs><path id="SVGEuPeJeiy" d="M12 2L2 9v13h20V9z"/></defs>' +
        '<use href="#SVGEuPeJeiy" fill="currentColor"/>' +
        '<use href="http://evil.com/x.svg#icon"/>' +
        "</svg>",
    );
    expect(out).toContain('href="#SVGEuPeJeiy"');
    expect(out).not.toContain("evil.com");
  });

  it("drops data: and javascript: href values", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)"/><use href="data:text/html,x"/></svg>',
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:");
  });

  it("is case-insensitive on tag/attribute names and always re-emits canonical SVG casing", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" ViewBox="0 0 1 1" OnLoad="alert(1)"><PATH d="M0 0" OnClick="alert(2)"/></svg>',
    );
    expect(out).toContain('viewBox="0 0 1 1"');
    expect(out).toContain("<path");
    expect(out).not.toContain("OnLoad");
    expect(out).not.toContain("OnClick");
  });

  it("preserves legitimate structural/presentation content", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>' +
        '<path d="M12 2L2 7" fill="currentColor"/>' +
        "</svg>",
    );
    expect(out).toContain("linearGradient");
    expect(out).toContain('stop-color="red"');
    expect(out).toContain('d="M12 2L2 7"');
  });

  it("fails closed: an unclosed <script> suppresses everything after it, not just its own tag", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)<path d="M0 0" fill="red"/></svg>',
    );
    expect(out).not.toContain("path");
    expect(out).not.toContain("alert");
  });

  it("throws IconValidationError when there is no <svg> root at all", () => {
    expect(() => sanitizeSvg("<script>alert(1)</script>")).toThrow(IconValidationError);
  });

  it("keeps the (now-harmless) empty <svg> shell rather than throwing when only its descendants are unsafe", () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(out).toContain("<svg");
    expect(out).not.toContain("script");
  });
});
