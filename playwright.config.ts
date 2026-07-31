import { defineConfig } from "@playwright/test";

// Relies on `bun run dev` (see `scripts/dev-server.mjs`) already running
// rather than a Playwright-owned `webServer` - the dev server's lifecycle is
// managed independently.
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
  },
});
