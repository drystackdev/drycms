import { emptySchemaDocument, type SchemaDocument } from "../schema-document.js";

/**
 * How an engine adapter reaches `content/types.json` (`schema-document.ts`).
 *
 * Deliberately tiny and I/O-agnostic: the real implementation
 * (`server/schema-document-storage.ts`) reads and writes it through
 * `pagesSourceStorage`, which is a local directory in dev and an R2 bucket in
 * production, and the schema engine must not know or care which. `read()`
 * resolves `null` - not an empty document - when the file does not exist yet,
 * because "no file" is what triggers the bootstrap seed (and the one-time
 * import of a pre-JSON project's `metadata` table), whereas an empty document
 * is a real, deliberate state: a project whose every content type was deleted.
 */
export interface SchemaDocumentStore {
  read(): Promise<SchemaDocument | null>;
  write(doc: SchemaDocument): Promise<void>;
}

/**
 * A store with no file behind it - the default an engine adapter falls back
 * to when none is supplied. Real servers always pass the storage-backed one
 * (`content-adapters.ts`); this exists so a unit test can build an adapter
 * over an in-memory sqlite database without also standing up a storage
 * backend, exactly as those tests could before the schema moved out of the
 * `metadata` table.
 */
export function createMemorySchemaDocumentStore(initial?: SchemaDocument): SchemaDocumentStore {
  let current: SchemaDocument | null = initial ? { ...initial } : null;
  return {
    read: async () => (current ? { ...current, applied: [...current.applied], drafts: [...current.drafts] } : null),
    write: async (doc) => {
      current = { ...doc, applied: [...doc.applied], drafts: [...doc.drafts] };
    },
  };
}

/** The document a brand-new project starts from, before the default content
 * types are seeded into it. */
export function initialSchemaDocument(): SchemaDocument {
  return emptySchemaDocument();
}
