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
import { checkPageSourceBuild } from "../../page-components/page-source-preview.js";
import { getContentAdapters } from "../content-adapters.js";
import { getAuthSecurityStore } from "../auth-security.js";
import { checkAccess } from "./content-entries.js";
import { executeMagicFetch } from "./ai-magic-write-fetch.js";
import { readGeneratedDryTypes } from "../../content-types/types-cache.js";
import { PAGE_SOURCE_DOCS } from "../../page-components/ai-page-source-docs.js";
import { buildEntryFieldTree } from "../../content-types/engine/entry-tree.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { applyMagicWriteFields } from "../../content-types/ai-magic-write-fields.js";
import { supportsMagic, PAGE_BUILDER_RESOURCE_ID } from "../../content-types/permissions.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { MagicWriteFetchTurn, MagicWriteRawFields, MagicWriteRawValue } from "../../content-types/ai-magic-write-protocol.js";
import { requirePermission } from "../admin-access.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { normalizeStoragePath } from "../../storage/path.js";
import { requirePageSourceFileName } from "./pages-source.js";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
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
