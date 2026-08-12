import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  /**
   * One worker, deliberately: every spec talks to the SAME server
   * (`scripts/e2e-server.mjs` boots exactly one) backed by one SQLite file
   * and one storage root, and several of them create a content type and
   * apply it - a real schema migration. Run in parallel those contend on a
   * single-writer database, and the failure surfaces somewhere unrelated:
   * a Save whose navigation never happens, or a picked image whose field
   * never resolves. Which spec loses the race varies from run to run, which
   * is exactly what makes it expensive to debug.
   *
   * The suite is small (~22 tests, well under a minute serial), so this
   * costs little and removes a whole class of false failures. Revisit if
   * either the suite grows a lot or the tests stop sharing one database.
   */
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
    storageState: "test-results/e2e-storage-state.json",
  },
  webServer: {
    command: "bun scripts/e2e-server.mjs",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173/dry/api/auth/session",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
