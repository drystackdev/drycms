import { signal } from "@preact/signals";
import { path } from "virtual:drycms/config";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

export type AuthStatus = "loading" | "needs-setup" | "anonymous" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

export class AuthApiError extends Error {}

/**
 * Drives `routers/App.tsx`'s `AuthGate`: `loadSession()` is called once on
 * app mount and decides which of the 3 pre-authenticated states to show
 * (`"needs-setup"` - no `user` row exists yet, the first-run Register Super
 * Admin page; `"anonymous"` - Sign in; `"authenticated"` - the real app).
 * A signal (like `store/dashboard.ts`/`store/content-types.ts`) rather than
 * component state, since `AuthGate` sits ABOVE `DryLayout`/`<Router>` and
 * `DryLayout`'s own "Sign out" action needs to flip it back too.
 */
export const authState = signal<AuthState>({ status: "loading", user: null });

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function assertOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  const body = await readJson(res);
  throw new AuthApiError(typeof body.message === "string" ? body.message : fallback);
}

/** Reads `GET /api/auth/session` and sets `authState` accordingly - the one
 * call that decides which of the 3 gate states to show. Called once on app
 * mount (`AuthGate`) and again after `logout()`. */
export async function loadSession(): Promise<void> {
  authState.value = { status: "loading", user: authState.value.user };
  try {
    const res = await fetch(`${path}/api/auth/session`);
    await assertOk(res, "Failed to load session.");
    const body = await res.json();
    if (!body.hasAnyUser) {
      authState.value = { status: "needs-setup", user: null };
    } else if (body.user) {
      authState.value = { status: "authenticated", user: body.user };
    } else {
      authState.value = { status: "anonymous", user: null };
    }
  } catch {
    // A failed session check degrades to "anonymous" (show Sign in) rather
    // than getting stuck on the loading spinner forever - Sign in's own
    // submit will surface a real error if the server is genuinely down.
    authState.value = { status: "anonymous", user: null };
  }
}

export async function registerFirstAdmin(name: string, email: string, password: string): Promise<void> {
  const res = await fetch(`${path}/api/auth/register-first-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  await assertOk(res, "Failed to create the Super Admin account.");
  const body = await res.json();
  authState.value = { status: "authenticated", user: body.user };
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${path}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  await assertOk(res, "Failed to sign in.");
  const body = await res.json();
  authState.value = { status: "authenticated", user: body.user };
}

export async function logout(): Promise<void> {
  await fetch(`${path}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  authState.value = { status: "anonymous", user: null };
}
