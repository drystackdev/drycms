export const prerender = false;

import type { APIRoute } from "astro";
import { richtextComponentsStorage } from "virtual:drycms/richtext-components-config";
import type { DryComponentRecord, PlainFieldDef } from "../components/RichTextField/component-registry-types.js";
import { slugify } from "../lib/slugify.js";
import { createStorageAdapter } from "../storage/index.js";
import { StorageError } from "../storage/types.js";
import { errorResponse, jsonResponse, readSlug } from "./route-helpers.js";

const adapter = createStorageAdapter(richtextComponentsStorage);

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readRecord(filename: string): Promise<DryComponentRecord | null> {
  let result;
  try {
    result = await adapter.read(filename);
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") return null;
    throw error;
  }
  const buf = await streamToBuffer(result.stream);
  if (buf.length === 0) return null;
  return JSON.parse(buf.toString("utf8")) as DryComponentRecord;
}

function fileNameFor(name: string): string {
  const slug = slugify(name);
  if (!slug) throw new StorageError("invalid_path", `Component name "${name}" has no usable characters.`);
  return `${slug}.json`;
}

/** GET `/api/richtext-components` (list every confirmed record) or
 * `/api/richtext-components/{name}` (one record) - the toolbar insert
 * dialog and editor bootstrap only ever need the list; the admin page also
 * uses the single-record form to detect "already confirmed" per discovered
 * file. */
export const GET: APIRoute = async (context) => {
  try {
    const name = readSlug(context);
    if (name === "") {
      const entries = (await adapter.list("")).filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"));
      const records = (
        await Promise.all(entries.map((entry) => readRecord(entry.path)))
      ).filter((record): record is DryComponentRecord => record !== null);
      return jsonResponse({ records });
    }
    const record = await readRecord(fileNameFor(name));
    if (!record) throw new StorageError("not_found", `No confirmed component named "${name}".`);
    return jsonResponse({ record });
  } catch (error) {
    return errorResponse(error);
  }
};

interface ConfirmBody {
  name: unknown;
  label: unknown;
  description: unknown;
  type: unknown;
  shadow: unknown;
  children: unknown;
  props: unknown;
  defaults: unknown;
  sourcePath: unknown;
}

function asPlainFieldShape(value: unknown): Record<string, PlainFieldDef> {
  if (!value || typeof value !== "object") {
    throw new StorageError("invalid_path", "`props` must be an object.");
  }
  return value as Record<string, PlainFieldDef>;
}

/** POST `/api/richtext-components` - "Xác nhận dùng" (mục 3): persists a
 * plain, already-resolved `{schema, defaults}` (never the builder function -
 * the admin page/editor resolve `DryEditerComponent(...)`'s output before
 * ever calling this). Create-or-overwrite, keyed by `name`. */
export const POST: APIRoute = async (context) => {
  try {
    const body = (await context.request.json()) as ConfirmBody;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const type = body.type === "block" ? "block" : "inline";
    const shadow = body.shadow === true;
    // Mirrors `DryEditerComponent`'s own runtime validation - a
    // hand-crafted/stale POST body can't smuggle `children: true` past what
    // the schema/NodeView actually support (native `<slot>` projection only
    // happens inside a shadow tree of a top-level block element).
    const children = body.children === true && shadow && type === "block";
    const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
    if (!name) throw new StorageError("invalid_path", "`name` is required.");
    if (!label) throw new StorageError("invalid_path", "`label` is required.");

    const record: DryComponentRecord = {
      name,
      label,
      description,
      type,
      shadow,
      children,
      props: asPlainFieldShape(body.props),
      defaults: (body.defaults && typeof body.defaults === "object" ? body.defaults : {}) as Record<string, unknown>,
      sourcePath,
      enabled: true,
    };

    await adapter.write(fileNameFor(name), Buffer.from(JSON.stringify(record, null, 2), "utf8"));
    return jsonResponse({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
};

/** DELETE `/api/richtext-components/{name}` - un-confirms a component
 * (removes it from the editor's insert list / dynamic schema); the source
 * file on disk is untouched. */
export const DELETE: APIRoute = async (context) => {
  try {
    const name = readSlug(context);
    if (!name) throw new StorageError("invalid_path", "A component name is required.");
    await adapter.remove(fileNameFor(name));
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
};
