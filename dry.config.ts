import { config } from "./src/server/options.js";

const isE2E = process.env.DRYCMS_E2E === "1";
const e2eDataRoot = "test-results/e2e-data";

/**
 * drycms's own configuration - see `src/server/options.ts`'s `DryOption` for
 * every field and its default. `config({ ... })` provides type checking and
 * editor completion while resolution and validation still happen at startup.
 */
export default config({
  ...(isE2E
    ? {
        // Playwright runs against a disposable app state so E2E never changes
        // the developer's local content database or uploaded assets.
        storage: { kind: "local" as const, root: `${e2eDataRoot}/storage` },
        icons: { kind: "local" as const, root: `${e2eDataRoot}/icons` },
        content: { engine: "sqlite" as const, file: `${e2eDataRoot}/content.sqlite` },
        components: { storage: { kind: "local" as const, root: `${e2eDataRoot}/components` } },
        kv: { kind: "local" as const, root: `${e2eDataRoot}/kv` },
      }
    : {}),
  // Local development uses the installed Codex CLI. For a deployed server,
  // switch to e.g. `{ mode: "server", keyName: "OpenAI" }`; the key is read from the Ai Key collection.
  ai: { mode: "server" },
});
