import { planMigration, type Statement } from "./migration.js";
import { SYSTEM_COMPONENT_IDS } from "./system-fields.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

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
  aiKeyManagement: "system-ai-key-management",
  aiKeyManagementName: "system-ai-key-management-name",
  aiKeyManagementDescription: "system-ai-key-management-description",
  aiKeyManagementProvider: "system-ai-key-management-provider",
  aiKeyManagementKey: "system-ai-key-management-key",
  aiKeyManagementUrl: "system-ai-key-management-url",
} as const;

function lockedField(overrides: Omit<FieldDefinition, "locked">): FieldDefinition {
  return { ...overrides, locked: true };
}

/**
 * The content types every app must have from first boot: a `user` collection
 * (for accounts able to sign in), a `menu` collection (a named group of
 * links), the `menuItem` component `menu.refs` repeats, an `seo` component
 * any collection/singleton can flatten in via `features.seo` (see
 * `system-fields.ts`), and an `aiKeyManagement` collection (credentials for
 * third-party AI providers). All five are `system: true` (can't be deleted)
 * and every declared field is `locked: true` (can't be removed) - new fields
 * can still be added, and everything can still be reordered; see
 * `naming.ts`'s `validateSystemProtections` for the enforcement.
 * `createdAt`/`updatedAt` ride on `features.timestamps` instead of being
 * declared fields - same protection, since a `system` type's already-on
 * features can't be turned off either.
 */
export function defaultContentTypeDefinitions(): ContentTypeDefinition[] {
  const menuItem: ContentTypeDefinition = {
    id: IDS.menuItem,
    kind: "component",
    name: "menuItem",
    label: "Menu Item",
    description: "One link in a menu.",
    fields: [
      lockedField({
        id: IDS.menuItemLabel,
        name: "label",
        label: "Label",
        type: "text",
        config: {},
        validation: { required: true },
        order: 0,
      }),
      lockedField({
        id: IDS.menuItemDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: {},
        validation: {},
        order: 1,
      }),
      lockedField({
        id: IDS.menuItemHref,
        name: "href",
        label: "Href",
        type: "text",
        config: {},
        validation: { required: true, format: "url" },
        order: 2,
      }),
    ],
    version: 0,
    system: true,
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
      lockedField({
        id: IDS.seoMetaTitle,
        name: "metaTitle",
        label: "Title",
        type: "text",
        config: {},
        validation: {},
        order: 0,
      }),
      lockedField({
        id: IDS.seoDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: { multiline: true },
        validation: {},
        order: 1,
      }),
      lockedField({
        id: IDS.seoImage,
        name: "image",
        label: "Image",
        type: "image",
        config: {},
        validation: {},
        order: 2,
      }),
    ],
    version: 0,
    system: true,
  };

  const user: ContentTypeDefinition = {
    id: IDS.user,
    kind: "collection",
    name: "user",
    label: "User",
    description: "Accounts able to sign in.",
    features: { timestamps: true },
    fields: [
      lockedField({
        id: IDS.userName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true },
        order: 0,
      }),
      lockedField({
        id: IDS.userEmail,
        name: "email",
        label: "Email",
        type: "text",
        config: {},
        validation: { required: true, unique: true, format: "email" },
        order: 1,
      }),
      lockedField({
        id: IDS.userPassword,
        name: "password",
        label: "Password",
        type: "password",
        config: {},
        validation: { required: true },
        order: 2,
      }),
    ],
    version: 0,
    system: true,
  };

  const menu: ContentTypeDefinition = {
    id: IDS.menu,
    kind: "collection",
    name: "menu",
    label: "Menu",
    description: "A named group of links, e.g. the site's main navigation.",
    features: { timestamps: true },
    fields: [
      lockedField({
        id: IDS.menuName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
        order: 0,
      }),
      lockedField({
        id: IDS.menuRefs,
        name: "refs",
        label: "Items",
        type: "component",
        config: { componentId: IDS.menuItem, repeatable: true },
        validation: {},
        order: 1,
      }),
    ],
    version: 0,
    system: true,
  };

  const aiKeyManagement: ContentTypeDefinition = {
    id: IDS.aiKeyManagement,
    kind: "collection",
    name: "aiKeyManagement",
    label: "AI Key Management",
    description: "Credentials for third-party AI providers.",
    fields: [
      lockedField({
        id: IDS.aiKeyManagementName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true },
        order: 0,
      }),
      lockedField({
        id: IDS.aiKeyManagementDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: {},
        validation: {},
        order: 1,
      }),
      lockedField({
        id: IDS.aiKeyManagementProvider,
        name: "provider",
        label: "Provider",
        type: "select",
        config: { options: ["Google", "Anthropic", "ChatGPT", "Custom"], multiple: false },
        validation: { required: true },
        order: 2,
      }),
      lockedField({
        id: IDS.aiKeyManagementKey,
        name: "key",
        label: "Key",
        type: "secretkey",
        config: {},
        validation: { required: true },
        order: 3,
      }),
      lockedField({
        id: IDS.aiKeyManagementUrl,
        name: "url",
        label: "URL",
        type: "text",
        config: {},
        validation: { format: "url" },
        order: 4,
      }),
    ],
    version: 0,
    system: true,
  };

  return [menuItem, seo, user, menu, aiKeyManagement];
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
export function pendingSeedStatements(existingNamesLowercase: ReadonlySet<string>): Statement[] {
  const all = defaultContentTypeDefinitions();
  const missing = all.filter((t) => !existingNamesLowercase.has(t.name.toLowerCase()));

  const statements: Statement[] = [];
  for (const target of missing) {
    const plan = planMigration({ target, oldAllTypes: [], newAllTypes: all });
    for (const table of plan.tables) statements.push(...table.statements);
    statements.push(plan.metadataStatement);
  }
  return statements;
}
