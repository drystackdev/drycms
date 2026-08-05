import { describe, expect, it } from "vitest";
import { path as adminPath } from "./config.js";
import { handleVeiRoute } from "./vei-routes.js";
import { VEI_COOKIE_NAME } from "./vei-session.js";

const ENTER = `http://localhost${adminPath}/vei/enter`;
const EXIT = `http://localhost${adminPath}/vei/exit`;

/** A real browser navigation - the only shape these routes accept. */
function navigation(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "same-origin", ...headers } });
}

describe("handleVeiRoute", () => {
  it("ignores everything that isn't one of its two routes", async () => {
    expect(await handleVeiRoute(navigation("http://localhost/"))).toBeNull();
    expect(await handleVeiRoute(navigation(`http://localhost${adminPath}/dashboard`))).toBeNull();
    expect(await handleVeiRoute(navigation(`http://localhost${adminPath}/vei`))).toBeNull();
  });

  it("rejects a non-GET", async () => {
    const response = await handleVeiRoute(new Request(EXIT, { method: "POST" }));
    expect(response?.status).toBe(405);
  });

  it("rejects anything that isn't a top-level navigation", async () => {
    expect((await handleVeiRoute(navigation(EXIT, { "Sec-Fetch-Dest": "image" })))?.status).toBe(403);
    expect((await handleVeiRoute(navigation(EXIT, { "Sec-Fetch-Dest": "empty" })))?.status).toBe(403);
    expect((await handleVeiRoute(navigation(EXIT, { "Sec-Fetch-Site": "cross-site" })))?.status).toBe(403);
  });

  it("allows a client that sends no Sec-Fetch headers at all (curl, tests)", async () => {
    const response = await handleVeiRoute(new Request(EXIT));
    expect(response?.status).toBe(303);
  });

  it("clears the cookie and returns to the given page on exit", async () => {
    const response = await handleVeiRoute(navigation(`${EXIT}?to=%2Fblogs%2Fhello`));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe("http://localhost/blogs/hello");
    expect(response?.headers.get("Set-Cookie")).toContain(`${VEI_COOKIE_NAME}=;`);
    expect(response?.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(response?.headers.get("Set-Cookie")).toContain("Path=/");
  });

  it("refuses to redirect off-origin or into the admin app", async () => {
    const offOrigin = await handleVeiRoute(navigation(`${EXIT}?to=%2F%2Fevil.test%2Fx`));
    expect(offOrigin?.headers.get("Location")).toBe("http://localhost/");
    const absolute = await handleVeiRoute(navigation(`${EXIT}?to=https%3A%2F%2Fevil.test`));
    expect(absolute?.headers.get("Location")).toBe("http://localhost/");
    const intoAdmin = await handleVeiRoute(navigation(`${EXIT}?to=${encodeURIComponent(`${adminPath}/dashboard`)}`));
    expect(intoAdmin?.headers.get("Location")).toBe("http://localhost/");
  });

  it("sends an unauthenticated visitor to sign in instead of granting edit mode", async () => {
    const response = await handleVeiRoute(navigation(`${ENTER}?to=%2F`));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("Location")).toBe(`http://localhost${adminPath}/login`);
    expect(response?.headers.get("Set-Cookie")).toBeNull();
  });
});
