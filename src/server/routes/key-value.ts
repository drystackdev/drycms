import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { content, kv } from "../config.js";
import { resolveAccess } from "../../content-types/access.js";
import { createContentEngineAdapter, createContentEntryEngineAdapter } from "../../content-types/engine/index.js";
import { KeyValueStore } from "../../kv/memory.js";
import { createKeyValueAdapter, createRequestKeyValueAdapter } from "../../kv/factory.js";
import { KeyValueError } from "../../kv/types.js";
import { forbiddenResponse, jsonResponse, unauthenticatedResponse } from "../route-helpers.js";

const moduleStore = kv.kind !== "D1" && kv.kind !== "KV"
  ? new KeyValueStore(createKeyValueAdapter(kv), {
      maxEntries: kv.maxEntries,
      maxBytes: kv.maxBytes,
      defaultTtlMs: kv.defaultTtlMs,
      idleTtlMs: kv.idleTtlMs,
      cleanupIntervalMs: kv.cleanupIntervalMs,
      flushDebounceMs: kv.flushDebounceMs,
      flushBatchSize: kv.flushBatchSize,
      durability: kv.durability,
    })
  : undefined;
const requestStores = new WeakMap<object, KeyValueStore>();

const moduleSchemaAdapter = content.engine !== "D1" ? createContentEngineAdapter(content) : undefined;
const moduleEntryAdapter = content.engine !== "D1" ? createContentEntryEngineAdapter(content) : undefined;

function getStore(context?: DryRouteContext): KeyValueStore {
  if (moduleStore) return moduleStore;
  if (!context) throw new KeyValueError("backend_unavailable", `KV adapter "${kv.kind}" needs a request-bound runtime.`);
  const existing = requestStores.get(context.env);
  if (existing) return existing;
  const store = new KeyValueStore(createRequestKeyValueAdapter(kv, context.env), {
    maxEntries: kv.maxEntries,
    maxBytes: kv.maxBytes,
    defaultTtlMs: kv.defaultTtlMs,
    idleTtlMs: kv.idleTtlMs,
    cleanupIntervalMs: kv.cleanupIntervalMs,
    flushDebounceMs: kv.flushDebounceMs,
    flushBatchSize: kv.flushBatchSize,
    durability: kv.durability,
  });
  requestStores.set(context.env, store);
  return store;
}

async function requireSuperAdmin(context: DryRouteContext): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const schema = moduleSchemaAdapter ?? createContentEngineAdapter(content, context.env);
  const entries = moduleEntryAdapter ?? createContentEntryEngineAdapter(content, context.env);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccess(entries, allTypes, context.session);
  return access?.isSuperAdmin ? null : forbiddenResponse("Only Super Admin can access Key Value.");
}

function pathParts(context: DryRouteContext): string[] {
  const raw = context.params.slug ?? "";
  if (!raw) return [];
  return raw.split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      throw new KeyValueError("invalid_key", "Key Value path contains invalid percent-encoding.");
    }
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof KeyValueError) {
    const status = error.code === "invalid_key" || error.code === "invalid_value" ? 400 : 503;
    return jsonResponse({ error: error.code, message: error.message }, status);
  }
  return jsonResponse({ error: "internal", message: error instanceof Error ? error.message : "Internal error." }, 500);
}

function etag(revision: number): string {
  return `"kv-revision-${revision}"`;
}

export const GET: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context);
  if (denied) return denied;
  try {
    const parts = pathParts(context);
    const store = getStore(context);
    if (parts.length === 1) {
      const namespace = parts[0]!;
      const result = await store.list(namespace, {
        cursor: context.url.searchParams.get("cursor") ?? undefined,
        limit: Number(context.url.searchParams.get("limit") ?? 50),
        search: context.url.searchParams.get("search") ?? undefined,
      });
      const tag = etag(store.currentRevision);
      if (context.request.headers.get("If-None-Match") === tag) return new Response(null, { status: 304, headers: { ETag: tag } });
      const response = jsonResponse(result);
      response.headers.set("ETag", tag);
      response.headers.set("Cache-Control", "private, no-cache");
      return response;
    }
    if (parts.length === 2) {
      const namespace = parts[0]!;
      const key = parts[1]!;
      const value = await store.get(namespace, key);
      if (value === null) return jsonResponse({ error: "not_found", message: "Key does not exist." }, 404);
      return jsonResponse({ namespace, key, value });
    }
    return jsonResponse({ error: "invalid_key", message: "Expected /namespace or /namespace/key." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PUT: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context);
  if (denied) return denied;
  try {
    const parts = pathParts(context);
    if (parts.length !== 2) return jsonResponse({ error: "invalid_key", message: "Expected /namespace/key." }, 400);
    const namespace = parts[0]!;
    const key = parts[1]!;
    const body = (await context.request.json()) as { value?: unknown; ttlMs?: unknown; durability?: "memory" | "async" | "sync" };
    await getStore(context).set(namespace, key, body.value, {
      ttlMs: body.ttlMs === undefined ? undefined : Number(body.ttlMs),
      durability: body.durability,
    });
    return jsonResponse({ ok: true, revision: getStore(context).currentRevision });
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context);
  if (denied) return denied;
  try {
    const parts = pathParts(context);
    if (parts.length !== 2) return jsonResponse({ error: "invalid_key", message: "Expected /namespace/key." }, 400);
    await getStore(context).delete(parts[0]!, parts[1]!);
    return jsonResponse({ ok: true, revision: getStore(context).currentRevision });
  } catch (error) {
    return errorResponse(error);
  }
};
