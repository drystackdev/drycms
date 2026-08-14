import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import { SEO_DEFAULTS_TYPE_ID, SYSTEM_FIELD_IDS } from "../../content-types/system-fields.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

/** Fields that belong in the generic entry form. The SEO Defaults singleton
 * uses the shared SEO component for storage, but its fallback copy does not
 * expose the per-page "Hide from search engines" override. */
export function editableEntryNodes(type: ContentTypeDefinition, nodes: EntryFieldNode[]): EntryFieldNode[] {
  return nodes
    .filter(
      (node) =>
        !(
          node.kind === "column" &&
          (node.fieldId === SYSTEM_FIELD_IDS.createdAt ||
            node.fieldId === SYSTEM_FIELD_IDS.updatedAt ||
            node.fieldId === SYSTEM_FIELD_IDS.sortIndex)
        ),
    )
    .map((node) => {
      if (type.id !== SEO_DEFAULTS_TYPE_ID || node.kind !== "flatten" || node.fieldId !== SYSTEM_FIELD_IDS.seo) return node;
      return { ...node, children: node.children.filter((child) => child.fieldName !== "noIndex") };
    });
}
