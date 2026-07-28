import { planMigration, type Statement } from "./migration.js";
import { SYSTEM_COMPONENT_IDS } from "./system-fields.js";
import type { ContentTypeDefinition } from "./types.js";

/** Fixed ids for the built-in default content types/fields, so re-running
 * `pendingSeedStatements` on every boot (see the engine adapters) always
 * resolves the same identity instead of minting a new row each time. `seo`
 * itself is `SYSTEM_COMPONENT_IDS.seo` (shared with `system-fields.ts`,
 * which embeds it via `features.seo` - the same fixed id both files need to
 * agree on has to live in one of them, not be duplicated in both). */
const IDS = {
  user: "system-user",
  userName: "system-user-name",
  userEmail: "system-user-email",
  userPassword: "system-user-password",
  menu: "system-menu",
  menuName: "system-menu-name",
  menuRefs: "system-menu-refs",
  menuItem: "system-menu-item",
  menuItemLabel: "system-menu-item-label",
  menuItemDescription: "system-menu-item-description",
  menuItemHref: "system-menu-item-href",
  seoMetaTitle: "system-seo-meta-title",
  seoDescription: "system-seo-description",
  seoImage: "system-seo-image",
  aiKey: "system-ai-key-management",
  aiKeyName: "system-ai-key-management-name",
  aiKeyDescription: "system-ai-key-management-description",
  aiKeyProvider: "system-ai-key-management-provider",
  aiKeyKey: "system-ai-key-management-key",
  aiKeyUrl: "system-ai-key-management-url",
  userRoles: "system-user-roles",
  role: "system-role",
  roleName: "system-role-name",
  roleIsSuperAdmin: "system-role-is-super-admin",
  rolePermissions: "system-role-permissions",
  permission: "system-permission",
  permissionName: "system-permission-name",
  permissionIdTable: "system-permission-id-table",
} as const;

/**
 * The content types every app must have from first boot: a `user` collection
 * (for accounts able to sign in, with a `roles` relation to `role`), a `menu`
 * collection (a named group of links), the `menuItem` component `menu.refs`
 * repeats, an `seo` component any collection/singleton can flatten in via
 * `features.seo` (see `system-fields.ts`), an `aiKey` collection
 * (credentials for third-party AI providers), and `role`/`permission`
 * collections (role-based access control - see `status/role-permission.md`).
 * None of the seven are marked `system` - they're plain, ordinary content
 * types the admin can freely rename, edit, or delete, indistinguishable from
 * anything created by hand. Note that `pendingSeedStatements` re-seeds a
 * missing default by NAME on the next boot (it has no other way to tell
 * "missing" apart from "renamed") - so deleting one of these just gets it
 * silently re-created fresh next boot, while renaming one makes that boot
 * add a brand-new second copy under the original name instead. Deleting
 * `role`/`permission`/`aiKey`/`menuItem`/`seo` (even though it'll come back)
 * or renaming any of them will also break the functionality that depends on
 * their fixed shape/name in the meantime (raw SQL in `permissions.ts`, the
 * `seo`/`user.roles` features) - that's on the admin.
 * `createdAt`/`updatedAt` ride on `features.timestamps` instead of being
 * declared fields.
 */
export function defaultContentTypeDefinitions(): ContentTypeDefinition[] {
  const menuItem: ContentTypeDefinition = {
    id: IDS.menuItem,
    kind: "component",
    name: "menuItem",
    label: "Menu Item",
    description: "One link in a menu.",
    fields: [
      {
        id: IDS.menuItemLabel,
        name: "label",
        label: "Label",
        type: "text",
        config: {},
        validation: { required: true },
        order: 0,
      },
      {
        id: IDS.menuItemDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: {},
        validation: {},
        order: 1,
      },
      {
        id: IDS.menuItemHref,
        name: "href",
        label: "Href",
        type: "text",
        config: {},
        validation: { required: true, format: "url" },
        order: 2,
      },
    ],
    version: 0,
  };

  const seo: ContentTypeDefinition = {
    id: SYSTEM_COMPONENT_IDS.seo,
    kind: "component",
    name: "seo",
    label: "SEO",
    description: "Search-engine/social preview metadata.",
    fields: [
      // Named `metaTitle`, not `title` - naming.ts's RESERVED_NAMES blocks a
      // bare "title" on any field (it's the synthetic column `features.slug`
      // adds), even though this one would only ever appear prefixed
      // (`seo_metaTitle`) once flattened.
      {
        id: IDS.seoMetaTitle,
        name: "metaTitle",
        label: "Title",
        type: "text",
        config: {},
        validation: {},
        order: 0,
      },
      {
        id: IDS.seoDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: { multiline: true },
        validation: {},
        order: 1,
      },
      {
        id: IDS.seoImage,
        name: "image",
        label: "Image",
        type: "image",
        config: {},
        validation: {},
        order: 2,
      },
    ],
    version: 0,
  };

  const user: ContentTypeDefinition = {
    id: IDS.user,
    kind: "collection",
    name: "user",
    label: "User",
    description: "Accounts able to sign in.",
    features: { timestamps: true },
    fields: [
      {
        id: IDS.userName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true },
        order: 0,
      },
      {
        id: IDS.userEmail,
        name: "email",
        label: "Email",
        type: "text",
        config: {},
        validation: { required: true, unique: true, format: "email" },
        order: 1,
      },
      {
        id: IDS.userPassword,
        name: "password",
        label: "Password",
        type: "password",
        config: {},
        validation: { required: true },
        order: 2,
      },
      {
        id: IDS.userRoles,
        name: "roles",
        label: "Roles",
        type: "relation",
        config: { target: IDS.role, cardinality: "manyToMany" },
        validation: {},
        order: 3,
      },
    ],
    version: 0,
  };

  const menu: ContentTypeDefinition = {
    id: IDS.menu,
    kind: "collection",
    name: "menu",
    label: "Menu",
    description: "A named group of links, e.g. the site's main navigation.",
    features: { timestamps: true },
    fields: [
      {
        id: IDS.menuName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
        order: 0,
      },
      {
        id: IDS.menuRefs,
        name: "refs",
        label: "Items",
        type: "component",
        config: { componentId: IDS.menuItem, repeatable: true, sortable: true },
        validation: {},
        order: 1,
      },
    ],
    version: 0,
  };

  const aiKey: ContentTypeDefinition = {
    id: IDS.aiKey,
    kind: "collection",
    name: "aiKey",
    label: "AI Key",
    description: "Credentials for third-party AI providers.",
    fields: [
      {
        id: IDS.aiKeyName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true },
        order: 0,
      },
      {
        id: IDS.aiKeyDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: {},
        validation: {},
        order: 1,
      },
      {
        id: IDS.aiKeyProvider,
        name: "provider",
        label: "Provider",
        type: "select",
        config: {
          options: ["Google", "Anthropic", "ChatGPT", "Custom"],
          multiple: false,
        },
        validation: { required: true },
        order: 2,
      },
      {
        id: IDS.aiKeyKey,
        name: "key",
        label: "Key",
        type: "secretkey",
        config: {},
        validation: { required: true },
        order: 3,
      },
      {
        id: IDS.aiKeyUrl,
        name: "url",
        label: "URL",
        type: "text",
        config: {},
        validation: { format: "url" },
        order: 4,
      },
    ],
    version: 0,
  };

  const role: ContentTypeDefinition = {
    id: IDS.role,
    kind: "collection",
    name: "role",
    label: "Role",
    description: "A named set of permissions users can be assigned.",
    fields: [
      {
        id: IDS.roleName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
        order: 0,
      },
      {
        id: IDS.roleIsSuperAdmin,
        name: "isSuperAdmin",
        label: "Super Admin",
        type: "boolean",
        config: {},
        validation: {},
        default: false,
        order: 1,
      },
      {
        id: IDS.rolePermissions,
        name: "permissions",
        label: "Permissions",
        type: "relation",
        config: { target: IDS.permission, cardinality: "manyToMany" },
        validation: {},
        order: 2,
      },
    ],
    version: 0,
  };

  const permission: ContentTypeDefinition = {
    id: IDS.permission,
    kind: "collection",
    name: "permission",
    label: "Permission",
    description:
      "Auto-synced, one per collection/singleton - governs which role can operate on it.",
    fields: [
      {
        id: IDS.permissionName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
        order: 0,
      },
      {
        id: IDS.permissionIdTable,
        name: "idTable",
        label: "Table",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
        order: 1,
      },
    ],
    version: 0,
  };

  return [menuItem, seo, user, menu, aiKey, role, permission];
}

/**
 * Statements to create whichever default content types (by name,
 * case-insensitively) aren't already present - `[]` once every default has
 * been seeded once. Called on every bootstrap (not just when `metadata` is
 * first created) so a project upgraded to a drycms version that adds a new
 * default still picks it up, without re-seeding ones already there (which
 * would otherwise collide on name/id or clobber user edits to them).
 * `newAllTypes` for every planned type is the FULL default set regardless of
 * which are actually missing - `menu`'s plan needs to resolve the `menuItem`
 * component from it even on a run where `menuItem` itself isn't being
 * (re-)created.
 */
export function pendingSeedStatements(
  existingNamesLowercase: ReadonlySet<string>,
): Statement[] {
  const all = defaultContentTypeDefinitions();
  const missing = all.filter(
    (t) => !existingNamesLowercase.has(t.name.toLowerCase()),
  );

  const statements: Statement[] = [];
  for (const target of missing) {
    const plan = planMigration({ target, oldAllTypes: [], newAllTypes: all });
    for (const table of plan.tables) statements.push(...table.statements);
    statements.push(plan.metadataStatement);
  }
  return statements;
}
