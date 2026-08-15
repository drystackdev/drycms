/**
 * `status/mcp-server.md` - a Model Context Protocol server exposing the same
 * read/write actions Magic Chat already runs server-side (`kind: fetch`'s
 * `executeMagicFetch`, and the field-coercion `kind: fields`/`kind: create`
 * both share, `applyMagicWriteFields`) as MCP tools, so an external MCP
 * client (Claude Desktop, Claude Code, ...) can read/write this instance's
 * content directly. Authenticated by a Personal Access Token
 * (`auth-security.ts`'s `createMcpToken`/`resolveMcpToken`) resolved by
 * `handler.ts` before dispatch - every tool call below can assume
 * `context.session` is the real signed-in user the token belongs to, and
 * every permission check re-runs `checkAccess`/`supportsMagic` exactly the
 * way Magic Chat's own server loop does, so an MCP client can never do
 * anything the token's owner couldn't already do through the admin UI.
 *
 * Hand-rolled JSON-RPC (the MCP "Streamable HTTP" transport, stateless mode -
 * no `Mcp-Session-Id`, no server-push SSE stream) rather than pulling in the
 * `@modelcontextprotocol/sdk` package: this codebase already hand-rolls its
 * own session JWT (`lib/session-token.ts`) instead of a `jsonwebtoken`
 * dependency for the same reason - the wire format here (a handful of
 * JSON-RPC methods) is small and stable enough that owning it outright beats
 * an extra dependency, and the SDK's transports assume a Node
 * request/response pair this Fetch-API-shaped server (`context.ts`'s
 * `DryRouteHandler`) doesn't have.
 */
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse } from "../route-helpers.js";
import { storage, pagesSourceStorage, path as adminBasePath, lang as siteLang } from "../config.js";
import { resolveSiteOrigin } from "../app-router/site-origin.js";
import { protectedResourceMetadataUrl } from "../oauth-metadata.js";
import { checkPageSourceBuild } from "../../page-components/page-source-preview.js";
import { getContentAdapters } from "../content-adapters.js";
import { getAuthSecurityStore } from "../auth-security.js";
import { checkAccess } from "./content-entries.js";
import { executeMagicFetch } from "./ai-magic-write-fetch.js";
import { readGeneratedDryTypes, writeGeneratedDryTypes } from "../../content-types/types-cache.js";
import { generateDryTypes } from "../../content-types/codegen.js";
import { PAGE_SOURCE_DOCS } from "../../page-components/ai-page-source-docs.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { applyMagicWriteFields, type AllowedRelationIds } from "../../content-types/ai-magic-write-fields.js";
import { supportsMagic, PAGE_BUILDER_RESOURCE_ID, CONTENT_TYPES_RESOURCE_ID } from "../../content-types/permissions.js";
import type { ContentTypeDefinition, FieldDefinition } from "../../content-types/types.js";
import { fieldTypes } from "../../content-types/field-registry.js";
import type { MagicWriteFetchTurn, MagicWriteRawFields, MagicWriteRawValue } from "../../content-types/ai-magic-write-protocol.js";
import { requirePermission } from "../admin-access.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { normalizeStoragePath } from "../../storage/path.js";
import { requirePageSourceFileName } from "./pages-source.js";
import { validateContentTypeDefinition, NamingError } from "../../content-types/naming.js";
import { randomUUID } from "../../lib/uuid.js";
import { saveAiContentTypeDraft, listAiContentTypeDrafts, type AiContentTypeDraft } from "../ai-content-type-drafts.js";
import { markAiPageSourceWrite } from "../ai-page-source-flags.js";
import { decodeEntryId } from "../../lib/id-hash.js";

const PROTOCOL_VERSION = "2025-06-18";
// Nothing this server exposes (tools only - no resources/prompts/sampling,
// no server-initiated stream) differs between these revisions, so an
// `initialize` asking for any of them is answered in its own version rather
// than forcing a downgrade. `2025-11-25` is what claude.ai's connector sends
// today (`mcp-protocol-version` header, seen in `wrangler tail`).
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = { name: "drycms", version: "0.0.1" };

/** Sent once, in `initialize`'s result - the closest thing this server has
 * to a system prompt for an external MCP client. Orients it before it makes
 * its first tool call: the 4 page-source roots, where this project's own
 * admin-authored notes live, and - the single most common mistake an AI
 * editing drycms makes - to check `read_dry_types` for real collection/field
 * names before writing a `dry()` call rather than guessing (see
 * `docs/APP-ROUTER.md`'s own warning about this, fetchable via `read_doc`). */
const MCP_INSTRUCTIONS = [
  'This is drycms, a headless CMS. Page/layout/component source lives under 4 roots inside "pages-source": "pages/" (routes - page.tsx/layout.tsx/404.tsx/500.tsx), "component/" (reusable .tsx components, imported as @component/Name), "styles/" (Tailwind CSS), and "md/" (this project\'s own admin-authored Markdown notes for AI - read "md/README.md" first via read_page_source if it exists).',
  "Before writing or editing any dry() call in a page/component, call read_dry_types to see this project's REAL, current collection/singleton names and field shapes - never guess a field name, it changes as the content schema evolves. list_content_types/list_entries/get_entry preview the actual data a dry() call would render.",
  'For drycms\'s own developer documentation (routing conventions, the dry() API, styling rules, the content-type model, deployment), call list_docs then read_doc - read "docs/APP-ROUTER.md" before writing any page-source code.',
  "write_page_source saves straight to storage immediately - unlike the admin's own Page Editor UI there is no draft/review step here - but the change still needs a Build (from the admin's Page Editor) before it reaches the live site. Use preview_page_source to confirm a static page.tsx compiles and renders before considering a change done.",
  "propose_content_type is the ONE exception to \"applies immediately\": it never touches the live schema - it saves a pending draft the admin reviews and applies themselves under Content Types -> Apply and build, matching by \"name\" to propose an update to an existing type or a new one otherwise.",
].join("\n\n");

class McpError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface JsonRpcRequestBody {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

interface ToolResult {
  text: string;
  isError?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "list_content_types",
    description: "List every content type (collection/singleton) defined in this drycms instance.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_entries",
    description: "List entries in a collection, optionally filtered by a free-text search.",
    inputSchema: {
      type: "object",
      properties: {
        typeSlug: { type: "string", description: "The content type's name, e.g. \"post\"." },
        search: { type: "string", description: "Optional free-text filter." },
      },
      required: ["typeSlug"],
      additionalProperties: false,
    },
  },
  {
    name: "get_entry",
    description: "Get one entry (collection) by id, or a singleton's own entry.",
    inputSchema: {
      type: "object",
      properties: {
        typeSlug: { type: "string", description: "The content type's name." },
        id: { type: "string", description: "The entry's numeric id. Ignored for a singleton." },
      },
      required: ["typeSlug"],
      additionalProperties: false,
    },
  },
  {
    name: "list_media",
    description: "List files and folders in the media library.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path. Root when omitted." } },
      additionalProperties: false,
    },
  },
  {
    name: "create_entry",
    description:
      "Create a new entry in a collection. Plain scalar fields (text/richtext/number/boolean/date/select) and relation fields are both supported - image fields must still be set afterward in the admin UI. For a relation field, use the target entry's real numeric id: a single id for a manyToOne field (e.g. \"author\": 12), or an array (or comma-separated string) of ids for oneToMany/manyToMany (e.g. \"tags\": [12, 45]). The id must belong to an entry that actually exists in that field's target collection AND that you have view access to - look it up first with list_entries/get_entry (use read_dry_types or list_content_types if you don't know the target collection's name). An id that doesn't resolve is silently dropped, not an error.",
    inputSchema: {
      type: "object",
      properties: {
        typeSlug: { type: "string", description: "The target collection's name." },
        fields: { type: "object", description: "Field name -> value. For a relation field, a target entry id (or array/comma-list of ids) - see this tool's description.", additionalProperties: true },
      },
      required: ["typeSlug", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "update_entry_fields",
    description:
      "Update fields on an existing entry (collection) or a singleton. Same field support as create_entry - plain scalar fields and relation fields (by real target entry id), image fields still excluded.",
    inputSchema: {
      type: "object",
      properties: {
        typeSlug: { type: "string", description: "The content type's name." },
        id: { type: "string", description: "The entry's numeric id. Omit for a singleton." },
        fields: { type: "object", description: "Field name -> value. For a relation field, a target entry id (or array/comma-list of ids) - see create_entry's description.", additionalProperties: true },
      },
      required: ["typeSlug", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "list_page_source",
    description: "List files and folders in the page-source tree (pages/, component/, styles/, md/ - the last holds admin-authored Markdown context notes for AI, entry point \"md/README.md\").",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path. Root when omitted." } },
      additionalProperties: false,
    },
  },
  {
    name: "read_page_source",
    description: "Read the raw text of one page/layout/component/stylesheet/md-context source file. Start with \"md/README.md\" for this project's own admin-authored context notes, if any exist.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "The file's path, e.g. \"pages/blog/page.tsx\" or \"component/Card.tsx\"." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_page_source",
    description:
      "Create or overwrite one page-source file's raw text. Writes immediately to storage - unlike the Page Editor's own UI, there is no separate draft/Save step here.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's path. Must end in \".tsx\"/\".ts\" (pages/component root), \".css\" (styles root), or \".md\" (md root)." },
        code: { type: "string", description: "The file's complete new contents." },
      },
      required: ["path", "code"],
      additionalProperties: false,
    },
  },
  {
    name: "preview_page_source",
    description:
      "Compile and render a page.tsx route (with its layout chain) to check it works, returning the resulting HTML. Content data is NOT real - every dry() call resolves to empty/null, so this checks that the code compiles and renders without crashing, not what a real visitor would see. Only static routes (no [param] segments) are supported.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "The page.tsx file's path, e.g. \"pages/about/page.tsx\" or \"pages/page.tsx\"." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_dry_types",
    description:
      "Read this project's generated TypeScript ambient types for dry() - the real, current collection/singleton names and field shapes, straight from the live content schema. Always check this before writing or editing a dry() call in a page/component - never guess a collection or field name.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_docs",
    description: "List this repo's own developer documentation files - routing conventions, the dry() API, styling rules, the content-type/field model, deployment.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_doc",
    description: "Read one of this repo's own documentation files by path (see list_docs). Start with \"docs/APP-ROUTER.md\" before writing page-source code - it covers routing conventions and the dry() API.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "The doc's path, e.g. \"docs/APP-ROUTER.md\"." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_content_type",
    description:
      "Propose creating a new content type, or updating an existing one, by full JSON definition. NEVER applied directly - saved as a PENDING draft the admin reviews and applies (or discards) themselves under Content Types -> Apply and build, exactly like a draft they typed by hand. Matching by \"name\" against an existing content type proposes an update to it; a name that doesn't exist yet proposes a new one. Deleting a content type isn't supported by this tool.",
    inputSchema: {
      type: "object",
      properties: {
        definitionJson: {
          type: "string",
          description:
            "The full content type definition as a JSON string: at least \"name\", \"label\", \"kind\" (\"collection\"|\"singleton\"|\"component\"), and \"fields\" (an array, may be empty). Omit \"id\"/\"version\" - they're assigned/looked up server-side. Each field needs \"id\", \"name\", \"label\", \"type\", and - for a \"component\" field - \"config.componentId\": that component's id, OR (since you won't know a sibling proposal's id yet) its \"name\" - resolved automatically against both the live schema and your own other pending proposals. Propose the component itself first. This tool's success message echoes back the id it assigned; prefer that id once you have it. See docs/ARCHITECTURE.md (via read_doc) for the full field model.",
        },
      },
      required: ["definitionJson"],
      additionalProperties: false,
    },
  },
];

/** MCP tool arguments arrive as real JSON (numbers/booleans/nested objects),
 * but `applyMagicWriteFields` speaks the same string-leafed wire dialect
 * Magic Chat's model output does (`ai-magic-write-protocol.ts`'s
 * `MagicWriteRawValue`) - every scalar leaf gets stringified here so the
 * exact same coercion/validation logic applies unchanged either way. */
function toRawFields(input: unknown): MagicWriteRawFields {
  const converted = stringifyRawValue(input);
  return converted && typeof converted === "object" && !Array.isArray(converted) ? converted : {};
}

function stringifyRawValue(input: unknown): MagicWriteRawValue | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (Array.isArray(input)) {
    const items = input.map(stringifyRawValue).filter((item): item is MagicWriteRawValue => item !== undefined);
    return items;
  }
  if (typeof input === "object") {
    const out: MagicWriteRawFields = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const converted = stringifyRawValue(value);
      if (converted !== undefined) out[key] = converted;
    }
    return out;
  }
  return undefined;
}

function findType(allTypes: ContentTypeDefinition[], typeSlug: string): ContentTypeDefinition | undefined {
  return allTypes.find((candidate) => candidate.name === typeSlug && candidate.kind !== "component");
}

/** Pulls every plausible numeric id out of one raw relation-field value -
 * a bare number/numeric string (`manyToOne`), a comma-separated string, or a
 * real JSON array of either (`oneToMany`/`manyToMany` - see
 * `ai-magic-write-fields.ts`'s `coerceRelation` for why both shapes are
 * accepted). Never throws on a malformed shape - just yields nothing, same
 * "drop, don't crash" contract as the rest of this untrusted-JSON tool
 * surface. */
function extractRequestedRelationIds(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((piece) => Number(piece.trim()))
      .filter((id) => Number.isFinite(id));
  }
  if (Array.isArray(value)) return value.flatMap(extractRequestedRelationIds);
  return [];
}

/** Walks `nodes` alongside the CALLER's raw (pre-`toRawFields`) argument
 * object, collecting every id an MCP `create_entry`/`update_entry_fields`
 * call asked to link a `relation` field to, grouped by that field's own
 * `targetTypeId` - the same shape `streamMagicWrite`'s `allowedRelationIds`
 * accumulates from a turn's `kind: fetch` hops, just gathered from one call's
 * arguments instead of a conversation's lookups. Recurses into `flatten`/
 * `component-repeat` nodes so a relation nested inside a component field is
 * found too, mirroring `coerceNodeValue`'s own recursion. */
function collectRequestedRelationIds(nodes: EntryFieldNode[], raw: unknown, into: Map<string, Set<number>>): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  for (const node of nodes) {
    if (!(node.fieldName in record)) continue;
    const value = record[node.fieldName];
    if (node.kind === "relation") {
      const ids = extractRequestedRelationIds(value);
      if (ids.length === 0) continue;
      const set = into.get(node.targetTypeId) ?? new Set<number>();
      for (const id of ids) set.add(id);
      into.set(node.targetTypeId, set);
    } else if (node.kind === "flatten") {
      collectRequestedRelationIds(node.children, value, into);
    } else if (node.kind === "component-repeat" && Array.isArray(value)) {
      for (const item of value) collectRequestedRelationIds(node.itemFields, item, into);
    }
  }
}

/**
 * MCP's own equivalent of `streamMagicWrite`'s `allowedRelationIds` - but
 * built from a direct DB existence check instead of "ids surfaced by this
 * turn's own `kind: fetch` hops", since one MCP `tools/call` is a fully
 * independent request with no earlier turn to draw on (an AI client
 * typically discovers a target id via a SEPARATE, EARLIER `list_entries`/
 * `get_entry` call, which this server never remembers). Every id the caller
 * asked to link gets verified against the live table for its field's target
 * type - re-running the exact same "view" access check `list_entries`/
 * `get_entry` themselves gate on, so an MCP relation write can never link to
 * (or even confirm the existence of) a row the token's owner couldn't
 * already see. An id that doesn't resolve to a real row, or whose target
 * type the caller can't view, is silently left out of the allow-list -
 * `applyMagicWriteFields` then drops that one id (or the whole field, for a
 * `manyToOne`) exactly the way an unrecognized id from a model already does.
 */
async function resolveAllowedRelationIds(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  nodes: EntryFieldNode[],
  rawFields: unknown,
): Promise<AllowedRelationIds> {
  const requested = new Map<string, Set<number>>();
  collectRequestedRelationIds(nodes, rawFields, requested);
  if (requested.size === 0) return new Map();

  const allowed = new Map<string, Set<number>>();
  await Promise.all(
    Array.from(requested.entries()).map(async ([targetTypeId, ids]) => {
      const targetType = allTypes.find((candidate) => candidate.id === targetTypeId);
      if (!targetType) return;
      const denied = await checkAccess(context, entries, allTypes, targetType, "view");
      if (denied) return;
      const verified = new Set<number>();
      await Promise.all(
        Array.from(ids).map(async (id) => {
          const row = await entries.getEntry(targetType, allTypes, id);
          if (row) verified.add(id);
        }),
      );
      if (verified.size > 0) allowed.set(targetTypeId, verified);
    }),
  );
  return allowed;
}

/**
 * `applyMagicWriteFields` hands back a relation value already ENCODED
 * (`ai-magic-write-fields.ts`'s `coerceRelation` - a hashed string/array of
 * them, the same shape a GET response's own `encodeRelationIds` produces) -
 * that's correct for its normal callers (Magic Chat's client-side commit,
 * which feeds straight back into `RelationFieldAdapter`, and the terminal SSE
 * event the admin's own Save button later PUTs back through
 * `content-entries.ts`'s `decodeRelationIds`), but these MCP tools call
 * `entries.createEntry`/`updateEntry`/`saveSingletonEntry` DIRECTLY, skipping
 * that HTTP route (and its decode step) entirely - the adapter layer only
 * ever stores/expects a raw numeric id. Reverses that encoding here, scoped
 * to exactly the fields `applied.value` actually contains (checked via `in`,
 * same as `applyMagicWriteFields`'s own per-field walk) so a field the model
 * never wrote doesn't get a spurious `null` injected into the merge -
 * `content-entries.ts`'s own `decodeRelationIds` isn't reused for that reason,
 * it unconditionally rewrites every node in the tree. */
function decodeRelationIdsPartial(nodes: EntryFieldNode[], value: EntryValue): EntryValue {
  const out: EntryValue = { ...value };
  for (const node of nodes) {
    if (!(node.fieldName in value)) continue;
    if (node.kind === "flatten") {
      out[node.fieldName] = decodeRelationIdsPartial(node.children, (value[node.fieldName] as EntryValue) ?? {});
    } else if (node.kind === "component-repeat") {
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      out[node.fieldName] = items.map((item) => decodeRelationIdsPartial(node.itemFields, item));
    } else if (node.kind === "relation") {
      const raw = value[node.fieldName];
      out[node.fieldName] = node.columnName
        ? (typeof raw === "string" ? decodeEntryId(raw) : null)
        : Array.isArray(raw)
          ? raw.map((v) => (typeof v === "string" ? decodeEntryId(v) : null)).filter((v): v is number => v !== null)
          : [];
    }
  }
  return out;
}

/**
 * `read_dry_types` serves `dry.generated.d.ts` from `typesCacheStorage`
 * (`types-cache.ts`'s `readGeneratedDryTypes`), which is normally kept fresh
 * by `routes/content-types.ts`'s own `regenerateTypesCache` running after
 * every schema mutation THAT ROUTE commits - but an MCP session has no
 * guarantee that path is what last touched the schema (an admin mid-edit in
 * another tab, a retry that landed after this tool's own `allTypes` snapshot
 * was taken, or - defensively - any future write path that forgets the same
 * regenerate call). `list_content_types` is the one tool call an MCP client
 * reaches for right before trusting collection/field names (`read_dry_types`'s
 * own instructions point at both in the same breath), so this regenerates the
 * cache from the EXACT `allTypes` this call already fetched live, right here,
 * rather than leaving `read_dry_types` to serve however-stale a copy happens
 * to be sitting in storage. Best-effort/non-fatal, same as the route it
 * mirrors - a cache-write hiccup must never fail the listing itself. */
async function regenerateTypesCacheForMcp(allTypes: ContentTypeDefinition[], context: Pick<DryRouteContext, "env">): Promise<void> {
  try {
    await writeGeneratedDryTypes(generateDryTypes(allTypes), context);
  } catch (error) {
    console.error("[drycms] mcp: failed to regenerate dry.generated.d.ts before list_content_types", error);
  }
}

async function runFetchTool(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  turn: MagicWriteFetchTurn,
): Promise<ToolResult> {
  const result = await executeMagicFetch(context, entries, allTypes, storage, turn);
  return { text: result.resultText };
}

async function runCreateTool(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  typeSlug: string,
  rawFields: unknown,
): Promise<ToolResult> {
  const type = findType(allTypes, typeSlug);
  if (!type) return { text: `No content type named "${typeSlug}" exists.`, isError: true };
  if (type.kind === "singleton") return { text: `"${typeSlug}" is a singleton - it always has exactly one entry, there's nothing to create.`, isError: true };
  if (!supportsMagic(type)) return { text: `Magic isn't available for "${type.label}".`, isError: true };

  const deniedMagic = await checkAccess(context, entries, allTypes, type, "magic");
  if (deniedMagic) return { text: `You don't have permission to use Magic on "${type.name}".`, isError: true };
  const deniedCreate = await checkAccess(context, entries, allTypes, type, "create");
  if (deniedCreate) return { text: `You don't have permission to create "${type.name}" entries.`, isError: true };

  const nodes = buildEntryFieldTree(type, allTypes);
  const allowedRelationIds = await resolveAllowedRelationIds(context, entries, allTypes, nodes, rawFields);
  const applied = applyMagicWriteFields(nodes, toRawFields(rawFields), undefined, allowedRelationIds);
  if (Object.keys(applied.value).length === 0) {
    return { text: `No usable fields were given for the new "${type.name}" entry - nothing was created. Image fields aren't supported by this tool; set those afterward in the admin UI. A relation field's id must belong to a real, viewable entry in its target collection - look one up with list_entries/get_entry first.`, isError: true };
  }
  const created = await entries.createEntry(type, allTypes, decodeRelationIdsPartial(nodes, applied.value));
  return { text: `Created ${type.label} (${type.name}) #${created.id} - ${applied.writtenFieldNames.join(", ")}.` };
}

async function runUpdateTool(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  typeSlug: string,
  id: string | undefined,
  rawFields: unknown,
): Promise<ToolResult> {
  const type = findType(allTypes, typeSlug);
  if (!type) return { text: `No content type named "${typeSlug}" exists.`, isError: true };
  if (!supportsMagic(type)) return { text: `Magic isn't available for "${type.label}".`, isError: true };

  const deniedMagic = await checkAccess(context, entries, allTypes, type, "magic");
  if (deniedMagic) return { text: `You don't have permission to use Magic on "${type.name}".`, isError: true };
  const deniedUpdate = await checkAccess(context, entries, allTypes, type, type.kind === "singleton" ? "setting" : "update");
  if (deniedUpdate) return { text: `You don't have permission to update "${type.name}" entries.`, isError: true };

  const nodes = buildEntryFieldTree(type, allTypes);
  let existingId: number | undefined;
  let existingValue: EntryValue;
  if (type.kind === "singleton") {
    const row = await entries.getSingletonEntry(type, allTypes);
    existingValue = row?.value ?? {};
  } else {
    const numericId = Number(id);
    if (!id || !Number.isFinite(numericId)) return { text: `A valid entry id is required to update "${type.name}".`, isError: true };
    const row = await entries.getEntry(type, allTypes, numericId);
    if (!row) return { text: `No "${type.name}" entry with id ${id}.`, isError: true };
    existingId = row.id;
    existingValue = row.value;
  }

  const allowedRelationIds = await resolveAllowedRelationIds(context, entries, allTypes, nodes, rawFields);
  const applied = applyMagicWriteFields(nodes, toRawFields(rawFields), undefined, allowedRelationIds);
  if (Object.keys(applied.value).length === 0) {
    return { text: `No usable fields were given - nothing was updated. Image fields aren't supported by this tool; set those afterward in the admin UI. A relation field's id must belong to a real, viewable entry in its target collection - look one up with list_entries/get_entry first.`, isError: true };
  }
  const merged = { ...existingValue, ...decodeRelationIdsPartial(nodes, applied.value) };
  const saved = type.kind === "singleton"
    ? await entries.saveSingletonEntry(type, allTypes, merged)
    : await entries.updateEntry(type, allTypes, existingId!, merged);
  return { text: `Updated ${type.label} (${type.name})${type.kind === "singleton" ? "" : ` #${saved.id}`} - ${applied.writtenFieldNames.join(", ")}.` };
}

/** Shared by all three page-source tools below - the same
 * `requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting")` gate
 * `handler.ts` already applies to `pages-source`'s own write methods and to
 * `page-source-ai` (the in-app Magic Chat's own route), adapted to return a
 * `ToolResult` instead of a `Response` - an MCP tool call has no HTTP
 * response of its own to redirect to, so a denial is just another `isError`
 * result. */
async function requirePageBuilderAccess(context: DryRouteContext): Promise<ToolResult | null> {
  const denied = await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting");
  return denied ? { text: "You don't have permission to use the Page Builder.", isError: true } : null;
}

const MAX_PAGE_SOURCE_LIST_ITEMS = 100;

async function runListPageSourceTool(context: DryRouteContext, rawPath: string | undefined): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  const path = normalizeStoragePath(rawPath);
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    if (path) {
      const stat = await adapter.stat(path);
      if (stat?.kind !== "folder") return { text: `"${path}" is not a folder.`, isError: true };
    }
    const items = await adapter.list(path);
    const lines = items.slice(0, MAX_PAGE_SOURCE_LIST_ITEMS).map((item) => `- ${path ? `${path}/` : ""}${item.name}${item.kind === "folder" ? "/" : ""}`);
    if (lines.length === 0) return { text: `"${path || "(root)"}" is empty.` };
    const truncatedNote = items.length > MAX_PAGE_SOURCE_LIST_ITEMS ? `\n(${items.length - MAX_PAGE_SOURCE_LIST_ITEMS} more not shown - narrow with a more specific "path")` : "";
    return { text: `Files/folders in "${path || "(root)"}":\n${lines.join("\n")}${truncatedNote}` };
  } catch (error) {
    return { text: `Could not list "${path || "(root)"}": ${error instanceof Error ? error.message : "unknown error"}.`, isError: true };
  }
}

const MAX_PAGE_SOURCE_READ_CHARS = 100_000;

async function runReadPageSourceTool(context: DryRouteContext, rawPath: string | undefined): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  if (!rawPath) return { text: "\"path\" is required.", isError: true };
  const path = normalizeStoragePath(rawPath);
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const stat = await adapter.stat(path);
    if (!stat || stat.kind !== "file") return { text: `No file at "${path}".`, isError: true };
    const file = await adapter.read(path);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf-8");
    return { text: text.length > MAX_PAGE_SOURCE_READ_CHARS ? `${text.slice(0, MAX_PAGE_SOURCE_READ_CHARS)}\n… (truncated)` : text };
  } catch (error) {
    return { text: `Could not read "${path}": ${error instanceof Error ? error.message : "unknown error"}.`, isError: true };
  }
}

async function runWritePageSourceTool(context: DryRouteContext, rawPath: string | undefined, code: unknown): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  if (!rawPath) return { text: "\"path\" is required.", isError: true };
  if (typeof code !== "string") return { text: "\"code\" must be a string.", isError: true };
  const path = normalizeStoragePath(rawPath);
  try {
    requirePageSourceFileName(path);
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const existing = await adapter.stat(path);
    if (existing?.kind === "folder") return { text: `"${path}" is a folder.`, isError: true };
    await adapter.write(path, new TextEncoder().encode(code));
    // Lights up the Page Editor's file-tree red dot for every OTHER open
    // admin session, not just this request's caller (`ai-page-source-flags.ts`'s
    // own doc comment on scope: every page-source path, not just `page.tsx`)
    // - until a real Build/Publish of a `page.tsx`, or the next explicit Save
    // of this exact path by any session, clears it.
    await markAiPageSourceWrite(path, context.env);
    return { text: `Wrote "${path}" (${code.length.toLocaleString()} characters). This is saved to storage already - it still needs a Build (via the Page Editor or the pages-build tool) to reach the live site.` };
  } catch (error) {
    return { text: `Could not write "${path}": ${error instanceof Error ? error.message : "unknown error"}.`, isError: true };
  }
}

const MAX_PREVIEW_HTML_CHARS = 40_000;

/** Loads every `.tsx`/`.ts` file in `pagesSourceStorage` (`pages/`/
 * `component/` roots - `.css` files under `styles/` don't match the
 * extension filter, and aren't needed for evaluating components anyway).
 * Same bulk-load shape `PageEditor.tsx`'s own `loadTree()` uses client-side -
 * simpler than precisely walking the import graph, and cheap enough for a
 * preview (not a hot path). */
async function loadAllPageSource(context: DryRouteContext): Promise<Record<string, string>> {
  const adapter = getStorageAdapter(pagesSourceStorage, context);
  if (!adapter.listAll) throw new Error("This storage backend doesn't support listing the whole tree, which preview needs.");
  const all = await adapter.listAll();
  const files = all.filter((entry) => entry.kind === "file" && /\.tsx?$/i.test(entry.path));
  const sourceByPath: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      const stat = await adapter.read(file.path);
      const chunks: Buffer[] = [];
      for await (const chunk of stat.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      sourceByPath[file.path] = Buffer.concat(chunks).toString("utf-8");
    }),
  );
  return sourceByPath;
}

async function runPreviewPageSourceTool(context: DryRouteContext, rawPath: string | undefined): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  if (!rawPath) return { text: "\"path\" is required.", isError: true };
  const path = normalizeStoragePath(rawPath);
  try {
    const sourceByPath = await loadAllPageSource(context);
    if (sourceByPath[path] === undefined) return { text: `No file at "${path}".`, isError: true };
    const origin = resolveSiteOrigin(context.url);
    const result = await checkPageSourceBuild(path, sourceByPath, origin, adminBasePath, siteLang);
    if (!result.ok) return { text: `Build failed: ${result.message}`, isError: true };
    const html = result.html.length > MAX_PREVIEW_HTML_CHARS ? `${result.html.slice(0, MAX_PREVIEW_HTML_CHARS)}\n<!-- truncated -->` : result.html;
    return { text: `"${path}" compiled and rendered successfully. Content data is stubbed empty (see this tool's own description) - the HTML below shows real structure/markup, not real content:\n\n${html}` };
  } catch (error) {
    return { text: `Could not preview "${path}": ${error instanceof Error ? error.message : "unknown error"}.`, isError: true };
  }
}

const MAX_DRY_TYPES_CHARS = 100_000;

async function runReadDryTypesTool(context: DryRouteContext): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  try {
    const output = await readGeneratedDryTypes(context);
    return { text: output.length > MAX_DRY_TYPES_CHARS ? `${output.slice(0, MAX_DRY_TYPES_CHARS)}\n… (truncated)` : output };
  } catch (error) {
    return { text: `Could not read the generated dry() types: ${error instanceof Error ? error.message : "unknown error"}.`, isError: true };
  }
}

async function runListDocsTool(context: DryRouteContext): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  const keys = Object.keys(PAGE_SOURCE_DOCS).sort();
  return { text: keys.length > 0 ? `Available docs:\n${keys.map((key) => `- ${key}`).join("\n")}` : "No docs available." };
}

async function runReadDocTool(context: DryRouteContext, rawPath: string | undefined): Promise<ToolResult> {
  const denied = await requirePageBuilderAccess(context);
  if (denied) return denied;
  if (!rawPath) return { text: "\"path\" is required.", isError: true };
  const key = rawPath.replace(/^\/+/, "");
  const content = PAGE_SOURCE_DOCS[key];
  if (content === undefined) {
    const available = Object.keys(PAGE_SOURCE_DOCS).sort().join(", ") || "(none)";
    return { text: `No doc at "${key}". Available: ${available}.`, isError: true };
  }
  return { text: content.length > MAX_PAGE_SOURCE_READ_CHARS ? `${content.slice(0, MAX_PAGE_SOURCE_READ_CHARS)}\n… (truncated)` : content };
}

async function requireContentTypesAccess(context: DryRouteContext): Promise<ToolResult | null> {
  const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting");
  return denied ? { text: "You don't have permission to edit content type schemas.", isError: true } : null;
}

const VALID_KINDS = new Set<string>(["collection", "singleton", "component"]);

type RawRecord = Record<string, unknown>;

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

/**
 * `component`-type fields are the one place `propose_content_type` has
 * repeatedly tripped an AI up: `config.componentId` must be another content
 * type's real, server-assigned id, but an AI proposing several new types in
 * one conversation has no way to know a sibling proposal's id ahead of time
 * (this tool's own success text didn't even say what id got assigned, until
 * now - see `runProposeContentTypeTool` below) - so it naturally reaches for
 * that component's NAME instead, often without the `config` wrapper at all
 * (e.g. a bare `"component": "statItem"` alongside the field rather than
 * `"config": {"componentId": "..."}`). Resolved here against `componentsByRef`
 * (built by the caller from both the live schema and this same user's OTHER
 * still-pending proposals), by id OR by name - so a natural multi-call
 * proposal session (propose a component, then a type that embeds it) just
 * works instead of silently saving a draft that only fails much later, when
 * an admin tries to apply it through "Apply and build".
 * Mutates `config` in place; returns an error message (field-name already
 * stripped, the caller prefixes it) on failure, `undefined` on success. */
function resolveComponentFieldConfig(field: RawRecord, config: RawRecord, componentsByRef: Map<string, string>): string | undefined {
  const ref = firstString(config.componentId, config.component, config.target, field.component, field.componentId, field.target);
  if (!ref) return 'a "component" field needs "config.componentId" set to that component\'s id or name.';
  const resolvedId = componentsByRef.get(ref) ?? componentsByRef.get(ref.toLowerCase());
  if (!resolvedId) {
    return `references unknown component "${ref}" - propose that component first (or check the spelling of its "name"), then retry.`;
  }
  config.componentId = resolvedId;
  if (typeof config.repeatable !== "boolean") {
    // Defaults to non-repeatable (the "flatten" shape - see
    // `field-registry.ts`'s `componentFieldType.shape`) when unspecified:
    // the safer of the two, since it never implies a child table the AI
    // didn't ask for.
    config.repeatable = firstBoolean(config.multiple, field.multiple, field.repeatable) ?? false;
  }
  return undefined;
}

/**
 * Turns whatever shape of `fields` the AI actually sent into real
 * `FieldDefinition`s - defensively, since this is untrusted JSON, not
 * something that went through the schema editor's own `FieldDialog`. Every
 * field gets a well-formed `config`/`validation` (missing/malformed becomes
 * `{}` - a legitimate "nothing set" value, same as an untouched field in the
 * real editor), the exact gap that used to reach `resolveTableTree` at
 * "Apply and build" plan/apply time as a raw, unhelpful `TypeError` (e.g.
 * reading `.unique` off an undefined `validation`) instead of a clear
 * message the AI could act on immediately. Collects every problem rather
 * than stopping at the first, so one retry can fix them all. */
function normalizeProposedFields(rawFields: unknown[], componentsByRef: Map<string, string>): { fields: FieldDefinition[]; errors: string[] } {
  const errors: string[] = [];
  const fields = rawFields.map((raw, index): FieldDefinition => {
    const field = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as RawRecord;
    const name = firstString(field.name) ?? `field${index + 1}`;
    const type = firstString(field.type) ?? "";
    const config: RawRecord =
      field.config && typeof field.config === "object" && !Array.isArray(field.config) ? { ...(field.config as RawRecord) } : {};

    if (!fieldTypes[type]) {
      errors.push(`Field "${name}": unknown field type "${type || "(missing)"}".`);
    } else if (type === "component") {
      const error = resolveComponentFieldConfig(field, config, componentsByRef);
      if (error) errors.push(`Field "${name}": ${error}`);
    }

    return {
      id: firstString(field.id) ?? randomUUID(),
      name,
      label: firstString(field.label) ?? name,
      description: firstString(field.description),
      type,
      config,
      validation: (field.validation && typeof field.validation === "object" && !Array.isArray(field.validation) ? field.validation : {}) as FieldDefinition["validation"],
      default: field.default,
      // Real order is re-derived from array position anyway
      // (`naming.ts`'s `normalizeFieldOrder`, applied when the admin actually
      // applies this draft) - filled in here too just so the STORED draft is
      // a well-formed `FieldDefinition` at rest, matching what the real
      // editor UI always produces.
      order: index,
    };
  });
  return { fields, errors };
}

/** Never applies directly - always lands in `ai-content-type-drafts.ts`'s KV
 * staging area, the same "AI proposes, admin reviews and applies via Apply
 * and build" flow a human-authored draft already goes through
 * (`content-types/draft-store.ts`, `ApplyBuildDialog.tsx`).
 * `id`/`version` are never trusted from the AI - resolved server-side by
 * matching `name` against the live schema, so the AI never has to guess (or
 * risk colliding) an internal id. */
async function runProposeContentTypeTool(context: DryRouteContext, allTypes: ContentTypeDefinition[], definitionJson: string | undefined): Promise<ToolResult> {
  const denied = await requireContentTypesAccess(context);
  if (denied) return denied;
  if (!context.session) return { text: "Sign in required.", isError: true };
  if (!definitionJson) return { text: '"definitionJson" is required.', isError: true };

  let parsed: Partial<ContentTypeDefinition>;
  try {
    parsed = JSON.parse(definitionJson);
  } catch (error) {
    return { text: `"definitionJson" is not valid JSON: ${error instanceof Error ? error.message : "parse error"}.`, isError: true };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { text: '"definitionJson" must decode to an object.', isError: true };
  }
  if (!parsed.name || typeof parsed.name !== "string") return { text: 'The definition must include a "name".', isError: true };
  if (!parsed.kind || !VALID_KINDS.has(parsed.kind)) return { text: '"kind" must be "collection", "singleton", or "component".', isError: true };
  if (!Array.isArray(parsed.fields)) return { text: '"fields" must be an array (may be empty).', isError: true };

  // Every component a `component`-type field can reference: what's live,
  // PLUS this same user's other still-pending proposals - a draft doesn't
  // have to be applied yet to be a valid reference target (see
  // `resolveComponentFieldConfig`'s doc comment). Keyed by both id and
  // lowercased name.
  const pendingDrafts = await listAiContentTypeDrafts(context.session.id, context.env);
  const componentsByRef = new Map<string, string>();
  for (const type of [...allTypes, ...pendingDrafts.map((draft) => draft.definition)]) {
    if (type.kind !== "component") continue;
    componentsByRef.set(type.id, type.id);
    componentsByRef.set(type.name.toLowerCase(), type.id);
  }

  const { fields, errors } = normalizeProposedFields(parsed.fields, componentsByRef);
  if (errors.length > 0) {
    return { text: `Invalid content type: ${errors.join(" ")}`, isError: true };
  }

  const existing = allTypes.find((type) => type.name === parsed.name && type.kind === parsed.kind);
  const isNew = !existing;
  const definition: ContentTypeDefinition = {
    ...parsed,
    fields,
    label: parsed.label || parsed.name,
    id: existing?.id ?? randomUUID(),
    version: existing?.version ?? 0,
  } as ContentTypeDefinition;

  try {
    validateContentTypeDefinition(definition, allTypes);
  } catch (error) {
    const message = error instanceof NamingError || error instanceof Error ? error.message : "Invalid content type definition.";
    return { text: `Invalid content type: ${message}`, isError: true };
  }

  const draft: AiContentTypeDraft = { id: definition.id, definition, isNew, createdAt: new Date().toISOString() };
  await saveAiContentTypeDraft(context.session.id, draft, context.env);
  const reviewUrl = `${resolveSiteOrigin(context.url)}${adminBasePath}/content-types?openDraft=${encodeURIComponent(definition.id)}`;
  return {
    text: `Proposed ${isNew ? "creating" : "updating"} content type "${definition.name}" (${definition.label}, id "${definition.id}") - saved as a pending draft, not applied. If another proposed type embeds this one as a component, reference this id (preferred) or the name "${definition.name}" as its "config.componentId". Ask the admin to review and apply it in their browser: ${reviewUrl}`,
  };
}

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * `status/mcp-server.md` Phase 3 - a per-user, capped activity log (last
 * `MAX_ACTIVITY_ENTRIES` tool calls) so Profile's "AI Activity" section has
 * something to poll. Deliberately NOT realtime (no SSE/WebSocket broadcast) -
 * Magic Chat itself has no cross-tab live view either (`magic-chat-store.ts`'s
 * own doc comment), so a polled list is a genuinely new capability, not a
 * downgrade of an existing one. Reuses `auth-security.ts`'s own KV store
 * (`getAuthSecurityStore`) rather than standing up a second one - this is the
 * same "per-user JSON array under one key" shape `MCP_TOKEN_INDEX_NAMESPACE`
 * already uses, just for log entries instead of token metadata.
 */
const MCP_ACTIVITY_NAMESPACE = "mcp-activity";
const MAX_ACTIVITY_ENTRIES = 50;

export interface McpActivityEntry {
  id: string;
  tool: string;
  summary: string;
  isError: boolean;
  timestamp: string;
}

/** Same "wrap the list with a bump-on-write counter" shape
 * `ai-content-type-drafts.ts`'s `AiContentTypeDraftIndex` uses, for the
 * identical reason: `McpActivitySection` (`McpConnect.tsx`) polls `GET
 * /api/mcp/activity` every `ACTIVITY_POLL_MS` (5s - even tighter than the AI
 * drafts poll), almost always with nothing new since the last tick. The GET
 * handler below answers a conditional `X-Data-Version` poll with
 * `{changed:false}` instead of re-sending up to `MAX_ACTIVITY_ENTRIES`
 * entries on every single tick. */
interface McpActivityLog {
  version: number;
  entries: McpActivityEntry[];
}

function activityKey(userId: number): string {
  return `user-${userId}`;
}

async function readActivityLog(userId: number, env: Record<string, unknown>): Promise<McpActivityLog> {
  return (await getAuthSecurityStore(env).get<McpActivityLog>(MCP_ACTIVITY_NAMESPACE, activityKey(userId))) ?? { version: 0, entries: [] };
}

/** Fire-and-forget from every call site - a logging failure must never fail
 * (or even slow down) the tool call it's describing. */
function recordMcpActivity(userId: number, entry: Omit<McpActivityEntry, "id" | "timestamp">, env: Record<string, unknown>): void {
  void (async () => {
    try {
      const store = getAuthSecurityStore(env);
      const current = await readActivityLog(userId, env);
      const entries = [{ ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString() }, ...current.entries].slice(0, MAX_ACTIVITY_ENTRIES);
      await store.set(MCP_ACTIVITY_NAMESPACE, activityKey(userId), { version: current.version + 1, entries }, { durability: "sync" });
    } catch {
      // Best-effort, same as every other non-critical KV write in this app.
    }
  })();
}

export async function listMcpActivity(userId: number, env: Record<string, unknown> = {}): Promise<McpActivityEntry[]> {
  return (await readActivityLog(userId, env)).entries;
}

/** `routes/mcp.ts`'s own GET handler reads only this (never the full entry
 * list) to answer a conditional poll. */
export async function getMcpActivityVersion(userId: number, env: Record<string, unknown> = {}): Promise<number> {
  return (await readActivityLog(userId, env)).version;
}

async function callTool(context: DryRouteContext, params: Record<string, unknown>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};

  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();

  let outcome: ToolResult;
  switch (name) {
    case "list_content_types":
      await regenerateTypesCacheForMcp(allTypes, context);
      outcome = await runFetchTool(context, entries, allTypes, { kind: "fetch", source: "types" });
      break;
    case "list_entries": {
      const typeSlug = stringArg(args, "typeSlug");
      if (!typeSlug) { outcome = { text: "\"typeSlug\" is required.", isError: true }; break; }
      outcome = await runFetchTool(context, entries, allTypes, { kind: "fetch", source: "entries", typeSlug, search: stringArg(args, "search") });
      break;
    }
    case "get_entry": {
      const typeSlug = stringArg(args, "typeSlug");
      if (!typeSlug) { outcome = { text: "\"typeSlug\" is required.", isError: true }; break; }
      outcome = await runFetchTool(context, entries, allTypes, { kind: "fetch", source: "entry", typeSlug, id: stringArg(args, "id") });
      break;
    }
    case "list_media":
      outcome = await runFetchTool(context, entries, allTypes, { kind: "fetch", source: "media", path: stringArg(args, "path") });
      break;
    case "create_entry": {
      const typeSlug = stringArg(args, "typeSlug");
      if (!typeSlug) { outcome = { text: "\"typeSlug\" is required.", isError: true }; break; }
      outcome = await runCreateTool(context, entries, allTypes, typeSlug, args.fields);
      break;
    }
    case "update_entry_fields": {
      const typeSlug = stringArg(args, "typeSlug");
      if (!typeSlug) { outcome = { text: "\"typeSlug\" is required.", isError: true }; break; }
      outcome = await runUpdateTool(context, entries, allTypes, typeSlug, stringArg(args, "id"), args.fields);
      break;
    }
    case "list_page_source":
      outcome = await runListPageSourceTool(context, stringArg(args, "path"));
      break;
    case "read_page_source":
      outcome = await runReadPageSourceTool(context, stringArg(args, "path"));
      break;
    case "write_page_source":
      outcome = await runWritePageSourceTool(context, stringArg(args, "path"), args.code);
      break;
    case "preview_page_source":
      outcome = await runPreviewPageSourceTool(context, stringArg(args, "path"));
      break;
    case "read_dry_types":
      outcome = await runReadDryTypesTool(context);
      break;
    case "list_docs":
      outcome = await runListDocsTool(context);
      break;
    case "read_doc":
      outcome = await runReadDocTool(context, stringArg(args, "path"));
      break;
    case "propose_content_type":
      outcome = await runProposeContentTypeTool(context, allTypes, stringArg(args, "definitionJson"));
      break;
    default:
      outcome = { text: `Unknown tool "${name}".`, isError: true };
  }

  if (context.session) recordMcpActivity(context.session.id, { tool: name || "(unnamed)", summary: outcome.text, isError: outcome.isError === true }, context.env);
  return { content: [{ type: "text", text: outcome.text }], isError: outcome.isError === true };
}

async function dispatch(context: DryRouteContext, method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
    return {
      protocolVersion: requested && SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: MCP_INSTRUCTIONS,
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") return callTool(context, params);
  if (method.startsWith("notifications/")) return undefined;
  throw new McpError(-32601, `Method not found: "${method}".`);
}

/**
 * The MCP "Streamable HTTP" transport's single POST endpoint, in stateless
 * mode: no `Mcp-Session-Id` header, no server-initiated SSE stream (this
 * server never needs to push a notification outside of a request/response),
 * so `GET`/`DELETE` are simply unimplemented (405, same as any other
 * unsupported method on this route table - `handler.ts`'s dispatch already
 * gives that for free). Every call re-authenticates via the bearer token
 * `handler.ts` already resolved into `context.session` before this handler
 * ever runs.
 */
export const POST: DryRouteHandler = async (context) => {
  if (!context.session) {
    // Unreachable for real HTTP traffic (`handler.ts`'s own blanket 401
    // already fires first and attaches the same `WWW-Authenticate` header -
    // see its own comment) - kept only for a direct-call unit test that
    // invokes this handler without going through that dispatcher.
    const response = jsonResponse({ error: "unauthenticated", message: "Sign in required." }, 401);
    response.headers.set("WWW-Authenticate", `Bearer resource_metadata="${protectedResourceMetadataUrl(resolveSiteOrigin(context.url))}"`);
    return response;
  }

  let body: JsonRpcRequestBody;
  try {
    body = (await context.request.json()) as JsonRpcRequestBody;
  } catch {
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400);
  }
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonResponse({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid request." } }, 400);
  }

  const isNotification = !("id" in body) || body.id === undefined;
  const id = body.id ?? null;
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {};

  try {
    const result = await dispatch(context, body.method, params);
    if (isNotification) return new Response(null, { status: 202 });
    return jsonResponse({ jsonrpc: "2.0", id, result: result ?? {} });
  } catch (error) {
    if (isNotification) return new Response(null, { status: 202 });
    const code = error instanceof McpError ? error.code : -32603;
    const message = error instanceof McpError ? error.message : "Internal error.";
    if (!(error instanceof McpError)) console.error("[drycms] mcp route error", error);
    return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
  }
};

/** Same data-version protocol as `routes/content-types.ts`'s
 * `parseIfVersion`/`routes/ai-content-type-drafts.ts`'s copy - kept as its
 * own copy here too, matching that existing per-route precedent. */
function parseIfVersion(context: DryRouteContext): number | undefined {
  const header = context.request.headers.get("X-Data-Version");
  if (header === null) return undefined;
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * `GET /api/mcp/activity` - the poll target for Profile's "AI Activity"
 * section (`status/mcp-server.md` Phase 3). Cookie-authenticated the normal
 * way (a browser tab, not an MCP client), though nothing stops a PAT from
 * reading its own owner's log too - same session-agnostic treatment every
 * other route gets, scoped to `context.session.id` either way.
 */
export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return jsonResponse({ error: "unauthenticated", message: "Sign in required." }, 401);
  // A bare `GET` on the MCP endpoint itself is the Streamable HTTP client
  // opening the server-push SSE stream, which this stateless server doesn't
  // offer. The spec REQUIRES `405` here (a client special-cases exactly that
  // status as "fine, carry on without a stream"); a 404 reads as a broken
  // endpoint instead.
  if (context.params.slug === undefined) {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (context.params.slug !== "activity") return jsonResponse({ error: "not_found", message: "Unknown mcp endpoint." }, 404);

  const version = await getMcpActivityVersion(context.session.id, context.env);
  const ifVersion = parseIfVersion(context);
  if (ifVersion !== undefined && ifVersion === version) {
    return jsonResponse({ changed: false, version });
  }
  const activity = await listMcpActivity(context.session.id, context.env);
  return jsonResponse({ changed: true, version, activity });
};
