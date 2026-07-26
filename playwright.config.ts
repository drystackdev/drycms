import { defineConfig } from "@playwright/test";

// Relies on `astro dev --background` already running (see CLAUDE.md's
// workflow: `astro dev status`/`logs`/`stop`) rather than a Playwright-owned
// `webServer` - the dev server's lifecycle is managed independently.
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:4321",
  },
});
