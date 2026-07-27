import { planMigration, type Statement } from "./migration.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

/** Fixed ids for the built-in default content types/fields, so re-running
 * `pendingSeedStatements` on every boot (see the engine adapters) always
 * resolves the same identity instead of minting a new row each time. */
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
} as const;

function lockedField(overrides: Omit<FieldDefinition, "locked">): FieldDefinition {
  return { ...overrides, locked: true };
}

/**
 * The content types every app must have from first boot: a `user` collection
 * (for accounts able to sign in), a `menu` collection (a named group of
 * links), and the `menuItem` component `menu.refs` repeats. All three are
 * `system: true` (can't be deleted) and every declared field is `locked:
 * true` (can't be removed) - new fields can still be added, and everything
 * can still be reordered; see `naming.ts`'s `validateSystemProtections` for
 * the enforcement. `createdAt`/`updatedAt` ride on `features.timestamps`
 * instead of being declared fields - same protection, since a `system`
 * type's already-on features can't be turned off either.
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
      }),
      lockedField({
        id: IDS.menuItemDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: {},
        validation: {},
      }),
      lockedField({
        id: IDS.menuItemHref,
        name: "href",
        label: "Href",
        type: "text",
        config: {},
        validation: { required: true, format: "url" },
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
      }),
      lockedField({
        id: IDS.userEmail,
        name: "email",
        label: "Email",
        type: "text",
        config: {},
        validation: { required: true, unique: true, format: "email" },
      }),
      lockedField({
        id: IDS.userPassword,
        name: "password",
        label: "Password",
        type: "password",
        config: {},
        validation: { required: true },
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
      }),
      lockedField({
        id: IDS.menuRefs,
        name: "refs",
        label: "Items",
        type: "component",
        config: { componentId: IDS.menuItem, repeatable: true },
        validation: {},
      }),
    ],
    version: 0,
    system: true,
  };

  return [menuItem, user, menu];
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
