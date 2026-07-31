import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content, path as basePath } from "../config.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../content-types/engine/index.js";
import { ContentEntryError, type ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import { ContentEngineError, type ContentEngineAdapter } from "../../content-types/engine/types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { verifyPassword } from "../../lib/password-hash.js";
import { signSession } from "../../lib/session-token.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { SESSION_COOKIE_NAME } from "../session.js";

/**
 * The `auth` API route: session issuance for the built-in `user` collection
 * (see `content-types/seed.ts`) - sign-in, first-run Super Admin
 * registration, and sign-out. Deliberately does NOT gate any OTHER route on
 * having a valid session - see `docs/ARCHITECTURE.md`'s Permissions section,
 * which already documents that as a separate, not-yet-done pass, same as
 * `role`/`permission` having a schema today with no enforcement.
 */

type AuthErrorCode = "already_setup" | "invalid_credentials" | "validation_failed";

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
  not_found: 404,
};

function errorResponse(error: unknown): Response {
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
    return jsonResponse({ error: error.code, message: error.message }, 500);
  }
  return jsonResponse(
    { error: "internal", message: error instanceof Error ? error.message : "Internal error." },
    500,
  );
}

/** Same module-cache/fresh-per-request adapter split as `content-entries.ts`. */
const moduleSchemaAdapter: ContentEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEngineAdapter(content) : undefined;
const moduleEntryAdapter: ContentEntryEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEntryEngineAdapter(content) : undefined;

function getSchemaAdapter(context: DryRouteContext): ContentEngineAdapter {
  return moduleSchemaAdapter ?? createContentEngineAdapter(content, context.env);
}

function getEntryAdapter(context: DryRouteContext): ContentEntryEngineAdapter {
  return moduleEntryAdapter ?? createContentEntryEngineAdapter(content, context.env);
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

function sessionCookieHeader(context: DryRouteContext, value: string, maxAgeSeconds: number): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=${basePath}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (context.url.protocol === "https:") attrs.push("Secure");
  return attrs.join("; ");
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches session-token.ts's own token expiry

function withSessionCookie(response: Response, context: DryRouteContext, token: string): Response {
  response.headers.set("Set-Cookie", sessionCookieHeader(context, token, SESSION_MAX_AGE_SECONDS));
  return response;
}

function withClearedSessionCookie(response: Response, context: DryRouteContext): Response {
  response.headers.set("Set-Cookie", sessionCookieHeader(context, "", 0));
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

    const schemaAdapter = getSchemaAdapter(context);
    const entryAdapter = getEntryAdapter(context);
    const allTypes = await schemaAdapter.listContentTypes();
    const userType = findType(allTypes, "user");
    const roleType = findType(allTypes, "role");

    const anyUser = await hasAnyUser(entryAdapter, userType, allTypes);

    let user: (SessionUser & { roles: string[] }) | null = null;
    if (context.session) {
      const entry = await entryAdapter.getEntry(userType, allTypes, context.session.id);
      const roles = entry ? await resolveRoleLabels(entryAdapter, allTypes, roleType, entry.value.roles) : [];
      user = { ...context.session, roles };
    }

    return jsonResponse({ hasAnyUser: anyUser, user });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: DryRouteHandler = async (context) => {
  try {
    const endpoint = context.params.slug;
    const schemaAdapter = getSchemaAdapter(context);
    const entryAdapter = getEntryAdapter(context);

    if (endpoint === "register-first-admin") {
      const allTypes = await schemaAdapter.listContentTypes();
      const userType = findType(allTypes, "user");
      const roleType = findType(allTypes, "role");

      if (await hasAnyUser(entryAdapter, userType, allTypes)) {
        throw new AuthError("already_setup", "An account already exists - sign in instead.");
      }

      const body = (await context.request.json()) as { name?: unknown; email?: unknown; password?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";

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
      const token = await signSession(sessionUser);
      const roles = [String(superAdminRole.value.name ?? "Super Admin")];
      return withSessionCookie(jsonResponse({ user: { ...sessionUser, roles } }, 201), context, token);
    }

    if (endpoint === "login") {
      const allTypes = await schemaAdapter.listContentTypes();
      const userType = findType(allTypes, "user");
      const roleType = findType(allTypes, "role");

      const body = (await context.request.json()) as { email?: unknown; password?: unknown };
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";

      const invalid = () => new AuthError("invalid_credentials", "Invalid email or password.");

      const found = email ? await findUserByEmail(entryAdapter, userType, allTypes, email) : null;
      if (!found) throw invalid();

      const raw = await entryAdapter.getRawEntry(userType, found.id);
      const storedHash = raw?.password;
      if (typeof storedHash !== "string" || !(await verifyPassword(password, storedHash))) {
        throw invalid();
      }

      const sessionUser: SessionUser = found;
      const token = await signSession(sessionUser);
      const entry = await entryAdapter.getEntry(userType, allTypes, found.id);
      const roles = await resolveRoleLabels(entryAdapter, allTypes, roleType, entry?.value.roles);
      return withSessionCookie(jsonResponse({ user: { ...sessionUser, roles } }), context, token);
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
      const token = await signSession(sessionUser);
      const roles = await resolveRoleLabels(entryAdapter, allTypes, roleType, updated.value.roles);
      return withSessionCookie(jsonResponse({ user: { ...sessionUser, roles } }), context, token);
    }

    if (endpoint === "logout") {
      return withClearedSessionCookie(new Response(null, { status: 204 }), context);
    }

    return jsonResponse({ error: "not_found", message: `Unknown auth endpoint "${String(endpoint)}".` }, 404);
  } catch (error) {
    return errorResponse(error);
  }
};
