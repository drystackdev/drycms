import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
  resolved: { path: "/dry", content: { engine: "sqlite" } },
}));

const { injectClientConfig } = await import("./client-config.js");

describe("client config injection", () => {
  it("places server config before the document head closes", () => {
    const html = injectClientConfig("<html><head></head><body></body></html>", {
      path: "/admin",
      contentEngine: "D1",
    });

    expect(html).toContain("window.__DRY_CONFIG__={\"path\":\"/admin\",\"contentEngine\":\"D1\"};");
    expect(html.indexOf("__DRY_CONFIG__")).toBeLessThan(html.indexOf("</head>"));
  });

  it("escapes HTML-sensitive config values inside the script", () => {
    const html = injectClientConfig("<html></html>", {
      path: "</script><script>alert(1)</script>",
      contentEngine: "sqlite",
    });

    expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>alert(1)");
  });
});
