import { config } from "./src/server/options.js";

/**
 * drycms's own configuration - see `src/server/options.ts`'s `DryOption` for
 * every field and its default. `config({ ... })` provides type checking and
 * editor completion while resolution and validation still happen at startup.
 */
export default config({
  // path: "/dry",
  // storage: { kind: "local", root: "storage" },
  // icons: { kind: "local", root: "icons" },
  // content: { engine: "sqlite" },
  // Local development uses the installed Codex CLI. For a deployed server,
  // switch to e.g. `{ mode: "server", keyName: "OpenAI" }`; the key is read from the Ai Key collection.
  ai: { mode: "server" },
});
