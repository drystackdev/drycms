import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import CheckField from "../components/fields/CheckField.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { ArrowLeftIcon, TrashIcon } from "../components/icons/index.js";
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
  CONTENT_TYPES_RESOURCE_ID,
  ICON_MANAGEMENT_RESOURCE_ID,
  KEY_VALUE_RESOURCE_ID,
  MEDIA_RESOURCE_ID,
  PAGE_COMPONENTS_RESOURCE_ID,
  permissionActionsFor,
  permissionKeyFor,
  RICHTEXT_COMPONENTS_RESOURCE_ID,
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
  setting: "Setting",
  magic: "Magic",
};

const ACTION_DESCRIPTIONS: Record<PermissionAction, string> = {
  view: "Can view entries in this collection.",
  create: "Can create new entries in this collection.",
  update: "Can edit existing entries in this collection.",
  delete: "Can delete entries from this collection.",
  setting: "Can view and edit this singleton's settings.",
  magic: "Can use Magic (AI) to write entries here.",
};

/** Action -> the other action(s) that must be granted first (OR semantics -
 * any ONE of them is enough) before this one can be turned on. `[]` means no
 * prerequisite - a base gate like `view`/`setting`. Generalizes the
 * long-standing "View gates Create/Update/Delete" rule so `magic` can depend
 * on "Create OR Update" (collection) / "Setting" (singleton) the same way -
 * `magic` is only ever meaningful once the role can actually touch the
 * resource some other way. */
function permissionPrerequisites(resource: ContentTypeDefinition, action: PermissionAction): PermissionAction[] {
  if (action === "magic") return resource.kind === "singleton" ? ["setting"] : ["create", "update"];
  if (resource.kind !== "singleton" && action !== "view") return ["view"];
  return [];
}

/** None of the resources below have a real content table - each is a single
 * grantable "can use this page" toggle (`kind: "singleton"` gives it exactly
 * one `setting` action via `permissionActionsFor`), rendered together in the
 * "System" fieldset below rather than mixed into the real Collections/
 * Singletons lists. */
const PERMISSION_RESOURCE: ContentTypeDefinition = {
  id: "system-permission",
  kind: "singleton",
  name: "permission",
  label: "Permission",
  description: "Manage permission assignments for roles.",
  fields: [],
  version: 0,
};

const PAGE_COMPONENTS_RESOURCE: ContentTypeDefinition = {
  id: PAGE_COMPONENTS_RESOURCE_ID,
  kind: "singleton",
  name: "pageComponents",
  label: "Page Components",
  description: "Build and manage saved page-builder components.",
  fields: [],
  version: 0,
};

const MEDIA_RESOURCE: ContentTypeDefinition = {
  id: MEDIA_RESOURCE_ID,
  kind: "singleton",
  name: "media",
  label: "Media",
  description: "Browse and manage the Media library.",
  fields: [],
  version: 0,
};

const ICON_MANAGEMENT_RESOURCE: ContentTypeDefinition = {
  id: ICON_MANAGEMENT_RESOURCE_ID,
  kind: "singleton",
  name: "iconManagement",
  label: "Icon Management",
  description: "Add, edit, and remove icons in the icon library.",
  fields: [],
  version: 0,
};

const RICHTEXT_COMPONENTS_RESOURCE: ContentTypeDefinition = {
  id: RICHTEXT_COMPONENTS_RESOURCE_ID,
  kind: "singleton",
  name: "richtextComponents",
  label: "Custom Components",
  description: "Build and manage RichText custom components.",
  fields: [],
  version: 0,
};

const CONTENT_TYPES_RESOURCE: ContentTypeDefinition = {
  id: CONTENT_TYPES_RESOURCE_ID,
  kind: "singleton",
  name: "contentTypes",
  label: "Content Types",
  description: "Edit content type schemas in the Content-Type Builder.",
  fields: [],
  version: 0,
};

const KEY_VALUE_RESOURCE: ContentTypeDefinition = {
  id: KEY_VALUE_RESOURCE_ID,
  kind: "singleton",
  name: "keyValue",
  label: "Key Value",
  description: "Manage the Key Value store.",
  fields: [],
  version: 0,
};

/** Every non-content-type admin page, rendered together as flat toggle rows
 * in the "System" fieldset - see `status/role-system-permissions.md`. AI
 * Keys deliberately has no entry here: `protectSystemMutation`
 * (`server/routes/content-entries.ts`) already hard-blocks non-super-admins
 * from mutating `aiKey` rows unconditionally, so a toggle here would grant a
 * nav link that still 403s on every write. */
const SYSTEM_RESOURCES: ContentTypeDefinition[] = [
  PERMISSION_RESOURCE,
  PAGE_COMPONENTS_RESOURCE,
  MEDIA_RESOURCE,
  ICON_MANAGEMENT_RESOURCE,
  RICHTEXT_COMPONENTS_RESOURCE,
  CONTENT_TYPES_RESOURCE,
  KEY_VALUE_RESOURCE,
];

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
    setValue((current) => {
      if (!current) return current;
      const ids = Array.isArray(current.permissions)
        ? ([...current.permissions] as string[])
        : [];
      const has = (a: PermissionAction) => ids.includes(permissionIdFor(resource, a));
      const remove = (a: PermissionAction) => {
        const id = permissionIdFor(resource, a);
        const idx = ids.indexOf(id);
        if (idx !== -1) ids.splice(idx, 1);
      };
      const add = (a: PermissionAction) => {
        const id = permissionIdFor(resource, a);
        if (!ids.includes(id)) ids.push(id);
      };

      if (checked) add(action);
      else remove(action);

      // Cascade: once any action changes, drop every OTHER granted action on
      // this resource whose prerequisite(s) are no longer satisfied (e.g.
      // turning off View used to hand-roll "clear everything else"; turning
      // off both Create and Update now also drops Magic). Repeated to a
      // fixed point - prerequisite depth here is only ever 1, but this stays
      // correct even if that changes.
      let changed = true;
      while (changed) {
        changed = false;
        for (const a of permissionActionsFor(resource)) {
          if (!has(a)) continue;
          const prereqs = permissionPrerequisites(resource, a);
          if (prereqs.length > 0 && !prereqs.some(has)) {
            remove(a);
            changed = true;
          }
        }
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
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
  const singletons = allTypes
    .filter((t) => t.kind === "singleton")
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
  const systemResources = SYSTEM_RESOURCES.slice().sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const grantedIds = new Set(
    Array.isArray(value.permissions) ? (value.permissions as string[]) : [],
  );

  /** Shared by the Collections and Singletons fieldsets below - a
   * collapsible per-resource row with a summary dot per action and a
   * switches panel underneath. A singleton's `expected` is always
   * `["setting"]` (one dot, one switch), so this reads identically to the
   * old flat single-CheckField layout it replaces, just wrapped in the same
   * `<details>` shell Collections already uses. */
  function renderPermissionResource(resource: ContentTypeDefinition) {
    const expected = permissionActionsFor(resource);
    const isGranted = (action: PermissionAction) => {
      const permId = permissionIdFor(resource, action);
      return !!permId && grantedIds.has(permId);
    };
    const viewGranted = expected.includes("view") ? isGranted("view") : true;
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
              onChange={(checked) => togglePermission(resource, action, checked)}
            />
          ))}
        </div>
      </details>
    );
  }

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
        {(!isNew || isDirty) && (
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

      <div inert={!canEditRole || undefined}>
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
                {resources.map(renderPermissionResource)}
              </div>
            </fieldset>

            {singletons.length > 0 && (
              <fieldset>
                <legend>Singletons</legend>
                <div class="permission-view-card">
                  {singletons.map(renderPermissionResource)}
                </div>
              </fieldset>
            )}

            <fieldset>
              <legend>System</legend>
              <div
                class="stack"
                style={{ marginBottom: "0.5rem", gap: "1rem" }}
              >
                {systemResources.map((resource) => {
                  const permissionId = permissionIdFor(resource, "setting");
                  return (
                    <div key={resource.id}>
                      <CheckField
                        role="switch"
                        label={resource.label}
                        description={
                          resource.description ?? "Grant access to this page."
                        }
                        value={!!permissionId && grantedIds.has(permissionId)}
                        onChange={(checked) =>
                          togglePermission(resource, "setting", checked)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>

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
      </div>

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
