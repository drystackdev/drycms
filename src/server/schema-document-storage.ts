import type { DryRouteContext } from "./context.js";
import { pagesSourceStorage } from "./config.js";
import { getStorageAdapter } from "./storage-adapters.js";
import { bufferOf } from "../storage/util.js";
import {
  SCHEMA_DOCUMENT_PATH,
  parseSchemaDocument,
  serializeSchemaDocument,
  type SchemaDocument,
} from "../content-types/schema-document.js";
import type { SchemaDocumentStore } from "../content-types/engine/schema-document-store.js";

/**
 * The real `content/types.json` (`schema-document.ts`), read and written
 * through `pagesSourceStorage` - a plain directory under `.dry/pages-source`
 * in dev, the tenant's own R2 bucket in production.
 *
 * It lives in page-source storage rather than a store of its own because
 * that IS the mirror of the git repo the Page Builder works in: the browser
 * writes `content/types.json` into its git working copy and pushes, this
 * server-side copy is what every request reads, and both use the same path
 * so a commit and a runtime read can never mean different files. It is
 * deliberately outside the four source ROOTS (`app-router/source-roots.ts`),
 * so route discovery, the build pipeline and the Page Builder file tree
 * never see it as page code.
 */
export function createStorageSchemaDocumentStore(context: Pick<DryRouteContext, "env">): SchemaDocumentStore {
  return {
    async read(): Promise<SchemaDocument | null> {
      const adapter = getStorageAdapter(pagesSourceStorage, context);
      const stat = await adapter.stat(SCHEMA_DOCUMENT_PATH);
      if (!stat || stat.kind !== "file") return null;
      const file = await adapter.read(SCHEMA_DOCUMENT_PATH);
      const text = (await bufferOf(file.stream)).toString("utf-8");
      // An existing-but-empty object is a half-finished write, not a project
      // with no content types - treat it as absent so the bootstrap seed can
      // rebuild it rather than reporting a parse error forever.
      if (!text.trim()) return null;
      return parseSchemaDocument(text);
    },
    async write(doc: SchemaDocument): Promise<void> {
      const adapter = getStorageAdapter(pagesSourceStorage, context);
      await adapter.write(SCHEMA_DOCUMENT_PATH, new TextEncoder().encode(serializeSchemaDocument(doc)));
    },
  };
}
