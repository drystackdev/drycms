import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { getContentAdapters } from "../content-adapters.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID, type PermissionAction } from "../../content-types/permissions.js";
import { isGitMirrorEligible, redactSecretFields } from "../../content-types/git-mirror.js";
import { buildEntryFieldTree } from "../../content-types/engine/entry-tree.js";
import { decodeEntryId } from "../../lib/id-hash.js";
import { loadGithubSyncConfig } from "./pages-source-github-sync.js";
import { commitContentChanges, getContentCommitDetail, listSnapshotCommits, readContentFileAtCommit } from "../git-source-sync.js";

const CONTENT_PREFIX = "[CONTENT] ";

/** Same `content/entries/<type>/<id>.json` / `content/types/<id>.json`
 * convention on both the read (this file's GET) and write (POST) side -
 * `plans/history-content.md`'s file-structure decision. `typeName` is
 * `CONTENT_TYPE_NAME_RE`-validated (`naming.ts`) and `schemaId`/`entryId`
 * are a UUID / integer respectively, so none of these can smuggle a `/` or
 * `..` into the path. */
function entryContentPath(typeName: string, entryId: number | null): string {
  return `content/entries/${typeName}/${entryId === null ? "singleton" : entryId}.json`;
}
function schemaContentPath(schemaId: string): string {
  return `content/types/${schemaId}.json`;
}

interface ResolvedTarget {
  path: string;
  checkAccess: () => Promise<Response | null>;
}

/** Resolves the ONE file (`?type=&entryId=` for an entry/singleton, or
 * `?schema=` for a content-type's own definition) this GET is scoped to, and
 * the exact permission grant that scope requires - reused by the list,
 * commit-detail, and file GET branches below so all three agree. */
async function resolveTarget(context: DryRouteContext): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; response: Response }> {
  const schemaId = context.url.searchParams.get("schema");
  if (schemaId) {
    return {
      ok: true,
      target: {
        path: schemaContentPath(schemaId),
        checkAccess: () => requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting"),
      },
    };
  }

  const typeName = context.url.searchParams.get("type");
  if (!typeName) {
    return { ok: false, response: jsonResponse({ error: "invalid_request", message: "A type or schema id is required." }, 400) };
  }
  const allTypes = await getContentAdapters(context).schema.listContentTypes();
  const type = allTypes.find((candidate) => candidate.name === typeName && candidate.kind !== "component");
  if (!type || !isGitMirrorEligible(type)) {
    return { ok: false, response: jsonResponse({ error: "not_found", message: `"${typeName}" has no content history.` }, 404) };
  }
  if (type.kind === "singleton") {
    return {
      ok: true,
      target: { path: entryContentPath(type.name, null), checkAccess: () => requirePermission(context, type.id, "setting") },
    };
  }
  const hashedEntryId = context.url.searchParams.get("entryId");
  const entryId = hashedEntryId ? decodeEntryId(hashedEntryId) : null;
  if (entryId === null) {
    return { ok: false, response: jsonResponse({ error: "invalid_request", message: "A valid entryId is required." }, 400) };
  }
  return {
    ok: true,
    target: { path: entryContentPath(type.name, entryId), checkAccess: () => requirePermission(context, type.id, "view") },
  };
}

/**
 * Read side of git-mirrored content history (`plans/history-content.md`) -
 * mirrors `page-history.ts`'s own `slug` dispatch (`""` list, `"commit"`
 * detail, `"file"` content) but scoped to ONE entry/singleton/schema's own
 * `content/` path per request, gated on THAT resource's own permission
 * (`resolveTarget` above) rather than the blanket Page Builder grant
 * `page-history.ts` uses - a content-only role can view an entry's own
 * history without ever having code-edit access.
 */
export const GET: DryRouteHandler = async (context) => {
  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ configured: false, reason: loaded.error });

  const resolved = await resolveTarget(context);
  if (!resolved.ok) return resolved.response;
  const denied = await resolved.target.checkAccess();
  if (denied) return denied;

  const slug = context.params.slug ?? "";
  const sha = context.url.searchParams.get("sha")?.trim() ?? "";

  if (slug === "") {
    const limit = Math.min(100, Math.max(1, Number(context.url.searchParams.get("limit")) || 30));
    const page = Math.max(1, Number(context.url.searchParams.get("page")) || 1);
    const result = await listSnapshotCommits(loaded.config, limit, { path: resolved.target.path, page });
    return result.ok ? jsonResponse({ configured: true, commits: result.commits }) : jsonResponse({ configured: true, commits: [], reason: result.reason });
  }
  if (!sha) return jsonResponse({ error: "invalid_request", message: "A commit sha is required." }, 400);
  if (slug === "commit") {
    const result = await getContentCommitDetail(loaded.config, sha);
    return result.ok ? jsonResponse(result) : jsonResponse({ error: "git_error", message: result.reason }, 502);
  }
  if (slug === "file") {
    const result = await readContentFileAtCommit(loaded.config, sha, resolved.target.path);
    return result.ok ? jsonResponse(result) : jsonResponse({ error: "git_error", message: result.reason }, 502);
  }
  return jsonResponse({ error: "not_found", message: "Unknown history operation." }, 404);
};

/** Wire format for one `POST` item: `{kind:"entry", typeName, entryId?, op}`
 * or `{kind:"schema", schemaId, op}` - matches client-side
 * `content-history-http-api.ts`'s `ContentChangeItem`. Validated below with
 * plain runtime checks (`RawChangeItem`) rather than a TS discriminated
 * union - see that type's own doc comment for why. */
type ChangeOp = "create" | "update" | "delete";

function isChangeOp(value: unknown): value is ChangeOp {
  return value === "create" || value === "update" || value === "delete";
}
function verbFor(op: ChangeOp): string {
  return op === "create" ? "Create" : op === "update" ? "Update" : "Delete";
}

/**
 * Write side - commits every item in `items` as ONE atomic git commit
 * (matching `commitPagesSourceChanges`'s own "one Save = one commit" shape),
 * message prefixed `[CONTENT] ` so `HistoryDialog.tsx`'s Content tab can
 * pick it out. Called by the client right after a real D1 write already
 * succeeded (`content-entries.ts`/`content-types.ts`) - every value is
 * re-fetched fresh from D1 here rather than trusted from the request body,
 * and every item is independently permission-checked and redacted
 * (`redactSecretFields`) server-side, since this endpoint publishes to a
 * (possibly third-party-hosted) git repo and must never trust the caller for
 * either "am I allowed" or "is this safe to publish".
 */
export const POST: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  if ((context.params.slug ?? "") !== "") {
    return jsonResponse({ error: "not_found", message: "Unknown history operation." }, 404);
  }

  const loaded = await loadGithubSyncConfig(context);
  if ("error" in loaded) return jsonResponse({ committed: false, reason: loaded.error }, 412);

  const body = (await context.request.json()) as { items?: unknown };
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
    return jsonResponse({ error: "invalid_request", message: "Between 1 and 50 items are required." }, 400);
  }

  const { schema, entries: entryAdapter } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();

  const files: Record<string, string | null> = {};
  const labels: string[] = [];
  const ops = new Set<ChangeOp>();

  // A flat, all-optional shape rather than a discriminated union over
  // `unknown` request-body JSON (that collapses `kind` to `never` under
  // `Partial<>`) - every field is validated with plain `typeof`/equality
  // checks below instead of relying on TS's own discriminant narrowing.
  interface RawChangeItem {
    kind?: unknown;
    op?: unknown;
    typeName?: unknown;
    entryId?: unknown;
    schemaId?: unknown;
  }

  for (const raw of body.items as RawChangeItem[]) {
    if (!raw || typeof raw !== "object" || !isChangeOp(raw.op)) {
      return jsonResponse({ error: "invalid_request", message: "Malformed change item." }, 400);
    }
    const op = raw.op;
    ops.add(op);

    if (raw.kind === "schema") {
      if (typeof raw.schemaId !== "string" || !raw.schemaId) {
        return jsonResponse({ error: "invalid_request", message: "A schemaId is required." }, 400);
      }
      const schemaId = raw.schemaId;
      const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting");
      if (denied) return denied;

      if (op === "delete") {
        files[schemaContentPath(schemaId)] = null;
        labels.push(`schema ${schemaId}`);
        continue;
      }
      const definition = await schema.getContentType(schemaId);
      if (!definition || !isGitMirrorEligible(definition)) {
        return jsonResponse({ error: "not_found", message: `Content type "${schemaId}" not found.` }, 404);
      }
      files[schemaContentPath(definition.id)] = JSON.stringify(definition, null, 2);
      labels.push(definition.label || definition.name);
      continue;
    }

    if (raw.kind !== "entry" || typeof raw.typeName !== "string") {
      return jsonResponse({ error: "invalid_request", message: "Malformed change item." }, 400);
    }
    const typeName = raw.typeName;
    const type = allTypes.find((candidate) => candidate.name === typeName && candidate.kind !== "component");
    if (!type || !isGitMirrorEligible(type)) {
      return jsonResponse({ error: "not_found", message: `Content type "${typeName}" not found.` }, 404);
    }
    const action: PermissionAction = type.kind === "singleton" ? "setting" : op;
    const denied = await requirePermission(context, type.id, action);
    if (denied) return denied;

    const hashedEntryId = typeof raw.entryId === "string" ? raw.entryId : null;
    const entryId = type.kind === "singleton" ? null : hashedEntryId ? decodeEntryId(hashedEntryId) : null;
    if (type.kind !== "singleton" && entryId === null) {
      return jsonResponse({ error: "invalid_request", message: "A valid entryId is required." }, 400);
    }
    const path = entryContentPath(type.name, entryId);
    const label = `${type.label || type.name}${entryId === null ? "" : ` #${entryId}`}`;

    if (op === "delete") {
      files[path] = null;
      labels.push(label);
      continue;
    }
    const row = type.kind === "singleton"
      ? await entryAdapter.getSingletonEntry(type, allTypes)
      : await entryAdapter.getEntry(type, allTypes, entryId as number);
    if (!row) return jsonResponse({ error: "not_found", message: "The entry no longer exists." }, 404);

    const nodes = buildEntryFieldTree(type, allTypes);
    files[path] = JSON.stringify(redactSecretFields(nodes, row.value), null, 2);
    labels.push(label);
  }

  const firstOp = ops.size === 1 ? [...ops][0] : undefined;
  const verb = firstOp ? verbFor(firstOp) : "Update";
  const message =
    labels.length === 1
      ? `${CONTENT_PREFIX}${verb} ${labels[0]}`
      : labels.length <= 3
        ? `${CONTENT_PREFIX}${verb} ${labels.join(", ")}`
        : `${CONTENT_PREFIX}${verb} ${labels.length} content changes`;

  const author = {
    name: context.session.name || "drycms",
    email: `${context.session.id}@content-history.drycms`,
  };
  const result = await commitContentChanges(loaded.config, files, message, author);
  return result.ok ? jsonResponse({ committed: true, commitSha: result.commitSha }) : jsonResponse({ committed: false, reason: result.reason }, 502);
};
