import { describe, expect, it } from "vitest";
import { path as adminPath } from "./config.js";
import { handlePageRequest } from "./page-handler.js";

describe("handlePageRequest", () => {
  it("returns null for the admin's own path (exact and nested)", async () => {
    expect(await handlePageRequest(new Request(`http://localhost${adminPath}`))).toBeNull();
    expect(await handlePageRequest(new Request(`http://localhost${adminPath}/dashboard`))).toBeNull();
  });

  it("returns null when no src/apps/pages route matches the path", async () => {
    const response = await handlePageRequest(new Request("http://localhost/this-route-does-not-exist"));
    expect(response).toBeNull();
  });
});
