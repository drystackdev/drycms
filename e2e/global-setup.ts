import { mkdirSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_EMAIL ?? "e2e-admin@example.test";
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? "e2e-password-do-not-use-outside-tests";
const BOOTSTRAP_TOKEN = process.env.E2E_BOOTSTRAP_TOKEN ?? "drycms-e2e-bootstrap-token-do-not-use-outside-tests";

function csrfTokenFromState(state: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = state.cookies.find((candidate) => candidate.name === "drycms_csrf");
  if (!cookie) throw new Error("E2E setup could not find the CSRF cookie.");
  return decodeURIComponent(cookie.value);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0]?.use.baseURL ?? "http://127.0.0.1:4173");
  const context = await request.newContext({ baseURL });

  try {
    const session = await context.get("/dry/api/auth/session");
    if (!session.ok()) {
      throw new Error(`E2E setup could not load the auth session (${session.status()}).`);
    }

    const sessionBody = (await session.json()) as { hasAnyUser?: boolean };
    let authResponse;
    if (sessionBody.hasAnyUser) {
      authResponse = await context.post("/dry/api/auth/login", {
        data: { email: TEST_EMAIL, password: TEST_PASSWORD },
      });
    } else {
      authResponse = await context.post("/dry/api/auth/register-first-admin", {
        data: {
          name: "E2E Admin",
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        },
        headers: {
          "X-CSRF-Token": csrfTokenFromState(await context.storageState()),
          "X-DryCMS-Bootstrap-Token": BOOTSTRAP_TOKEN,
        },
      });
    }

    if (!authResponse.ok()) {
      const body = await authResponse.text();
      throw new Error(`E2E setup could not authenticate (${authResponse.status()}): ${body}`);
    }

    mkdirSync("test-results", { recursive: true });
    await context.storageState({ path: "test-results/e2e-storage-state.json" });
  } finally {
    await context.dispose();
  }
}
