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
import { storage } from "../config.js";
import { getContentAdapters } from "../content-adapters.js";
import { getAuthSecurityStore } from "../auth-security.js";
import { checkAccess } from "./content-entries.js";
import { executeMagicFetch } from "./ai-magic-write-fetch.js";
import { buildEntryFieldTree } from "../../content-types/engine/entry-tree.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { applyMagicWriteFields } from "../../content-types/ai-magic-write-fields.js";
import { supportsMagic } from "../../content-types/permissions.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { MagicWriteFetchTurn, MagicWriteRawFields, MagicWriteRawValue } from "../../content-types/ai-magic-write-protocol.js";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = { name: "drycms", version: "0.0.1" };

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
      "Create a new entry in a collection. Only plain scalar fields (text/richtext/number/boolean/date/select) are supported - relation and image fields must be set afterward in the admin UI.",
    inputSchema: {
      type: "object",
      properties: {
        typeSlug: { type: "string", description: "The target collection's name." },
        fields: { type: "object", description: "Field name -> value.", additionalProperties: true },
      },
      required: ["typeSlug", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "update_entry_fields",
    description:
      "Update fields on an existing entry (collection) or a singleton. Only plain scalar fields are supported, same restriction as create_entry.",
    inputSchema: {
      type: "object",
      properties: {
        typeSlug: { type: "string", description: "The content type's name." },
        id: { type: "string", description: "The entry's numeric id. Omit for a singleton." },
        fields: { type: "object", description: "Field name -> value.", additionalProperties: true },
      },
      required: ["typeSlug", "fields"],
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
  const applied = applyMagicWriteFields(nodes, toRawFields(rawFields));
  if (Object.keys(applied.value).length === 0) {
    return { text: `No usable fields were given for the new "${type.name}" entry - nothing was created. Relation/image fields aren't supported by this tool; set those afterward in the admin UI.`, isError: true };
  }
  const created = await entries.createEntry(type, allTypes, applied.value);
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

  const applied = applyMagicWriteFields(nodes, toRawFields(rawFields));
  if (Object.keys(applied.value).length === 0) {
    return { text: `No usable fields were given - nothing was updated. Relation/image fields aren't supported by this tool; set those afterward in the admin UI.`, isError: true };
  }
  const merged = { ...existingValue, ...applied.value };
  const saved = type.kind === "singleton"
    ? await entries.saveSingletonEntry(type, allTypes, merged)
    : await entries.updateEntry(type, allTypes, existingId!, merged);
  return { text: `Updated ${type.label} (${type.name})${type.kind === "singleton" ? "" : ` #${saved.id}`} - ${applied.writtenFieldNames.join(", ")}.` };
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

function activityKey(userId: number): string {
  return `user-${userId}`;
}

/** Fire-and-forget from every call site - a logging failure must never fail
 * (or even slow down) the tool call it's describing. */
function recordMcpActivity(userId: number, entry: Omit<McpActivityEntry, "id" | "timestamp">, env: Record<string, unknown>): void {
  void (async () => {
    try {
      const store = getAuthSecurityStore(env);
      const current = (await store.get<McpActivityEntry[]>(MCP_ACTIVITY_NAMESPACE, activityKey(userId))) ?? [];
      const next = [{ ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString() }, ...current].slice(0, MAX_ACTIVITY_ENTRIES);
      await store.set(MCP_ACTIVITY_NAMESPACE, activityKey(userId), next, { durability: "sync" });
    } catch {
      // Best-effort, same as every other non-critical KV write in this app.
    }
  })();
}

export async function listMcpActivity(userId: number, env: Record<string, unknown> = {}): Promise<McpActivityEntry[]> {
  return (await getAuthSecurityStore(env).get<McpActivityEntry[]>(MCP_ACTIVITY_NAMESPACE, activityKey(userId))) ?? [];
}

async function callTool(context: DryRouteContext, params: Record<string, unknown>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};

  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();

  let outcome: ToolResult;
  switch (name) {
    case "list_content_types":
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
  if (!context.session) return jsonResponse({ error: "unauthenticated", message: "Sign in required." }, 401);

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

/**
 * `GET /api/mcp/activity` - the poll target for Profile's "AI Activity"
 * section (`status/mcp-server.md` Phase 3). Cookie-authenticated the normal
 * way (a browser tab, not an MCP client), though nothing stops a PAT from
 * reading its own owner's log too - same session-agnostic treatment every
 * other route gets, scoped to `context.session.id` either way.
 */
export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return jsonResponse({ error: "unauthenticated", message: "Sign in required." }, 401);
  if (context.params.slug !== "activity") return jsonResponse({ error: "not_found", message: "Unknown mcp endpoint." }, 404);
  const activity = await listMcpActivity(context.session.id, context.env);
  return jsonResponse({ activity });
};
