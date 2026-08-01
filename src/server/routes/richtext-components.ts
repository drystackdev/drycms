import { Readable } from "node:stream";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DryRouteHandler } from "../context.js";
import { componentsStorage } from "../config.js";
import { buildComponentBundle, buildSharedPreactBundle } from "../../components/RichTextField/build-component-bundle.js";
import type { DryComponentRecord, PlainFieldDef } from "../../components/RichTextField/component-registry-types.js";
import { isDryComponentDefinition, type DryComponentDefinition } from "../../components/RichTextField/register-component.js";
import { slugify } from "../../lib/slugify.js";
import { createStorageAdapter } from "../../storage/index.js";
import { StorageError } from "../../storage/types.js";
import { errorResponse, jsonResponse, readSlug } from "../route-helpers.js";

const adapter = createStorageAdapter(componentsStorage);

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

function slugFor(name: string): string {
  const slug = slugify(name);
  if (!slug) throw new StorageError("invalid_path", `Component name "${name}" has no usable characters.`);
  return slug;
}

function fileNameFor(name: string): string {
  return `${slugFor(name)}.json`;
}

const SHARED_PREACT_BUNDLE_NAME = "preact.js";

/** Every confirmed component's own bundle imports Preact from this one
 * shared file (see `buildComponentBundle`'s own doc comment) rather than
 * inlining its own copy - built once and left alone from then on, `stat`
 * (not a full `read`) is enough to tell whether that's already happened. */
async function ensureSharedPreactBundle(): Promise<void> {
  if (await adapter.stat(SHARED_PREACT_BUNDLE_NAME)) return;
  const code = await buildSharedPreactBundle();
  await adapter.write(SHARED_PREACT_BUNDLE_NAME, Buffer.from(code, "utf8"));
}

/** Builds a component's real source (`sourcePath`, a leading-`/`
 * root-relative glob key like `/src/widgets/dry.color-text.tsx`) into
 * a JS bundle (Preact itself left external, see `buildComponentBundle`) and
 * stores it as `{slug}.js` alongside the `{slug}.json` record - `join`, not
 * `path.resolve`: `resolve()` would treat that leading slash as
 * already-absolute and discard `process.cwd()`. Dev only (mirrors
 * `buildComponentBundle`'s own dev-only tooling) - a deployed build may not
 * have the raw `.tsx` source on disk at all. */
async function buildAndStore(sourcePath: string, slug: string): Promise<void> {
  if (!import.meta.env.DEV) {
    throw new StorageError("unsupported", "Building richtext components is only available in dev.");
  }
  await ensureSharedPreactBundle();
  const entryAbsPath = join(process.cwd(), sourcePath);
  const code = await buildComponentBundle(entryAbsPath);
  await adapter.write(`${slug}.js`, Buffer.from(code, "utf8"));
}

function recordFromDefinition(
  definition: DryComponentDefinition,
  sourcePath: string,
  trail = new Set<string>(),
): DryComponentRecord {
  const nextTrail = new Set(trail).add(definition.name);
  const refs = definition.refs.filter((ref) => !nextTrail.has(ref.name));
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    // Top-level components default to requiring input; nested refs default to
    // using their resolved defaults when the option is omitted.
    requiredInput: definition.requiredInput ?? (trail.size === 0),
    type: definition.type,
    shadow: definition.shadow,
    children: definition.children,
    ...(definition.childrenDefaultHtml !== undefined ? { childrenDefaultHtml: definition.childrenDefaultHtml } : {}),
    ...(refs.length > 0
      ? {
          refs: refs.map((ref) => ref.name),
          refRecords: refs.map((ref) => recordFromDefinition(ref, "", nextTrail)),
        }
      : {}),
    props: definition.schema as unknown as Record<string, PlainFieldDef>,
    defaults: definition.defaults as Record<string, unknown>,
    sourcePath,
    enabled: true,
  };
}

async function rebuildRecord(record: DryComponentRecord, slug: string): Promise<DryComponentRecord> {
  await buildAndStore(record.sourcePath, slug);
  const bundlePath = pathToFileURL(join(componentsStorage.root, `${slug}.js`)).href;
  const module = (await import(`${bundlePath}?rebuild=${Date.now()}`)) as { default?: unknown };
  if (!isDryComponentDefinition(module.default)) {
    throw new StorageError("invalid_path", `Built component "${record.name}" has invalid metadata.`);
  }
  return recordFromDefinition(module.default, record.sourcePath);
}

/** GET `/api/richtext-components` (list every confirmed record),
 * `/api/richtext-components/{name}` (one record), or
 * `/api/richtext-components/{name}.js` (its compiled bundle, streamed with a
 * JS content type) - the toolbar insert dialog and editor bootstrap only
 * ever need the list; the admin page also uses the single-record form to
 * detect "already confirmed" per discovered file. */
export const GET: DryRouteHandler = async (context) => {
  try {
    const name = readSlug(context);
    if (name === "") {
      const entries = (await adapter.list("")).filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"));
      const records = (
        await Promise.all(entries.map((entry) => readRecord(entry.path)))
      ).filter((record): record is DryComponentRecord => record !== null);
      return jsonResponse({ records });
    }
    if (name.endsWith(".js")) {
      const slug = slugFor(name.slice(0, -".js".length));
      const result = await adapter.read(`${slug}.js`);
      return new Response(Readable.toWeb(result.stream) as unknown as ReadableStream, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
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
  childrenDefaultHtml: unknown;
  requiredInput: unknown;
  refs: unknown;
  refRecords: unknown;
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

const BUILD_ACTION_SUFFIX = "/build";

/** POST `/api/richtext-components` - "Xác nhận dùng" (mục 3): builds the
 * component's real source into a JS bundle, then persists a plain,
 * already-resolved `{schema, defaults}` record (never the builder function -
 * the admin page/editor resolve `DryComponent(...)`'s output before
 * ever calling this). A failed build throws before either the `.js` or the
 * `.json` record is written - confirming never leaves a broken/half-set-up
 * component behind. Create-or-overwrite, keyed by `name`.
 *
 * POST `/api/richtext-components/{name}/build` - rebuilds an already-
 * confirmed component's bundle and refreshes its `.json` metadata from the
 * rebuilt definition (mục "nút Build" on the admin page). */
export const POST: DryRouteHandler = async (context) => {
  try {
    const slug = readSlug(context);
    if (slug.endsWith(BUILD_ACTION_SUFFIX)) {
      const name = slug.slice(0, -BUILD_ACTION_SUFFIX.length);
      const record = await readRecord(fileNameFor(name));
      if (!record) throw new StorageError("not_found", `No confirmed component named "${name}".`);
      const rebuilt = await rebuildRecord(record, slugFor(name));
      await adapter.write(fileNameFor(name), Buffer.from(JSON.stringify(rebuilt, null, 2), "utf8"));
      return jsonResponse({ ok: true, record: rebuilt });
    }

    const body = (await context.request.json()) as ConfirmBody;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const type = body.type === "block" ? "block" : "inline";
    const shadow = body.shadow === true;
    // Mirrors `DryComponent`'s own runtime validation - a
    // hand-crafted/stale POST body can't smuggle `children: true` past what
    // the schema/NodeView actually support (native `<slot>` projection only
    // happens inside a shadow tree of a top-level block element).
    const children = body.children === true && shadow && type === "block";
    const childrenDefaultHtml = children && typeof body.childrenDefaultHtml === "string" ? body.childrenDefaultHtml : undefined;
    const requiredInput = body.requiredInput !== false;
    const refs = children && Array.isArray(body.refs)
      ? body.refs.filter((ref): ref is string => typeof ref === "string")
      : [];
    const refRecords = children && Array.isArray(body.refRecords)
      ? body.refRecords
      : [];
    const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
    if (!name) throw new StorageError("invalid_path", "`name` is required.");
    if (!label) throw new StorageError("invalid_path", "`label` is required.");

    await buildAndStore(sourcePath, slugFor(name));

    const record: DryComponentRecord = {
      name,
      label,
      description,
      type,
      shadow,
      children,
      ...(childrenDefaultHtml !== undefined ? { childrenDefaultHtml } : {}),
      requiredInput,
      ...(refs.length > 0 ? { refs } : {}),
      ...(refRecords.length > 0 ? { refRecords: refRecords as DryComponentRecord[] } : {}),
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
 * (removes it from the editor's insert list / dynamic schema) and its built
 * bundle; the source file on disk is untouched. */
export const DELETE: DryRouteHandler = async (context) => {
  try {
    const name = readSlug(context);
    if (!name) throw new StorageError("invalid_path", "A component name is required.");
    const slug = slugFor(name);
    await adapter.remove(`${slug}.json`);
    try {
      await adapter.remove(`${slug}.js`);
    } catch (error) {
      // A record confirmed before this feature existed may have no bundle
      // at all - un-confirming still succeeds either way.
      if (!(error instanceof StorageError && error.code === "not_found")) throw error;
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
};
