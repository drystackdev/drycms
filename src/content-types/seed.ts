import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { planMigration, type Statement } from "./migration.js";
import { SEO_DEFAULTS_TYPE_ID, SYSTEM_COMPONENT_IDS } from "./system-fields.js";
import type { ContentTypeDefinition } from "./types.js";

export interface PackagedSeed {
  contentTypes: ContentTypeDefinition[];
}

/**
 * `dry.seed.json` (repo root, alongside `dry.config.ts`) is an app's own
 * packaged content-type seed - see `plans/content-type-seed.md`. Read with
 * plain `node:fs`, synchronously, tolerating absence - the exact same idiom
 * `server/options.ts`'s `readDotEnv` already uses for `.env`. Deliberately
 * NOT Vite's `import.meta.glob` (which would also tolerate absence): this
 * module is reached from plain `bun scripts/*.ts` runs too (`seed-sync.ts`,
 * `dry-generate.ts`, both import the content engine, which imports this
 * file) - those never go through Vite at all, so `import.meta.glob` isn't a
 * real function there and throws the moment this module loads. `node:fs`
 * works identically under bun, Node, and Vite's SSR module graph.
 */
function loadPackagedSeed(): PackagedSeed | undefined {
  try {
    return JSON.parse(readFileSync(resolvePath(process.cwd(), "dry.seed.json"), "utf8")) as PackagedSeed;
  } catch {
    return undefined;
  }
}

const realPackagedSeed = loadPackagedSeed();

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
  aiKeyModel: "system-ai-key-management-model",
  aiKeyKey: "system-ai-key-management-key",
  aiKeyUrl: "system-ai-key-management-url",
  userRoles: "system-user-roles",
  role: "system-role",
  roleName: "system-role-name",
  roleDescription: "system-role-description",
  roleIsSuperAdmin: "system-role-is-super-admin",
  redirect: "system-redirect",
  redirectFrom: "system-redirect-from",
  redirectTo: "system-redirect-to",
} as const;

/**
 * The content types every app must have from first boot: a `user` collection
 * (for accounts able to sign in, with a `roles` relation to `role`), a `menu`
 * collection (a named group of links), the `menuItem` component `menu.refs`
 * repeats, an `seo` component any collection/singleton can flatten in via
 * `features.seo` (see `system-fields.ts`), an `aiKey` collection
 * (credentials for third-party AI providers), a `role` collection
 * (role-based access control), a `redirect` collection (301 targets, auto-
 * populated whenever a slugged entry's slug changes - see
 * `content-types/redirects.ts`), and a `seoDefaults` singleton (the one
 * site-wide fallback SEO source - see `dry-seo.ts`'s `seoTierFor`).
 * `menuItem`/`user`/`menu` are plain, ordinary content types the admin can
 * freely rename, edit, or delete, indistinguishable from anything created by
 * hand - EXCEPT `user`/`seoDefaults`, which carry `locked: true` (their
 * table can't be deleted - see `types.ts`) - `user` also has
 * `protectedFieldIds` over its `email`/`password`/`roles` fields (needed for
 * login/permissions, so they can't be edited or removed either, even though
 * the rest of `user`'s fields are as free as any other type's). `seo`,
 * `aiKey`, `role`, and `redirect` carry real restrictions too (`hidden`/
 * `locked`/`frozen` - see `types.ts`'s doc comments), because the role
 * schema is consumed by the auth layer and `system-fields.ts` hardcodes
 * `seo`'s id - reshaping any of them through the generic schema editor would silently
 * break that. `seoDefaults` is recognized by its fixed id
 * (`SEO_DEFAULTS_TYPE_ID`), not by name, so renaming it (still allowed,
 * unlike `role`/`aiKey`) doesn't break the SEO cascade.
 * Note that `pendingSeedStatements` re-seeds a missing default by NAME on the
 * next boot (it has no other way to tell "missing" apart from "renamed") -
 * so deleting one of these just gets it silently re-created fresh next boot,
 * while renaming one makes that boot add a brand-new second copy under the
 * original name instead.
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
        config: { multiline: true },
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
    // Hidden from the component-target picker (only ever embedded via
    // `features.seo`, never picked by hand) and locked (its id is hardcoded
    // in `system-fields.ts`'s `SYSTEM_COMPONENT_IDS.seo`) - but its own
    // fields stay freely addable/editable, unlike `role`/
    // `aiKey`'s `frozen` schema (see `types.ts`'s doc comments).
    hidden: true,
    locked: true,
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
    // The table itself can't be deleted (login depends on it existing), and
    // email/password/roles individually can't be edited or removed either
    // (login/permissions depend on their fixed shape) - every other field
    // stays as freely addable/editable/removable as any other type's.
    locked: true,
    protectedFieldIds: [IDS.userEmail, IDS.userPassword, IDS.userRoles],
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
    fieldSides: { [IDS.menuRefs]: "left" },
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
    // Completely out of the generic content-type machinery - reached via its
    // own pinned "AI Keys" nav entry (`DryLayout.tsx`) instead, same as
    // `role` via `Roles.tsx`/`RoleEditor.tsx` - see `types.ts`'s
    // doc comments for what `hidden`/`locked`/`frozen` each mean.
    hidden: true,
    locked: true,
    frozen: true,
    features: { sortable: true },
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
        config: { multiline: true },
        validation: {},
        order: 1,
      },
      {
        id: IDS.aiKeyProvider,
        name: "provider",
        label: "Provider",
        type: "select",
        config: { options: ["Google", "Anthropic", "ChatGPT", "Custom"], multiple: false },
        validation: { required: true },
        order: 2,
      },
      {
        id: IDS.aiKeyModel,
        name: "model",
        label: "Model",
        // Multiple models per key (e.g. one fast + one high-quality) - the
        // caller-facing dialogs (Magic Write, the schema wizard) let the
        // admin pick which one of THIS key's configured models to use for
        // that one request; `options` stays empty because the real list is
        // fetched live from the provider (`AiKeyEditor.tsx`'s `loadModels`),
        // same as `role.permissions`'s empty-`options` precedent.
        type: "select",
        config: { options: [], multiple: true },
        validation: { required: true },
        order: 3,
      },
      {
        id: IDS.aiKeyKey,
        name: "key",
        label: "Key",
        type: "secretkey",
        config: {},
        validation: { required: true },
        order: 4,
      },
      {
        id: IDS.aiKeyUrl,
        name: "url",
        label: "URL",
        type: "text",
        config: {},
        validation: { format: "url" },
        order: 5,
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
    // Managed via `Roles.tsx`/`RoleEditor.tsx` instead - see `aiKey`'s
    // comment above for what these three flags mean.
    hidden: true,
    locked: true,
    frozen: true,
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
        id: IDS.roleDescription,
        name: "description",
        label: "Description",
        type: "text",
        config: { multiline: true, placeholder: "e.g. Can edit blog posts but not publish them" },
        validation: {},
        order: 1,
      },
      {
        id: IDS.roleIsSuperAdmin,
        name: "isSuperAdmin",
        label: "Super Admin",
        type: "boolean",
        config: {},
        validation: {},
        default: false,
        order: 2,
      },
      {
        id: "system-role-permissions",
        name: "permissions",
        label: "Permissions",
        type: "select",
        config: { options: [], multiple: true },
        validation: {},
        order: 3,
      },
    ],
    version: 0,
  };

  const redirect: ContentTypeDefinition = {
    id: IDS.redirect,
    kind: "collection",
    name: "redirect",
    label: "Redirect",
    description: "Automatic 301 redirects, created when a slugged entry's slug changes.",
    // Managed via its own "Redirects" nav entry (`DryLayout.tsx`) instead of the
    // generic content-type picker - see `aiKey`'s comment above for what these three
    // flags mean. Rows themselves are still ordinary entries, freely readable/
    // writable through the normal content-entries API by anyone with `redirect`
    // permission - only the SCHEMA (this definition) is frozen.
    hidden: true,
    locked: true,
    frozen: true,
    fields: [
      {
        id: IDS.redirectFrom,
        name: "from",
        label: "From",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
        order: 0,
      },
      {
        id: IDS.redirectTo,
        name: "to",
        label: "To",
        type: "text",
        config: {},
        validation: { required: true },
        order: 1,
      },
    ],
    version: 0,
  };

  const seoDefaults: ContentTypeDefinition = {
    id: SEO_DEFAULTS_TYPE_ID,
    kind: "singleton",
    name: "seoDefaults",
    label: "SEO Defaults",
    description: "Site-wide fallback SEO, used by any page that doesn't set its own.",
    // Not `hidden` - it's ordinary user-facing content (the actual meta
    // title/description/image an admin fills in), just reached through the
    // generic singleton editor like `homepage`/`about` rather than a
    // dedicated page. `locked` only - deleting the table would silently
    // break the SEO cascade's "Default" layer (`dry-seo.ts`), but nothing
    // else needs its schema frozen the way `role`/`aiKey`'s do.
    locked: true,
    features: { seo: true },
    fields: [],
    version: 0,
  };

  return [menuItem, seo, user, menu, aiKey, role, redirect, seoDefaults];
}

/**
 * The list `pendingSeedStatements` treats as "must exist" - an app's own
 * `dry.seed.json` takes over COMPLETELY when present, in place of the 7
 * built-in defaults, not alongside them (`seed:sync`, which produces that
 * file, snapshots the FULL content-type list of a real dev DB, so it already
 * includes copies of `user`/`role`/etc. - see `plans/content-type-seed.md`).
 * Only falls back to `defaultContentTypeDefinitions()` when no
 * `dry.seed.json` exists - the ordinary drycms-with-no-app-seed case this
 * always was.
 *
 * `packagedSeed` defaults to the real, module-scope `loadPackagedSeed()`
 * result but is a plain parameter so tests can inject a fake one instead of
 * needing a real `dry.seed.json` on disk.
 */
export function resolveDefaultContentTypeDefinitions(
  packagedSeed: PackagedSeed | undefined = realPackagedSeed,
): ContentTypeDefinition[] {
  return packagedSeed?.contentTypes ?? defaultContentTypeDefinitions();
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
 * (re-)created. "Default" here means `resolveDefaultContentTypeDefinitions()`
 * - the packaged app seed when one exists, otherwise the 8 built-in types.
 */
export function pendingSeedStatements(
  existingNamesLowercase: ReadonlySet<string>,
): Statement[] {
  const all = resolveDefaultContentTypeDefinitions();
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
