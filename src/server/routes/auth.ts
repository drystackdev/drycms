import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { path as basePath } from "../config.js";
import { ContentEntryError, type ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import { resolveAccess } from "../../content-types/access.js";
import { ContentEngineError } from "../../content-types/engine/types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { verifyPassword } from "../../lib/password-hash.js";
import { signSession } from "../../lib/session-token.js";
import { createAuthSession, revokeAllAuthSessions, revokeAuthSession, rotateAuthSession } from "../auth-security.js";
import { getContentAdapters } from "../content-adapters.js";
import { extractPackagedSeedAssets } from "../../content-types/seed-assets.js";
import { resolved } from "../config.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { REFRESH_COOKIE_NAME, SESSION_COOKIE_NAME } from "../session.js";
import { clearCsrfCookieHeader, csrfCookieHeader, createCsrfToken } from "../csrf.js";
import { clearVeiCookieHeader, clearVeiHintCookieHeader, veiHintCookieHeader } from "../vei-session.js";
import { VEI_RESOURCE_ID, permissionKeyFor } from "../../content-types/permissions.js";
import { clearLoginFailures, isLoginRateLimited, recordLoginFailure } from "../rate-limit.js";
import { RequestBodyLimitError } from "../request-limits.js";
import { readEnvVar } from "../options.js";

/**
 * The `auth` API route: session issuance for the built-in `user` collection
 * (see `content-types/seed.ts`) - sign-in, first-run Super Admin
 * registration, and sign-out. Deliberately does NOT gate any OTHER route on
 * having a valid session - see `docs/ARCHITECTURE.md`'s Permissions section.
 */

type AuthErrorCode = "already_setup" | "invalid_credentials" | "validation_failed" | "bootstrap_required" | "bootstrap_invalid";

class AuthError extends Error {
  code: AuthErrorCode;
  fieldErrors?: Record<string, string>;
  constructor(code: AuthErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  already_setup: 409,
  invalid_credentials: 401,
  validation_failed: 422,
  bootstrap_required: 503,
  bootstrap_invalid: 403,
  not_found: 404,
};

let firstAdminRegistration: Promise<void> | undefined;

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function withFirstAdminRegistrationLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = firstAdminRegistration ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  firstAdminRegistration = current;
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (firstAdminRegistration === current) firstAdminRegistration = undefined;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof RequestBodyLimitError) return jsonResponse({ error: "request_too_large", message: "Request body is too large." }, 413);
  if (error instanceof AuthError) {
    return jsonResponse({ error: error.code, message: error.message, fieldErrors: error.fieldErrors }, STATUS_BY_CODE[error.code] ?? 500);
  }
  if (error instanceof ContentEntryError) {
    return jsonResponse(
      { error: error.code, message: error.message, fieldErrors: error.fieldErrors },
      STATUS_BY_CODE[error.code] ?? 500,
    );
  }
  if (error instanceof ContentEngineError) {
    console.error("[drycms] auth content engine error", error);
    return jsonResponse({ error: error.code, message: "Internal server error." }, 500);
  }
  console.error("[drycms] auth route error", error);
  return jsonResponse({ error: "internal", message: "Internal server error." }, 500);
}

function findType(allTypes: ContentTypeDefinition[], name: string): ContentTypeDefinition {
  const type = allTypes.find((t) => t.name === name);
  if (!type) throw new Error(`[drycms] Content type "${name}" is missing - re-run seeding.`);
  return type;
}

interface SessionUser {
  id: number;
  name: string;
  email: string;
}

interface ClientSessionUser extends SessionUser {
  roles: string[];
  isSuperAdmin: boolean;
  permissions: string[];
}

async function resolveClientUser(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  roleType: ContentTypeDefinition,
  entry: { id: number; value: Record<string, unknown> },
  base: SessionUser,
): Promise<ClientSessionUser> {
  const roles = await resolveRoleLabels(entryAdapter, allTypes, roleType, entry.value.roles);
  const access = await resolveAccess(entryAdapter, allTypes, base);
  return {
    ...base,
    roles,
    isSuperAdmin: access?.isSuperAdmin === true,
    permissions: [...(access?.permissions ?? [])],
  };
}

/** Resolves `roleIds` (a `user` row's `roles` value - `manyToMany`, an array
 * of `role` ids) to their display names, for the client's own read-only
 * "Roles" display (`pages/Profile.tsx`) - deliberately NOT part of the
 * signed session token (`session-token.ts`'s `SessionPayload`), same
 * "resolved fresh every time, never cached" reasoning `content-types/
 * access.ts`'s `resolveAccess` already applies to permission checks: a role
 * un-assigned after sign-in must stop showing up without waiting for the
 * next login. */
async function resolveRoleLabels(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  roleType: ContentTypeDefinition,
  roleIds: unknown,
): Promise<string[]> {
  const ids = Array.isArray(roleIds) ? (roleIds as number[]) : [];
  if (ids.length === 0) return [];
  const roles = await Promise.all(ids.map((id) => entryAdapter.getEntry(roleType, allTypes, id)));
  return roles.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => String(r.value.name ?? ""));
}

/** Finds the (at most one, `email` is `unique`) `user` row matching `email`
 * exactly, case-insensitively - reuses the existing `listEntries` search
 * (already implemented by every engine for the entry list pages) instead of
 * adding a dedicated unique-lookup adapter method. `search` is a substring
 * match, so results still need the exact-match filter below. */
async function findUserByEmail(
  entryAdapter: ContentEntryEngineAdapter,
  userType: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
  email: string,
): Promise<{ id: number; name: string; email: string } | null> {
  const page = await entryAdapter.listEntries(userType, allTypes, {
    page: 0,
    pageSize: 25,
    search: email,
    searchableFields: ["email"],
  });
  const lower = email.trim().toLowerCase();
  const match = page.rows.find((row) => String(row.value.email ?? "").toLowerCase() === lower);
  if (!match) return null;
  return { id: match.id, name: String(match.value.name ?? ""), email: String(match.value.email ?? "") };
}

function sessionCookieHeader(context: DryRouteContext, value: string, maxAgeSeconds: number, name = SESSION_COOKIE_NAME): string {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${basePath}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (context.url.protocol === "https:") attrs.push("Secure");
  return attrs.join("; ");
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // refresh session lifetime

function withSessionCookies(response: Response, context: DryRouteContext, token: string, refreshToken: string, user: ClientSessionUser): Response {
  response.headers.append("Set-Cookie", sessionCookieHeader(context, token, 15 * 60));
  response.headers.append("Set-Cookie", sessionCookieHeader(context, refreshToken, SESSION_MAX_AGE_SECONDS, REFRESH_COOKIE_NAME));
  response.headers.append("Set-Cookie", csrfCookieHeader(context, createCsrfToken()));
  // Only offer the public-site "Edit" overlay to a user who actually holds
  // the VEI permission - see `permissions.ts`'s `VEI_RESOURCE_ID` doc
  // comment. A demoted user (still holding an old, longer-lived hint cookie)
  // gets it cleared here too, on their very next session refresh.
  const hasVeiAccess = user.isSuperAdmin || user.permissions.includes(permissionKeyFor(VEI_RESOURCE_ID, "setting"));
  response.headers.append(
    "Set-Cookie",
    hasVeiAccess ? veiHintCookieHeader(context.url, SESSION_MAX_AGE_SECONDS) : clearVeiHintCookieHeader(context.url),
  );
  return response;
}

function withClearedSessionCookie(response: Response, context: DryRouteContext): Response {
  response.headers.append("Set-Cookie", sessionCookieHeader(context, "", 0));
  response.headers.append("Set-Cookie", sessionCookieHeader(context, "", 0, REFRESH_COOKIE_NAME));
  response.headers.append("Set-Cookie", clearCsrfCookieHeader(context));
  // Both `Path=/` cookies go too - a signed-out browser must not keep
  // rendering edit markers on the public site, nor keep offering the
  // overlay's button (see `server/vei-session.ts`).
  response.headers.append("Set-Cookie", clearVeiCookieHeader(context.url));
  response.headers.append("Set-Cookie", clearVeiHintCookieHeader(context.url));
  return response;
}

async function hasAnyUser(entryAdapter: ContentEntryEngineAdapter, userType: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<boolean> {
  const page = await entryAdapter.listEntries(userType, allTypes, { page: 0, pageSize: 1 });
  return page.total > 0;
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const endpoint = context.params.slug;
    if (endpoint !== "session") return jsonResponse({ error: "not_found", message: `Unknown auth endpoint "${String(endpoint)}".` }, 404);

    const { schema: schemaAdapter, entries: entryAdapter } = getContentAdapters(context);
    const allTypes = await schemaAdapter.listContentTypes();
    const userType = findType(allTypes, "user");
    const roleType = findType(allTypes, "role");

    const anyUser = await hasAnyUser(entryAdapter, userType, allTypes);

    let user: ClientSessionUser | null = null;
    if (context.session) {
      const entry = await entryAdapter.getEntry(userType, allTypes, context.session.id);
      if (entry) user = await resolveClientUser(entryAdapter, allTypes, roleType, entry, context.session);
    }

    const response = jsonResponse({ hasAnyUser: anyUser, user });
    response.headers.append("Set-Cookie", csrfCookieHeader(context, createCsrfToken()));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: DryRouteHandler = async (context) => {
  try {
    const endpoint = context.params.slug;
    const { schema: schemaAdapter, entries: entryAdapter } = getContentAdapters(context);

    if (endpoint === "register-first-admin") {
      const bootstrapToken = readEnvVar("DRYCMS_BOOTSTRAP_TOKEN");
      if (!bootstrapToken || bootstrapToken.length < 32) {
        throw new AuthError("bootstrap_required", "Set DRYCMS_BOOTSTRAP_TOKEN (at least 32 characters) before creating the first administrator.");
      }
      const suppliedToken = context.request.headers.get("X-DryCMS-Bootstrap-Token") ?? "";
      if (!constantTimeEqual(suppliedToken, bootstrapToken)) {
        throw new AuthError("bootstrap_invalid", "The bootstrap token is invalid.");
      }

      return await withFirstAdminRegistrationLock(async () => {
        const allTypes = await schemaAdapter.listContentTypes();
        const userType = findType(allTypes, "user");
        const roleType = findType(allTypes, "role");

        if (await hasAnyUser(entryAdapter, userType, allTypes)) {
          throw new AuthError("already_setup", "An account already exists - sign in instead.");
        }

        // The one point that knows for certain this is a genuinely fresh
        // instance (no user yet) - extract a build-time-packaged
        // `seed-assets.zip` (if any) BEFORE creating the admin, so a failure
        // here fails the whole request instead of leaving a half-seeded
        // instance with an admin account already created (see
        // `plans/content-type-seed.md`). Content-type schema itself doesn't
        // need anything here - `content-types/seed.ts`'s every-boot seeding
        // already applies an app's own `dry.seed.json` (if any) before any
        // request is served.
        await extractPackagedSeedAssets(resolved);

        const body = (await context.request.json()) as { name?: unknown; email?: unknown; password?: unknown };
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (!name || !email || password.length < 12) {
          throw new AuthError("validation_failed", "Name, email, and a password of at least 12 characters are required.");
        }

        const rolePage = await entryAdapter.listEntries(roleType, allTypes, {
          page: 0,
          pageSize: 25,
          search: "Super Admin",
          searchableFields: ["name"],
        });
        const superAdminRole = rolePage.rows.find((row) => row.value.name === "Super Admin");
        if (!superAdminRole) {
          throw new Error('[drycms] The seeded "Super Admin" role is missing - check permissions.ts\'s boot seeding.');
        }

        const created = await entryAdapter.createEntry(userType, allTypes, {
          name,
          email,
          password: { hasExisting: false, new: password },
          roles: [superAdminRole.id],
        });

        const sessionUser: SessionUser = { id: created.id, name, email };
        const authSession = await createAuthSession(created.id, context.env);
        const token = await signSession(sessionUser, { sessionId: authSession.sessionId });
        const user = await resolveClientUser(entryAdapter, allTypes, roleType, created, sessionUser);
        return withSessionCookies(jsonResponse({ user }, 201), context, token, authSession.refreshToken, user);
      });
    }

    if (endpoint === "login") {
      const allTypes = await schemaAdapter.listContentTypes();
      const userType = findType(allTypes, "user");
      const roleType = findType(allTypes, "role");

      const body = (await context.request.json()) as { email?: unknown; password?: unknown };
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";

      const invalid = () => new AuthError("invalid_credentials", "Invalid email or password.");

      if (await isLoginRateLimited(context.request, email, context.env)) {
        return jsonResponse({ error: "rate_limited", message: "Too many sign-in attempts. Try again later." }, 429);
      }

      const found = email ? await findUserByEmail(entryAdapter, userType, allTypes, email) : null;
      if (!found) {
        await recordLoginFailure(context.request, email, context.env);
        throw invalid();
      }

      const raw = await entryAdapter.getRawEntry(userType, found.id);
      const storedHash = raw?.password;
      if (typeof storedHash !== "string" || !(await verifyPassword(password, storedHash))) {
        await recordLoginFailure(context.request, email, context.env);
        throw invalid();
      }

      await clearLoginFailures(context.request, email, context.env);

      const sessionUser: SessionUser = found;
      const authSession = await createAuthSession(found.id, context.env);
      const token = await signSession(sessionUser, { sessionId: authSession.sessionId });
      const entry = await entryAdapter.getEntry(userType, allTypes, found.id);
      const user = entry ? await resolveClientUser(entryAdapter, allTypes, roleType, entry, sessionUser) : null;
      if (!user) throw invalid();
      return withSessionCookies(jsonResponse({ user }), context, token, authSession.refreshToken, user);
    }

    if (endpoint === "refresh") {
      if (!context.refreshToken) return withClearedSessionCookie(unauthenticatedResponse(), context);
      const rotated = await rotateAuthSession(context.refreshToken, context.env);
      if (!rotated) return withClearedSessionCookie(unauthenticatedResponse(), context);
      const allTypes = await schemaAdapter.listContentTypes();
      const userType = findType(allTypes, "user");
      const roleType = findType(allTypes, "role");
      const entry = await entryAdapter.getEntry(userType, allTypes, rotated.session.userId);
      if (!entry) return withClearedSessionCookie(unauthenticatedResponse(), context);
      const sessionUser: SessionUser = {
        id: entry.id,
        name: String(entry.value.name ?? ""),
        email: String(entry.value.email ?? ""),
      };
      const token = await signSession(sessionUser, { sessionId: rotated.session.sessionId });
      const user = await resolveClientUser(entryAdapter, allTypes, roleType, entry, sessionUser);
      return withSessionCookies(jsonResponse({ user }), context, token, rotated.refreshToken, user);
    }

    if (endpoint === "update-profile") {
      if (!context.session) return unauthenticatedResponse();

      const allTypes = await schemaAdapter.listContentTypes();
      const userType = findType(allTypes, "user");
      const roleType = findType(allTypes, "role");

      const body = (await context.request.json()) as {
        name?: unknown;
        email?: unknown;
        currentPassword?: unknown;
        newPassword?: unknown;
      };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

      // Self-service edit, deliberately not routed through
      // `routes/content-entries.ts` (which gates writes on the "user"
      // collection's own edit permission - a regular user usually can't grant
      // themselves that just to rename their own account). Merges into the
      // FULL existing value (not just the submitted fields) before calling
      // `updateEntry` - that adapter call rewrites every relation-many field
      // present in `nodes` from whatever `value` holds (see
      // `entries-sqlite.ts`'s `writeChildFields`), so omitting `roles` here
      // would silently wipe this user's role assignments.
      const existing = await entryAdapter.getEntry(userType, allTypes, context.session.id);
      if (!existing) throw new AuthError("validation_failed", "Your account could not be found.");

      // A password change (unlike the admin content-entry editor's own
      // `password` field - see `PasswordChangeField.tsx`'s doc comment) is
      // self-service here, so it must re-prove identity: require and verify
      // the CURRENT password before accepting a new one, same check `login`
      // itself runs. `newPassword` alone (no `currentPassword`) is treated as
      // a validation error rather than silently ignored, so a client bug
      // can't accidentally drop an intended password change.
      if (newPassword) {
        if (!currentPassword) {
          throw new AuthError("validation_failed", "Enter your current password to set a new one.", {
            currentPassword: "Enter your current password.",
          });
        }
        const raw = await entryAdapter.getRawEntry(userType, context.session.id);
        const storedHash = raw?.password;
        if (typeof storedHash !== "string" || !(await verifyPassword(currentPassword, storedHash))) {
          throw new AuthError("invalid_credentials", "Incorrect current password.", {
            currentPassword: "Incorrect current password.",
          });
        }
        // Revoke every session before changing the credential. If the durable
        // security store is unavailable, fail the whole operation rather than
        // changing the password while leaving old sessions usable.
        await revokeAllAuthSessions(context.session.id, "password-change", context.env);
      }

      const updated = await entryAdapter.updateEntry(userType, allTypes, context.session.id, {
        ...existing.value,
        name,
        email,
        password: { hasExisting: true, ...(newPassword ? { new: newPassword } : {}) },
      });

      const sessionUser: SessionUser = {
        id: updated.id,
        name: String(updated.value.name ?? name),
        email: String(updated.value.email ?? email),
      };
      let authSessionId = context.sessionId;
      let refreshToken: string | undefined;
      if (newPassword || !authSessionId) {
        if (context.sessionId && !newPassword) await revokeAuthSession(context.sessionId, "rotation", context.env);
        const authSession = await createAuthSession(updated.id, context.env);
        authSessionId = authSession.sessionId;
        refreshToken = authSession.refreshToken;
      }
      const token = await signSession(sessionUser, { sessionId: authSessionId });
      if (!refreshToken) refreshToken = context.refreshToken ?? "";
      const user = await resolveClientUser(entryAdapter, allTypes, roleType, updated, sessionUser);
      return withSessionCookies(jsonResponse({ user }), context, token, refreshToken, user);
    }

    if (endpoint === "logout") {
      if (context.sessionId) await revokeAuthSession(context.sessionId, "logout", context.env);
      return withClearedSessionCookie(new Response(null, { status: 204 }), context);
    }

    return jsonResponse({ error: "not_found", message: `Unknown auth endpoint "${String(endpoint)}".` }, 404);
  } catch (error) {
    return errorResponse(error);
  }
};
