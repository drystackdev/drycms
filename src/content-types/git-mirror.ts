import type { ContentTypeDefinition } from "./types.js";
import type { EntryFieldNode } from "./engine/entry-tree.js";
import type { EntryValue } from "./engine/entry-codec.js";
import { SUPER_ADMIN_FIELD_NAME } from "./permissions.js";

/**
 * Content types git-mirrored history (`plans/history-content.md`) never
 * touches, regardless of who's saving - credential data whose JSON has no
 * business leaving D1 for a (possibly third-party-hosted) git repo:
 * `user` (password hashes), `githubSync`/`aiKey` (the git PAT and AI
 * provider keys themselves). Matched by `name`, same reasoning
 * `permissions.ts`'s `NO_MAGIC_TYPE_NAMES` documents - only `name` is stable
 * across both the seeded system types (fixed ids) and an app's own
 * singletons (generated ids). Checked server-side on every commit request,
 * never trusted from the client.
 *
 * `role` and `memory` used to be excluded here too (whole type), but are now
 * ordinary git-mirrored/restorable content - `role`'s one sensitive row (the
 * seeded Super Admin) is instead excluded at the ROW level below, via
 * `isGitMirrorEligibleEntry`.
 */
export const GIT_MIRROR_EXCLUDED_TYPE_NAMES: ReadonlySet<string> = new Set([
  "user",
  "githubSync",
  "aiKey",
]);

export function isGitMirrorEligible(type: ContentTypeDefinition): boolean {
  return type.kind !== "component" && !GIT_MIRROR_EXCLUDED_TYPE_NAMES.has(type.name);
}

/**
 * Row-level companion to `isGitMirrorEligible` - only `role` needs one: the
 * seeded Super Admin row (`isSuperAdmin: true`) is real permission-bypass
 * state, not editorial content, so it must never be committed to git nor
 * written back by a Versions restore / Entry pull, even though every OTHER
 * role is ordinary git-mirrored data. Checked wherever an entry is about to
 * be written to or read from the git mirror (`content-history.ts`,
 * `git-restore.ts`), never trusted from the client.
 */
export function isGitMirrorEligibleEntry(type: ContentTypeDefinition, value: EntryValue): boolean {
  return !(type.name === "role" && value[SUPER_ADMIN_FIELD_NAME] === true);
}

const SECRET_FIELD_TYPES: ReadonlySet<string> = new Set(["password", "secretkey"]);

/**
 * Strips every `password`/`secretkey` field's value out of `value` before it
 * is ever written to git - the JSON key itself is omitted, not masked, so a
 * commit/diff never even hints at whether the field changed (decision #3 in
 * `plans/history-content.md`). Walks the same `EntryFieldNode` tree
 * `routes/content-entries.ts`'s `encodeRelationIds`/`decodeRelationIds`
 * already do, so a secret nested inside a `flatten`ed component or a
 * repeatable component's items is caught too, not just top-level columns.
 */
export function redactSecretFields(nodes: EntryFieldNode[], value: EntryValue): EntryValue {
  const out: EntryValue = { ...value };
  for (const node of nodes) {
    if (node.kind === "column") {
      if (SECRET_FIELD_TYPES.has(node.fieldType)) delete out[node.fieldName];
    } else if (node.kind === "flatten") {
      out[node.fieldName] = redactSecretFields(node.children, (value[node.fieldName] as EntryValue) ?? {});
    } else if (node.kind === "component-repeat") {
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      out[node.fieldName] = items.map((item) => redactSecretFields(node.itemFields, item));
    }
  }
  return out;
}
