import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
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
