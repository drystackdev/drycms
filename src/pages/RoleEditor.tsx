import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import CheckField from "../components/CheckField.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { ArrowLeftIcon, TrashIcon } from "../components/icons.js";
import { toast } from "../components/Toast.js";
import {
  ContentEntriesApiError,
  createContentEntriesApi,
} from "../content-types/entries-http-api.js";
import type { EntryValue } from "../content-types/engine/entry-codec.js";
import {
  buildEntryFieldTree,
  type EntryFieldNode,
} from "../content-types/engine/entry-tree.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import {
  permissionActionsFor,
  permissionKeyFor,
  type PermissionAction,
} from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { canAccess } from "../store/auth.js";
import { blankEntryValue } from "./content-entry-editor/blank-value.js";
import FieldRenderer from "./content-entry-editor/FieldRenderer.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  /** `"new"` for a brand-new role, same convention as `ContentEntryEditor`'s
   * own `id` prop for a collection entry. */
  id: string;
}

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  update: "Update",
  delete: "Delete",
  publish: "Publish",
  setting: "Setting",
};

const ACTION_DESCRIPTIONS: Record<PermissionAction, string> = {
  view: "Can view entries in this collection.",
  create: "Can create new entries in this collection.",
  update: "Can edit existing entries in this collection.",
  delete: "Can delete entries from this collection.",
  publish: "Can publish draft entries in this collection.",
  setting: "Can view and edit this singleton's settings.",
};

/** Permission management no longer has a content table, but remains a
 * grantable system resource in the role editor. */
const PERMISSION_RESOURCE: ContentTypeDefinition = {
  id: "system-permission",
  kind: "collection",
  name: "permission",
  label: "Permission",
  description: "Manage permission assignments for roles.",
  fields: [],
  version: 0,
};

/**
 * Bespoke Role editor (not the generic `ContentEntryEditor`/`FieldRenderer`
 * loop) - `status/role.md` wants a bigger picture than a plain field form:
 * name/description/Super Admin/the user-mirror picker are still rendered
 * through `FieldRenderer` (reusing its `ScalarField`/`RelationField` adapters
 * node-by-node), but the `permissions` relation is deliberately pulled out of
 * that loop and rendered as a per-resource collapsible list of switches
 * instead of a flat picker of individual permission keys - that's the part a
 * generic field loop can't express.
 */
export default function RoleEditor({ id }: Props) {
  const { route } = useLocation();
  const isNew = id === "new";
  const typesApi = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );
  const roleEntriesApi = useMemo(
    () => createContentEntriesApi(`${path}/api/content`, "role"),
    [],
  );

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [value, setValue] = useState<EntryValue | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);

  const roleType = allTypes?.find((t) => t.name === "role");
  const canViewRole = !!roleType && canAccess(roleType.id, "view");
  const canEditRole = !!roleType && canAccess(roleType.id, isNew ? "create" : "update");
  const canDeleteRole = !!roleType && !isNew && canAccess(roleType.id, "delete");
  const nodes: EntryFieldNode[] = useMemo(
    () => (roleType && allTypes ? buildEntryFieldTree(roleType, allTypes) : []),
    [roleType, allTypes],
  );
  // `isSuperAdmin` is a bypass switch, not an ordinary editable attribute -
  // only the permanently-seeded "Super Admin" role ever has it -
  // excluded from the form entirely, same treatment as `permissions` below.
  const otherNodes = nodes.filter(
    (n) => n.fieldName !== "permissions" && n.fieldName !== "isSuperAdmin",
  );

  useDocumentTitle(isNew ? "New Role" : "Role");

  useEffect(() => {
    (async () => {
      try {
        const types = await typesApi.list();
        setAllTypes(types);
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Failed to load.",
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (!roleType || nodes.length === 0 || !canViewRole) return;
    if (isNew) {
      const blank = blankEntryValue(nodes);
      setValue(blank);
      setEntryId(null);
      setInitialSnapshot(JSON.stringify(blank));
      return;
    }
    (async () => {
      try {
        const entry = await roleEntriesApi.get(id);
        setValue(entry.value);
        setEntryId(entry.id);
        setInitialSnapshot(JSON.stringify(entry.value));
      } catch (error) {
        if (
          error instanceof ContentEntriesApiError &&
          /not found/i.test(error.message)
        ) {
          route(`${path}/roles`, true);
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : "Failed to load role.",
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only on id/roleType change, not every time `nodes` gets a new array identity
  }, [roleType, id, isNew, canViewRole]);

  const isDirty =
    initialSnapshot !== null &&
    value !== null &&
    JSON.stringify(value) !== initialSnapshot;

  function updateField(fieldName: string, fieldValue: unknown) {
    setValue((current) =>
      current ? { ...current, [fieldName]: fieldValue } : current,
    );
  }

  function permissionIdFor(
    resource: ContentTypeDefinition,
    action: PermissionAction,
  ): string {
    return permissionKeyFor(resource.id, action);
  }

  function togglePermission(
    resource: ContentTypeDefinition,
    action: PermissionAction,
    checked: boolean,
  ) {
    const permId = permissionIdFor(resource, action);
    setValue((current) => {
      if (!current) return current;
      const ids = Array.isArray(current.permissions)
        ? ([...current.permissions] as string[])
        : [];
      const remove = (id: string) => {
        const idx = ids.indexOf(id);
        if (idx !== -1) ids.splice(idx, 1);
      };
      if (action === "view" && !checked) {
        // Turning View off disables every other action for this resource too.
        for (const a of permissionActionsFor(resource)) {
          const otherId = permissionIdFor(resource, a);
          if (otherId) remove(otherId);
        }
      } else if (checked) {
        if (!ids.includes(permId)) ids.push(permId);
      } else {
        remove(permId);
      }
      return { ...current, permissions: ids };
    });
  }

  async function handleSave() {
    if (!roleType || !value) return;
    setFieldErrors({});
    setSaving(true);
    try {
      if (isNew) {
        const entry = await roleEntriesApi.create(value);
        toast.add({
          type: "success",
          title: `Created role "${String(value.name ?? "")}".`,
        });
        route(`${path}/roles/${entry.id}`);
      } else if (entryId) {
        const entry = await roleEntriesApi.update(entryId, value);
        setValue(entry.value);
        setInitialSnapshot(JSON.stringify(entry.value));
        toast.add({ type: "success", title: "Saved role." });
      }
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
        toast.add({ type: "error", title: "Fix the highlighted fields." });
      } else {
        toast.add({
          type: "error",
          title: "Save failed",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entryId) return;
    setDeleting(true);
    try {
      await roleEntriesApi.remove(entryId);
      setShowDeleteConfirm(false);
      toast.add({ type: "success", title: "Deleted role." });
      route(`${path}/roles`);
    } catch (error) {
      toast.add({
        type: "error",
        title: "Delete failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!allTypes || !roleType)
    return <span class="hint">Loading…</span>;
  if (!canViewRole) return <span class="error">You don't have permission to view roles.</span>;
  if (value === null) return <span class="hint">Loading…</span>;

  const resources = allTypes
    .filter((t) => t.kind === "collection")
    .concat(PERMISSION_RESOURCE)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
  const singletons = allTypes
    .filter((t) => t.kind === "singleton")
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
  const grantedIds = new Set(
    Array.isArray(value.permissions) ? (value.permissions as string[]) : [],
  );

  return (
    <>
      <div class="page-header">
        <button
          type="button"
          class="icon ghost"
          onClick={() => route(`${path}/roles`)}
        >
          <ArrowLeftIcon />
        </button>
        <div style={{ flex: 1 }}>
          <h1>{isNew ? "New Role" : String(value.name ?? "Role")}</h1>
          <p>
            Name, description, assigned users, and per-resource permissions.
          </p>
        </div>
        {isDirty && (
          <button
            type="button"
            disabled={!canEditRole || saving}
            aria-busy={saving}
            onClick={handleSave}
          >
            Save
          </button>
        )}
      </div>

      <fieldset disabled={!canEditRole} class="role-editor-form">
      <div class="content-entry-editor-grid">
        <div class="stack">
          {otherNodes.map((node) => (
            <div key={node.fieldName}>
              <FieldRenderer
                node={node}
                value={value[node.fieldName]}
                onChange={(fieldValue) =>
                  updateField(node.fieldName, fieldValue)
                }
                error={fieldErrors[node.fieldName]}
                allTypes={allTypes}
              />
            </div>
          ))}
        </div>

        <div class="stack">
          <fieldset>
            <legend>Permissions</legend>
            <div class="permission-view-card">
              {resources.map((resource) => {
                const expected = permissionActionsFor(resource);
                const isGranted = (action: PermissionAction) => {
                  const permId = permissionIdFor(resource, action);
                  return !!permId && grantedIds.has(permId);
                };
                const viewGranted = expected.includes("view")
                  ? isGranted("view")
                  : true;
                return (
                  <details key={resource.id}>
                    <summary>
                      <span class="stack" style={{ gap: "0.25rem" }}>
                        <strong>{resource.label}</strong>
                        <span class="hint">{resource.description}</span>
                      </span>
                      <div class="spacer" />
                      <span class="role-permission-dots">
                        {expected.map((action) => (
                          <span
                            key={action}
                            class={`role-permission-dot${isGranted(action) ? " on" : ""}`}
                            title={ACTION_LABELS[action]}
                          />
                        ))}
                      </span>
                    </summary>
                    <div class="role-permission-switches">
                      {expected.map((action) => (
                        <CheckField
                          key={action}
                          role="switch"
                          label={ACTION_LABELS[action]}
                          description={ACTION_DESCRIPTIONS[action]}
                          value={isGranted(action)}
                          disabled={action !== "view" && !viewGranted}
                          onChange={(checked) =>
                            togglePermission(resource, action, checked)
                          }
                        />
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </fieldset>

          {singletons.length > 0 && (
            <fieldset>
              <legend>Singletons</legend>
              <div
                class="stack"
                style={{ marginBottom: "0.5rem", gap: "1rem" }}
              >
                {singletons.map((singleton) => {
                  const permissionId = permissionIdFor(singleton, "setting");
                  return (
                    <div key={singleton.id}>
                      <CheckField
                        role="switch"
                        label={singleton.label}
                        description={
                          singleton.description ??
                          "Manage this singleton's settings."
                        }
                        value={!!permissionId && grantedIds.has(permissionId)}
                        onChange={(checked) =>
                          togglePermission(singleton, "setting", checked)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {canDeleteRole && !value.isSuperAdmin && (
            <div class="content-type-editor-danger">
              <div>
                <h2>Danger zone</h2>
                <p>Delete this role. This cannot be undone.</p>
              </div>
              <div>
                <button
                  type="button"
                  class="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <TrashIcon /> Delete role
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </fieldset>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this role?"
        message={
          <p>This permanently deletes the role. This cannot be undone.</p>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
