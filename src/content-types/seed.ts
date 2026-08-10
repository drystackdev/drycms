import type { EntryValue } from "./engine/entry-codec.js";
import type { ContentEntryEngineAdapter } from "./engine/entries-types.js";
import { planMigration, type Statement } from "./migration.js";
import { GITHUB_SYNC_TYPE_ID, GOOGLE_VERIFICATION_TYPE_ID, SEO_DEFAULTS_TYPE_ID, SYSTEM_COMPONENT_IDS } from "./system-fields.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * The shape `scripts/lib/schema-sync.ts`'s `writeContentTypeSeedFile` writes
 * into `src/apps/schema.json` (`contentTypes`) and `src/apps/seed.json`
 * (`singletonData`/`menuData`) - and what an admin's "Upload schema"/"Upload
 * seed data" upload (`BuilderContentType.tsx`, via
 * `routes/content-type-seed.ts`) parses back. Never auto-loaded: an app's
 * own content types/data are always an explicit, admin-triggered action now
 * (see that route's own doc comment for why the old always-on-boot,
 * static-import version of this was removed).
 */
export interface PackagedSeed {
  contentTypes: ContentTypeDefinition[];
  /**
   * A singleton's actual row value at the time `bun run seed:sync` last
   * ran, keyed by content-type `id` (stable across renames, same identity
   * `contentTypes` itself keeps). Deliberately singleton-only, not a general
   * entries/rows seed: a singleton is app-owned config (e.g. site-wide SEO
   * defaults), unlike a collection's rows, which are real user content.
   * Applied by `applyPackagedSingletonData` below.
   */
  singletonData?: Record<string, EntryValue>;
  /**
   * The `menu` collection's rows at the time `bun run seed:sync` last ran.
   * A deliberate, narrow exception to `singletonData`'s singleton-only rule
   * above: `menu` is the one collection the APP itself depends on
   * structurally - `apps/pages/layout.tsx` looks up a row named "Main
   * Navigation" by hand, so a fresh deployment with no menu row renders
   * every page with no navigation at all. That makes it app-owned config in
   * everything but storage kind. Still scoped to `menu` alone rather than a
   * general `collectionData`, so `blog`/`category`/... stay user content.
   *
   * Applied by `applyPackagedMenuData` below.
   */
  menuData?: EntryValue[];
}

/** Fixed ids for the built-in default content types/fields, so re-running
 * `pendingSeedStatements` on every boot (see the engine adapters) always
 * resolves the same identity instead of minting a new row each time. `seo`
 * itself is `SYSTEM_COMPONENT_IDS.seo` (shared with `system-fields.ts`,
 * which embeds it via `features.seo` - the same fixed id both files need to
 * agree on has to live in one of them, not be duplicated in both). */
const IDS = {
  user: "system-user",
  userName: "system-user-name",
  userAvatar: "system-user-avatar",
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
  seoNoIndex: "system-seo-no-index",
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
  memory: "system-memory",
  memoryUser: "system-memory-user",
  memoryData: "system-memory-data",
  memoryVersion: "system-memory-version",
  systemSettings: "system-settings",
  systemSettingsData: "system-settings-data",
  googleVerification: "system-google-verification-singleton",
  googleVerificationName: "system-google-verification-name",
  googleVerificationContent: "system-google-verification-content",
  githubSync: "system-github-sync-singleton",
  githubSyncEnabled: "system-github-sync-enabled",
  githubSyncRepo: "system-github-sync-repo",
  githubSyncBranch: "system-github-sync-branch",
  githubSyncToken: "system-github-sync-token",
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
 * `content-types/redirects.ts`), a `seoDefaults` singleton (the one
 * site-wide fallback SEO source - see `dry-seo.ts`'s `seoTierFor`), a
 * `memory` collection (per-account synced preferences, server-managed only -
 * see `routes/memory.ts`), and a `systemSettings` singleton (the admin UI's
 * shared color/typography theme - see `routes/system-settings.ts`).
 * `menuItem`/`menu` are plain, ordinary content types the admin can freely
 * rename, edit, or delete, indistinguishable from anything created by hand -
 * EXCEPT `user`/`seoDefaults`, which carry `locked: true` (their table can't
 * be deleted - see `types.ts`) - `user` also has `protectedFieldIds` over
 * its `name`/`avatar`/`email`/`password`/`roles` fields (its baseline
 * identity shape plus what login/permissions depend on, so none of them can
 * be edited or removed, even though the rest of `user`'s fields are as free
 * as any other type's). `seo`, `aiKey`, `role`,
 * `redirect`, `memory`, and `systemSettings` carry real restrictions too
 * (`hidden`/`locked`/`frozen` - see `types.ts`'s doc comments); `seoDefaults`
 * is ALSO `hidden` (reached through its own pinned System nav entry instead
 * of the generic Collection/Singleton group - see `DryLayout.tsx`). `user`
 * is NOT hidden - it shows in the generic Collection list/nav too (in
 * addition to its own pinned "Users" shortcut) so its schema stays reachable
 * through the ordinary content-type editor, even though it's still `locked`.
 * `role`/`aiKey`/`redirect` carry restrictions because the role schema is
 * consumed by the auth layer and `system-fields.ts` hardcodes
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
      {
        id: IDS.seoNoIndex,
        name: "noIndex",
        label: "Hide from search engines",
        type: "boolean",
        config: {},
        validation: {},
        default: false,
        order: 3,
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
    // Also reachable via its own pinned "Users" nav entry (`DryLayout.tsx`,
    // System section) as a shortcut, but NOT `hidden` - it shows in the
    // generic Collection list/dropdown too, so its schema can be reached
    // through the ordinary content-type editor to add custom fields.
    // The table itself can't be deleted (login depends on it existing).
    // `name`/`avatar`/`email`/`password` individually can't be edited or
    // removed either (identity fields every account is expected to have),
    // same for `roles` (permissions depend on its fixed shape) - every OTHER
    // field stays as freely addable/editable/removable as any other type's.
    locked: true,
    protectedFieldIds: [IDS.userName, IDS.userAvatar, IDS.userEmail, IDS.userPassword, IDS.userRoles],
    fields: [
      {
        id: IDS.userAvatar,
        name: "avatar",
        label: "Avatar",
        type: "avatar",
        config: {},
        validation: {},
        order: 0,
      },
      {
        id: IDS.userName,
        name: "name",
        label: "Name",
        type: "text",
        config: {},
        validation: { required: true },
        order: 1,
      },
      {
        id: IDS.userEmail,
        name: "email",
        label: "Email",
        type: "text",
        config: {},
        validation: { required: true, unique: true, format: "email" },
        order: 2,
      },
      {
        id: IDS.userPassword,
        name: "password",
        label: "Password",
        type: "password",
        config: {},
        validation: { required: true },
        order: 3,
      },
      {
        id: IDS.userRoles,
        name: "roles",
        label: "Roles",
        type: "relation",
        config: { target: IDS.role, cardinality: "manyToMany" },
        validation: {},
        order: 4,
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
    // Reached via its own pinned "SEO Defaults" nav entry (`DryLayout.tsx`,
    // System section) instead of the generic Singleton nav group - same
    // mechanism `redirect`/`aiKey` use for collections, applied here to a
    // singleton. Still ordinary user-facing content (the actual meta title/
    // description/image an admin fills in) through the generic singleton
    // editor - only the nav GROUPING moved. `locked` only - deleting the
    // table would silently break the SEO cascade's "Default" layer
    // (`dry-seo.ts`), but nothing else needs its schema frozen the way
    // `role`/`aiKey`'s do.
    hidden: true,
    locked: true,
    features: { seo: true },
    fields: [],
    version: 0,
  };

  const memory: ContentTypeDefinition = {
    id: IDS.memory,
    kind: "collection",
    name: "memory",
    label: "Memory",
    description: "Per-account synced preferences/history - server-managed only.",
    // Completely invisible: no dedicated nav entry either, unlike
    // `role`/`aiKey`/`redirect` (which are `hidden` from the generic
    // Collection group but still reachable through their own pinned nav
    // entry + page). This one has neither - the ONLY access path is the
    // self-service `routes/memory.ts` (`/api/memory`), which always scopes
    // to the calling session's own `user` id and never goes through the
    // generic content-entries permission model at all (see that route's own
    // doc comment) - `hidden`/`locked`/`frozen` here just keep it out of
    // every admin picker/list, they don't grant any UI access on their own.
    hidden: true,
    locked: true,
    frozen: true,
    fields: [
      {
        id: IDS.memoryUser,
        name: "user",
        label: "User",
        type: "relation",
        // `manyToOne`, not a real DB-level one-to-one (unsupported by
        // `RelationCardinality`) - "at most one row per user" is enforced by
        // `routes/memory.ts` always finding-or-creating by this field before
        // ever inserting, not by a table constraint.
        config: { target: IDS.user, cardinality: "manyToOne" },
        validation: { required: true },
        order: 0,
      },
      {
        id: IDS.memoryData,
        name: "data",
        label: "Data",
        type: "text",
        // JSON-serialized blob (no native "json" field type exists yet - see
        // `field-registry.ts`) - same convention `aiKey.model` already uses
        // for a structured value stored in a plain text column.
        config: { multiline: true },
        validation: {},
        order: 1,
      },
      {
        id: IDS.memoryVersion,
        name: "version",
        label: "Version",
        type: "number",
        // Client-visible optimistic-lock counter for the sync protocol
        // itself (distinct from `ContentTypeDefinition.version`, the
        // unrelated schema-version counter every type already carries) -
        // server always bumps this by 1 on a successful write; a client
        // write carrying a stale version is rejected, never merged.
        config: { step: 1 },
        validation: { required: true },
        default: 0,
        order: 2,
      },
    ],
    version: 0,
  };

  const systemSettings: ContentTypeDefinition = {
    id: IDS.systemSettings,
    kind: "singleton",
    name: "systemSettings",
    label: "System Settings",
    description: "Admin UI theme (colors/typography), shared by every user - Super Admin only.",
    // Reached via its own pinned "Settings" nav entry (`DryLayout.tsx`,
    // already stubbed) instead of the generic Singleton group - same
    // treatment as `seoDefaults`/`user` above, not because its schema is
    // frozen (it isn't - an ordinary singleton, editable through the normal
    // content-entries API), just because a custom color-picker/live-preview
    // page (`Settings.tsx`) replaces the generic field-loop editor.
    hidden: true,
    locked: true,
    frozen: true,
    fields: [
      {
        id: IDS.systemSettingsData,
        name: "data",
        label: "Data",
        type: "text",
        // One JSON-serialized blob, not 12+ separate columns - nothing here
        // is ever queried/filtered/sorted (the admin app always reads the
        // one live row whole - `routes/system-settings.ts`), so per-field
        // columns would only have added schema-editor noise and migration
        // churn for every new setting, same reasoning `memory.data` already
        // uses. Shape: `lib/system-settings-theme.ts`'s
        // `SystemSettingsThemeInput` - the source of truth for what's
        // actually in here, not this field definition.
        config: { multiline: true },
        validation: {},
        order: 0,
      },
    ],
    version: 0,
  };

  const googleVerification: ContentTypeDefinition = {
    id: GOOGLE_VERIFICATION_TYPE_ID,
    kind: "singleton",
    name: "googleVerification",
    label: "Google Verification",
    description: "Serves Google's site-ownership verification content at the exact domain root, without an uploaded file.",
    // Reached via its own "Google Verification" sub-item under the "Settings"
    // nav group (`DryLayout.tsx`), same treatment as `systemSettings`/
    // `seoDefaults` above - a dedicated 2-field page (`GoogleVerificationSettings.tsx`)
    // replaces the generic singleton editor.
    hidden: true,
    locked: true,
    frozen: true,
    fields: [
      {
        id: IDS.googleVerificationName,
        name: "name",
        label: "Name",
        type: "text",
        // `google-verification.ts`'s `tryServeGoogleVerificationFile` matches
        // this verbatim against the request path (`/<name>`) - Google's own
        // instructions give you this filename (e.g.
        // "google1234567890abcdef.html") alongside `content` below.
        description: "The exact filename Google Search Console gives you, e.g. google1234567890abcdef.html - served at https://yourdomain.com/<name>.",
        config: { placeholder: "google1234567890abcdef.html" },
        validation: { required: true },
        order: 0,
      },
      {
        id: IDS.googleVerificationContent,
        name: "content",
        label: "Content",
        type: "text",
        description: "The exact file content Google gives you alongside the filename above - served verbatim as the response body.",
        config: { multiline: true, placeholder: "google-site-verification: google1234567890abcdef.html" },
        validation: { required: true },
        order: 1,
      },
    ],
    version: 0,
  };

  const githubSync: ContentTypeDefinition = {
    id: GITHUB_SYNC_TYPE_ID,
    kind: "singleton",
    name: "githubSync",
    label: "GitHub Sync",
    description: "Pushes a snapshot commit of the pages-source tree to a GitHub repo on every Build/Build all - version history for what pagesSourceStorage otherwise only keeps as a working copy.",
    // Reached via its own "GitHub Sync" sub-item under the "Settings" nav
    // group (`DryLayout.tsx`), same treatment as `googleVerification` above -
    // a dedicated small form (`GithubSyncSettings.tsx`) replaces the generic
    // singleton editor.
    hidden: true,
    locked: true,
    frozen: true,
    fields: [
      {
        id: IDS.githubSyncEnabled,
        name: "enabled",
        label: "Enabled",
        type: "boolean",
        description: "Off by default - Build/Build all skip the GitHub push entirely (no error, no toast) until this is turned on and repo/token below are filled in.",
        config: {},
        validation: {},
        default: false,
        order: 0,
      },
      {
        id: IDS.githubSyncRepo,
        name: "repo",
        label: "Repository",
        type: "text",
        description: "owner/name of the GitHub repo the snapshot commit is pushed to.",
        config: { placeholder: "your-org/your-site" },
        validation: { required: true },
        order: 1,
      },
      {
        id: IDS.githubSyncBranch,
        name: "branch",
        label: "Branch",
        type: "text",
        description: "Branch ref the snapshot commit updates - created if it doesn't exist yet.",
        config: { placeholder: "main" },
        validation: { required: true },
        default: "main",
        order: 2,
      },
      {
        id: IDS.githubSyncToken,
        name: "token",
        label: "Access Token",
        type: "secretkey",
        description: "A GitHub Personal Access Token (classic or fine-grained) with Contents: Read and write on the repo above.",
        config: {},
        validation: { required: true },
        order: 3,
      },
    ],
    version: 0,
  };

  return [menuItem, seo, user, menu, aiKey, role, redirect, seoDefaults, memory, systemSettings, googleVerification, githubSync];
}

/**
 * Seeds an uploaded `PackagedSeed`'s `singletonData` into any singleton that
 * doesn't have a row yet. Called from `routes/content-type-seed.ts`'s
 * "Upload seed data" apply mode (admin-triggered, any time) - never
 * automatically at boot anymore, so `packagedSeed` is a real, required
 * argument, not a module-scope default.
 *
 * `password`/`secretkey` fields never round-trip through this: a captured
 * row's value for one is the masked `{hasExisting: true}` marker
 * (`entry-codec.ts`'s `rowToValue`), which `valueToRow` writes nothing for on
 * insert - a singleton seeded this way gets every OTHER field populated, but
 * that one column stays empty until the admin sets it by hand.
 */
export async function applyPackagedSingletonData(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  packagedSeed: PackagedSeed,
): Promise<void> {
  const data = packagedSeed.singletonData;
  if (!data) return;
  // Mirrors `schema-sync.ts`'s write-side exclusion: system singletons
  // (`seoDefaults`/`systemSettings`/`googleVerification`/`githubSync`) hold
  // per-deployment operational config, never something to seed from an
  // uploaded file - a hand-edited or pre-exclusion seed.json must not be
  // able to push one onto a live site through "Upload seed data".
  const systemIds = new Set(defaultContentTypeDefinitions().map((t) => t.id));
  for (const type of allTypes) {
    if (type.kind !== "singleton" || systemIds.has(type.id)) continue;
    const value = data[type.id];
    if (!value) continue;
    const existing = await entryAdapter.getSingletonEntry(type, allTypes);
    if (existing) continue;
    await entryAdapter.saveSingletonEntry(type, allTypes, value);
  }
}

/** The `menu` content type's fixed id - exported so `scripts/lib/schema-sync.ts`
 * can find the same type when snapshotting `menuData` without re-typing the
 * literal. */
export const MENU_TYPE_ID = IDS.menu;

/**
 * Seeds an uploaded `PackagedSeed`'s `menuData` into the `menu` collection,
 * from the same "Upload seed data" apply mode as `applyPackagedSingletonData`
 * above.
 *
 * ALL-OR-NOTHING on the collection being empty, rather than
 * `applyPackagedSingletonData`'s per-row check: a menu is an ordered list
 * whose rows only make sense together, and the emptiness test is what makes
 * re-running this harmless. Identified by the fixed `system-menu` id rather
 * than the name "menu", the same rename-proof identity `singletonData`'s own
 * keys use.
 */
export async function applyPackagedMenuData(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  packagedSeed: PackagedSeed,
): Promise<void> {
  const rows = packagedSeed.menuData;
  if (!rows || rows.length === 0) return;

  const menuType = allTypes.find((type) => type.id === MENU_TYPE_ID);
  if (!menuType || menuType.kind !== "collection") return;

  const existing = await entryAdapter.listEntries(menuType, allTypes, { page: 0, pageSize: 1 });
  if (existing.rows.length > 0) return;

  for (const value of rows) {
    await entryAdapter.createEntry(menuType, allTypes, value);
  }
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
 * (re-)created. "Default" here always means the 12 built-in system types
 * (`defaultContentTypeDefinitions()`) - an app's own content types are never
 * auto-seeded, see "Upload schema" (`routes/content-type-seed.ts`).
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
