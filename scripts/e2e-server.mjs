import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// Keep the test server completely separate from a developer's normal `.env`
// and local database. The paths are all below test-results/e2e-data, which is
// already ignored and is safe to recreate for every run.
const dataRoot = resolve(process.cwd(), "test-results/e2e-data");
rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(dataRoot, { recursive: true });
process.env.DRYCMS_E2E = "1";
process.env.PORT = process.env.PORT ?? "4173";
process.env.DRYCMS_SECRET_KEY = "drycms-e2e-secret-key-do-not-use-outside-tests";
process.env.DRYCMS_BOOTSTRAP_TOKEN = process.env.E2E_BOOTSTRAP_TOKEN ?? "drycms-e2e-bootstrap-token-do-not-use-outside-tests";

await import("./dev-server.mjs");
