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
// The E2E global setup owns first-admin registration. Blank these explicitly
// so a developer's `.env` auto-bootstrap account cannot enter the otherwise
// isolated test database first and make the deterministic test login fail.
process.env.EMAIL_ADMIN = "";
process.env.PASSWORD_ADMIN = "";
// Same isolation for the git working copy (`server/git-config.ts` reads these
// from `.env` when `process.env` has none): a developer's real repository and
// PAT must never be cloned - let alone pushed to - by a test run, and the
// suite would otherwise depend on GitHub being reachable.
process.env.GITHUB_REPO = "";
process.env.GITHUB_BRANCH = "";
process.env.GITHUB_PAT_KEY = "";

await import("./dev-server.mjs");
