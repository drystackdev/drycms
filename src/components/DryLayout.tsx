import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { useLocation } from "preact-iso";
import type { ComponentChildren } from "preact";
import Icon from "./Icon.js";
import { LogOutIcon, UserIcon, type IconProps } from "./icons/index.js";
import Popover from "./Popover.js";
import SidebarToggle from "./SidebarToggle.js";
import SyncIndicator from "./SyncIndicator.js";
import Toaster from "./Toast.js";
import type { IconName } from "./icons/index.js";
const { path } = window.__DRY_CONFIG__;
import { collapsed } from "../store/dashboard.js";
import { contentTypesVersion } from "../store/content-types.js";
import { pageHeaderActions } from "../store/page-header.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";
import { initMemorySync, useStore } from "../hooks/useStore.js";
import { useFetch } from "../hooks/useFetch.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { resolveImageSrc } from "../storage/http-source.js";
import { authState, avatarVersion, canAccess, logout } from "../store/auth.js";
import {
  CONTENT_TYPES_RESOURCE_ID,
  ICON_MANAGEMENT_RESOURCE_ID,
  PAGE_BUILDER_RESOURCE_ID,
  RICHTEXT_COMPONENTS_RESOURCE_ID,
  type PermissionAction,
} from "../content-types/permissions.js";
import { temporaryFeatureVisibility } from "../lib/temporary-visibility.js";
import {
  countEntryDrafts,
  hasEntryDraft,
  hydrateEntryDraftIndex,
  watchEntryDraftIndex,
} from "../content-types/entry-draft-store.js";
import {
  hydrateContentTypeDraftIndex,
  watchContentTypeDraftIndex,
} from "../content-types/draft-store.js";

/** The MCP mark (two interlocking chain links) - not part of the generated
 * `icons/index.tsx` set (`scripts/build-icons.mjs` only pulls from Solar/
 * Lucide), so it's kept local to its one caller, same as `FileManager.tsx`'s
 * own `OptimizeIcon`. `stroke="currentColor"` (not the source SVG's literal
 * `#dedede`) so it themes/hovers like every other sidebar icon. */
function McpIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true" {...props}>
      <path
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.7"
        d="m4.4 15l11-11c1.5-1.5 4-1.5 5.5 0v0c1.5 1.5 1.5 4 0 5.5l-8.3 8.3m0 0l8.3-8.3c1.5-1.5 4-1.5 5.5 0l.057.057c1.5 1.5 1.5 4 0 5.5l-10 10c-.51.51-.51 1.3 0 1.8l2 2m-.4-22l-8.1 8.1c-1.5 1.5-1.5 4 0 5.5v0c1.5 1.5 4 1.5 5.5 0l8.1-8.1"
      />
    </svg>
  );
}

interface Props {
  children?: ComponentChildren;
}

const NAV: {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  ready: boolean;
  section: "Overview" | "Content" | "System";
  superAdminOnly?: boolean;
  permissionName?: string;
  /** Which action `permissionName`'s resolved resource id is checked with -
   * a collection's own real nav-worthy action is `"view"` (the default,
   * unchanged for every pre-existing entry below), but a `singleton` only
   * ever grants `"setting"` (see `permissions.ts`'s `permissionActionsFor`)
   * - `"view"` would never be a real grant for one, silently hiding the item
   * from anyone who isn't Super Admin. @default "view" */
  permissionAction?: PermissionAction;
  /** Like `permissionName`, but for a synthetic resource id with no real
   * `ContentTypeDefinition` row to look up (see `RoleEditor.tsx`'s
   * `PAGE_COMPONENTS_RESOURCE`) - checked directly via `canAccess`. */
  permissionResourceId?: string;
}[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: `${path}/dashboard`,
    icon: "Dashboard",
    ready: true,
    section: "Overview",
  },
  {
    key: "content-types",
    label: "Content Types",
    href: `${path}/content-types`,
    icon: "Content",
    ready: true,
    section: "Content",
    permissionResourceId: CONTENT_TYPES_RESOURCE_ID,
  },
  {
    key: "media",
    label: "Media",
    href: `${path}/media`,
    icon: "Media",
    ready: true,
    section: "Content",
  },
  {
    key: "icon-management",
    label: "Icon Management",
    href: `${path}/icon-management`,
    icon: "IconManagement",
    ready: true,
    section: "System",
    permissionResourceId: ICON_MANAGEMENT_RESOURCE_ID,
  },
  {
    key: "richtext-components",
    label: "Custom Components",
    href: `${path}/richtext-components`,
    icon: "Content",
    ready: true,
    section: "Content",
    permissionResourceId: RICHTEXT_COMPONENTS_RESOURCE_ID,
  },
  {
    key: "page-build",
    label: "Page Build",
    href: `${path}/page-build`,
    icon: "Export",
    ready: true,
    section: "System",
    permissionResourceId: PAGE_BUILDER_RESOURCE_ID,
  },
  {
    key: "page-editor",
    label: "Page Code Editor",
    href: `${path}/page-editor`,
    icon: "Content",
    ready: true,
    section: "System",
    permissionResourceId: PAGE_BUILDER_RESOURCE_ID,
  },
  {
    key: "roles",
    label: "Roles",
    href: `${path}/roles`,
    icon: "Roles",
    ready: true,
    section: "System",
    permissionName: "role",
  },
  {
    key: "users",
    label: "Users",
    href: `${path}/content/user`,
    icon: "Users",
    ready: true,
    section: "System",
    permissionName: "user",
  },
  {
    key: "seo-defaults",
    label: "SEO Defaults",
    href: `${path}/content/seoDefaults`,
    icon: "Content",
    ready: true,
    section: "System",
    permissionName: "seoDefaults",
    permissionAction: "setting",
  },
  {
    key: "ai-keys",
    label: "AI Keys",
    href: `${path}/content/aiKey`,
    icon: "AiKey",
    ready: true,
    section: "System",
    // Deliberately still `superAdminOnly`, not a grantable System toggle -
    // `protectSystemMutation` (server/routes/content-entries.ts) hard-blocks
    // non-super-admins from mutating `aiKey` rows unconditionally, so a
    // toggle here would grant a nav link that still 403s on every write.
    superAdminOnly: true,
  },
  {
    key: "redirects",
    label: "Redirects",
    href: `${path}/content/redirect`,
    icon: "Redirect",
    ready: true,
    section: "System",
    permissionName: "redirect",
  },
  {
    key: "backup",
    label: "Backup",
    href: `${path}/backup`,
    icon: "Archive",
    ready: true,
    section: "System",
    // Deliberately `superAdminOnly`, not a grantable System toggle - same
    // reasoning as `ai-keys` above: a full database backup/restore has no
    // per-Role notion of partial access.
    superAdminOnly: true,
  },
  // No flat "settings" entry here - it's rendered as its own expandable
  // `SidebarNavGroup` (2 static sub-items: Color schema/Google Verification)
  // right after this array's own `sectionItems`, same special-casing the
  // Content section already does for Collection/Singleton below.
];

const NAV_SECTIONS = ["Overview", "Content", "System"] as const;

const HIDDEN_NAV_KEYS = new Set(
  [
    !temporaryFeatureVisibility.richtextComponents && "richtext-components",
    !temporaryFeatureVisibility.pageBuild && "page-build",
  ].filter((key): key is string => Boolean(key)),
);

const CONTENT_PREFIX = `${path}/content/`;

/** Content-type slugs with their own dedicated top-level nav entry (e.g.
 * "Users" -> `/content/user`), derived from NAV so it can't drift out of
 * sync. `ContentEntryList` uses this to skip its back button for these -
 * they're primary destinations reached from the sidebar, not a drill-down
 * from the generic "Content" list, so there's nothing to go "back" to. */
export const pinnedContentTypeSlugs = new Set(
  NAV.filter((item) => item.href.startsWith(CONTENT_PREFIX)).map((item) =>
    item.href.slice(CONTENT_PREFIX.length),
  ),
);

/** Whether `href` is the active nav item for `url` - an exact match, or a
 * path segment beneath it (`${href}/...`). A plain `url.startsWith(href)`
 * would also match "/content-types" against href "/content" (since one
 * string just literally starts with the other's characters), lighting up
 * two nav items at once once the "Content" entry ships. */
function isActiveNavItem(url: string, href: string): boolean {
  return url === href || url.startsWith(`${href}/`);
}

/** One expandable sidebar group's sub-item - either a real content type
 * (Collection/Singleton groups, `href`/`badge` computed from it at the call
 * site) or a static destination (the Settings group below) - `SidebarNavGroup`
 * itself no longer needs to know which. */
interface SidebarNavGroupItem {
  id: string;
  label: string;
  href: string;
  /** Unsaved-draft indicator (a dot for a singleton, a count badge for a
   * collection) - see `entry-draft-store.ts` and `status/entry-drafts.md`.
   * Omitted (not just falsy) for a group with nothing to indicate. */
  badge?: ComponentChildren;
}

interface SidebarNavGroupProps {
  id: string;
  label: string;
  icon: IconName;
  items: SidebarNavGroupItem[];
  open: boolean;
  url: string;
  collapsed: boolean;
  onToggle: () => void;
}

/** An expandable sidebar parent with a fixed set of link sub-items - popover
 * menu when the sidebar is collapsed, an inline expand/collapse list
 * otherwise. Originally built for the Collection/Singleton content-type
 * groups (still their `items` source, mapped to `SidebarNavGroupItem` at the
 * call site); the Settings group below reuses the same component for its 2
 * static destinations instead of a bespoke nav pattern. */
function SidebarNavGroup({
  id,
  label,
  icon,
  items,
  open,
  url,
  collapsed,
  onToggle,
}: SidebarNavGroupProps) {
  const popupItems = (
    <>
      {items.map((item) => (
        <li key={item.id} class="sidebar-nav-popup-item">
          <a
            role="menuitem"
            href={item.href}
            aria-current={isActiveNavItem(url, item.href) ? "page" : undefined}
          >
            {item.label}
            {item.badge}
          </a>
        </li>
      ))}
    </>
  );

  return (
    <div class="nav-group">
      <div class="nav-group-header">
        {collapsed ? (
          <Popover
            label={`${label} menu`}
            tooltip={label}
            placement="right"
            closeOnItemClick
            trigger={(onClick, popupOpen) => (
              <button
                type="button"
                class="nav-group-toggle"
                aria-expanded={popupOpen}
                aria-haspopup="menu"
                data-tooltip={label}
                data-tooltip-placement="right"
                onClick={onClick}
              >
                <Icon name={icon} />
              </button>
            )}
          >
            {popupItems}
          </Popover>
        ) : (
          <button
            type="button"
            class="nav-group-toggle"
            aria-expanded={open}
            aria-controls={id}
            onClick={onToggle}
          >
            <Icon name={icon} />
            <span>{label}</span>
            <Icon
              name="ArrowDown"
              class={`nav-chevron${open ? "" : " collapsed"}`}
            />
          </button>
        )}
      </div>
      {!collapsed && (
        <div
          id={id}
          class={`nav-subitems-wrap${open ? " expanded" : ""}`}
          aria-hidden={!open}
        >
          <div class="nav-subitems">
            {items.map((item) => (
              <a
                key={item.id}
                href={item.href}
                class="nav-subitem"
                aria-current={isActiveNavItem(url, item.href) ? "page" : undefined}
              >
                <span>{item.label}</span>
                {item.badge}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** `resolveImageSrc(avatar)` plus `avatarVersion` as a cache-busting query
 * param - see that signal's own doc comment for why the sidebar's avatar
 * `<img>` needs one and a generic `resolveImageSrc()` call doesn't. */
function avatarSrc(avatar: string): string {
  return `${resolveImageSrc(avatar)}?v=${avatarVersion.value}`;
}

export default function DryLayout({ children }: Props) {
  const { url, route } = useLocation();
  const { ref: sidebar } = useOverlayScrollbars<HTMLDivElement>([], {
    overflow: { x: "hidden" },
  });
  const { ref: main, scrollToTop: scrollMainToTop } =
    useOverlayScrollbars<HTMLDivElement>();
  const [sidebarTransitionEnabled, setSidebarTransitionEnabled] =
    useState(false);

  const toggleCollapsed = () => {
    setSidebarTransitionEnabled(true);
    collapsed.value = !collapsed.value;
  };

  // Collection and Singleton submenu state is independent of the whole-sidebar
  // `collapsed` signal above and persists between visits.
  const [collectionMenuOpen, setCollectionMenuOpen] = useStore(
    "collectionSubmenuOpen",
    true,
  );
  const [singletonMenuOpen, setSingletonMenuOpen] = useStore(
    "singletonSubmenuOpen",
    true,
  );
  const [settingsMenuOpen, setSettingsMenuOpen] = useStore(
    "settingsSubmenuOpen",
    true,
  );
  const contentTypesApi = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );
  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) =>
      contentTypesApi.listVersioned(ifVersion, signal),
    [contentTypesApi],
  );
  // Same cache key `BuilderContentType.tsx` uses - a warm IndexedDB entry
  // from either page shows up instantly in the other. Unlike a route component,
  // this sidebar lives outside `<Router>` and never remounts (see
  // `App.tsx`), so `key` alone can't pick up a change made through
  // `ContentTypeEditor` - the `contentTypesVersion.value` effect below does
  // that instead, by calling this same hook's `reload()`.
  const { data: contentTypes, reload: reloadContentTypes } = useFetch<
    ContentTypeDefinition[]
  >("content-types:list", listFetcher);
  const skipFirstVersionEffect = useRef(true);
  useEffect(() => {
    if (skipFirstVersionEffect.current) {
      skipFirstVersionEffect.current = false;
      return;
    }
    void reloadContentTypes();
  }, [contentTypesVersion.value, reloadContentTypes]);
  // `hidden` types (role/aiKey) are reached through their own
  // dedicated page instead - see `types.ts`'s doc comment.
  const collectionNavItems = useMemo(
    () =>
      (contentTypes ?? []).filter(
        (t) => t.kind === "collection" && !t.hidden && canAccess(t.id, "view"),
      ),
    [contentTypes],
  );
  const singletonNavItems = useMemo(
    () =>
      (contentTypes ?? []).filter(
        (t) =>
          t.kind === "singleton" && !t.hidden && canAccess(t.id, "setting"),
      ),
    [contentTypes],
  );
  // Settings group's 2 static destinations - each gated on its own hidden
  // system singleton the same way `seo-defaults`/`ai-keys` above are (a
  // `permissionName` lookup + `canAccess(..., "setting")`), just done here
  // instead of through the flat `NAV` array since these render as a
  // `SidebarNavGroup`, not a plain link.
  const settingsNavItems = useMemo(() => {
    const items: SidebarNavGroupItem[] = [];
    const colorSchemaType = contentTypes?.find((t) => t.name === "systemSettings");
    if (colorSchemaType && canAccess(colorSchemaType.id, "setting")) {
      items.push({ id: "color-schema", label: "Color schema", href: `${path}/settings/color-schema` });
    }
    const googleVerificationType = contentTypes?.find((t) => t.name === "googleVerification");
    if (googleVerificationType && canAccess(googleVerificationType.id, "setting")) {
      items.push({ id: "google-verification", label: "Google Verification", href: `${path}/settings/google-verification` });
    }
    const githubSyncType = contentTypes?.find((t) => t.name === "githubSync");
    if (githubSyncType && canAccess(githubSyncType.id, "setting")) {
      items.push({ id: "github-sync", label: "GitHub Sync", href: `${path}/settings/github-sync` });
    }
    return items;
  }, [contentTypes]);

  // `.main`, not `window`, is the actual scrolling element (`.shell` is
  // pinned to `100dvh`) - preact-iso's own scroll-to-top-on-navigation
  // logic calls `window.scrollTo`, which is a no-op here, so a page that
  // mounts scrolled down (e.g. after leaving a long Dashboard) would
  // otherwise stay scrolled down on the next page too.
  useEffect(() => {
    scrollMainToTop();
  }, [url]);

  // One-time IndexedDB read to populate `entryDraftIndex` - the nav dot/badge
  // below pop in shortly after first paint rather than blocking on it (see
  // `entry-draft-store.ts`'s own doc comment). `DryLayout` never remounts
  // (outside `<Router>`, see `App.tsx`), so `[]` is correct here.
  // `watchEntryDraftIndex` keeps it current after that initial read whenever
  // a DIFFERENT tab changes a draft.
  useEffect(() => {
    void hydrateEntryDraftIndex();
    return watchEntryDraftIndex();
  }, []);

  // Same one-time-hydrate-then-watch treatment as the entry-draft effect
  // right above, for content-type schema drafts (`draft-store.ts`, now
  // IndexedDB-backed instead of synchronous localStorage).
  useEffect(() => {
    void hydrateContentTypeDraftIndex();
    return watchContentTypeDraftIndex();
  }, []);

  // One-time pull-then-reconcile against this account's server-side
  // `memory` row (see `hooks/useStore.tsx`'s `initMemorySync`) - as early as
  // possible after the authenticated shell mounts, same "`DryLayout` never
  // remounts" reasoning as the effect above.
  useEffect(() => {
    void initMemorySync();
  }, []);

  const shellClass = [
    "shell",
    collapsed.value && "collapsed",
    sidebarTransitionEnabled && "sidebar-transition-enabled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={shellClass}>
      <aside class="sidebar">
        <div class="sidebar-head">
          <a class="brand" href="/">
            <Icon name="Brand" />
            <span>DRYCMS</span>
          </a>

          <button
            type="button"
            class="ghost icon desktop-only"
            aria-expanded={!collapsed.value}
            aria-label="Collapse navigation"
            title="Collapse navigation"
            onClick={toggleCollapsed}
          >
            <Icon name={collapsed.value ? "ArrowRight" : "ArrowLeft"} />
          </button>
        </div>

        <div class="sidebar-scroll" ref={sidebar}>
          <nav aria-label="Admin">
            {NAV_SECTIONS.map((section) => {
              const sectionItems = NAV.filter(
                (item) =>
                  item.section === section &&
                  !HIDDEN_NAV_KEYS.has(item.key) &&
                  (!item.superAdminOnly ||
                    authState.value.user?.isSuperAdmin) &&
                  (!item.permissionName ||
                    (() => {
                      const type = contentTypes?.find(
                        (candidate) => candidate.name === item.permissionName,
                      );
                      return (
                        !!type &&
                        canAccess(type.id, item.permissionAction ?? "view")
                      );
                    })()) &&
                  (!item.permissionResourceId ||
                    canAccess(item.permissionResourceId, "setting")),
              );
              if (sectionItems.length === 0) return null;
              return (
                <div key={section} class="nav-section">
                  {!collapsed.value && (
                    <span class="nav-section-label">{section}</span>
                  )}
                  {section === "Content" && (
                    <>
                      {collectionNavItems.length > 0 && (
                        <SidebarNavGroup
                          id="collection-nav-subitems"
                          label="Collection"
                          icon="Collection"
                          items={collectionNavItems.map((type) => {
                            const count = countEntryDrafts(type.name);
                            return {
                              id: type.id,
                              label: type.label,
                              href: `${path}/content/${type.name}`,
                              badge: count > 0 ? <span class="badge sm secondary">{count}</span> : undefined,
                            };
                          })}
                          open={collectionMenuOpen}
                          url={url}
                          collapsed={collapsed.value}
                          onToggle={() =>
                            setCollectionMenuOpen(!collectionMenuOpen)
                          }
                        />
                      )}
                      {singletonNavItems.length > 0 && (
                        <SidebarNavGroup
                          id="singleton-nav-subitems"
                          label="Singleton"
                          icon="Singleton"
                          items={singletonNavItems.map((type) => ({
                            id: type.id,
                            label: type.label,
                            href: `${path}/content/${type.name}`,
                            badge: hasEntryDraft(type.name, null) ? (
                              <span class="nav-draft-dot" aria-label="Unsaved changes" />
                            ) : undefined,
                          }))}
                          open={singletonMenuOpen}
                          url={url}
                          collapsed={collapsed.value}
                          onToggle={() =>
                            setSingletonMenuOpen(!singletonMenuOpen)
                          }
                        />
                      )}
                    </>
                  )}
                  {section === "System" && settingsNavItems.length > 0 && (
                    <SidebarNavGroup
                      id="settings-nav-subitems"
                      label="Settings"
                      icon="Settings"
                      items={settingsNavItems}
                      open={settingsMenuOpen}
                      url={url}
                      collapsed={collapsed.value}
                      onToggle={() => setSettingsMenuOpen(!settingsMenuOpen)}
                    />
                  )}
                  {sectionItems.map((item) =>
                    item.ready ? (
                      <a
                        key={item.key}
                        href={item.href}
                        aria-current={
                          isActiveNavItem(url, item.href) ? "page" : undefined
                        }
                        data-tooltip={collapsed.value ? item.label : undefined}
                        data-tooltip-placement="right"
                      >
                        <Icon name={item.icon} />
                        <span>{item.label}</span>
                      </a>
                    ) : (
                      <a
                        key={item.key}
                        aria-disabled="true"
                        style="pointer-events: none; opacity: 0.55"
                        data-tooltip={collapsed.value ? item.label : undefined}
                        data-tooltip-placement="right"
                      >
                        <Icon name={item.icon} />
                        <span>{item.label}</span>
                        <span class="spacer" />
                        <span class="badge outline">Soon</span>
                      </a>
                    ),
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div class="sidebar-footer">
          {authState.value.user && (
            <Popover
              label="Account menu"
              tooltip=""
              // Custom `children` below don't auto-close the popover by
              // default (unlike `items`) - opted back in for the actual
              // menu actions (matched by their `role="menuitem"`) so
              // Profile/Logout behave exactly as they did as `items`, while
              // the theme buttons (no such role) stay exempt: toggling
              // theme shouldn't dismiss the menu you toggled it from.
              closeOnItemClick
              trigger={(onClick, open) => (
                <button
                  type="button"
                  class="sidebar-account"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={onClick}
                  data-tooltip={
                    collapsed.value ? authState.value.user!.name : undefined
                  }
                  data-tooltip-placement="right"
                >
                  <span class="sidebar-account-avatar">
                    {authState.value.user!.avatar ? (
                      <img src={avatarSrc(authState.value.user!.avatar)} alt="" />
                    ) : (
                      <UserIcon />
                    )}
                  </span>
                  {!collapsed.value && (
                    <span class="sidebar-account-info">
                      <strong>{authState.value.user!.name}</strong>
                      <small>{authState.value.user!.email}</small>
                    </span>
                  )}
                </button>
              )}
            >
              {/* Light/dark/system used to live here as a segmented control
               * above these actions - moved to the Settings page instead
               * (full-text labels, room to breathe - see `ThemeToggle.tsx`),
               * since it's a per-device preference someone would only ever
               * change occasionally, not something worth a permanent slot in
               * a menu opened constantly for Profile/Logout. */}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => route(`${path}/profile`)}
                >
                  <UserIcon /> Profile
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => route(`${path}/mcp`)}
                >
                  <McpIcon /> MCP
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  class="popover-menu-danger"
                  onClick={() => void logout()}
                >
                  <LogOutIcon /> Logout
                </button>
              </li>
            </Popover>
          )}
          {import.meta.env.DRYCMS_VERSION && (
            <small class="sidebar-version">
              {collapsed.value
                ? `v${import.meta.env.DRYCMS_VERSION}`
                : `version ${import.meta.env.DRYCMS_VERSION}`}
            </small>
          )}
        </div>
      </aside>

      <div class="main" ref={main}>
        <header class="topbar">
          <SidebarToggle />
          <div class="topbar-page-actions">{pageHeaderActions.value}</div>
          <SyncIndicator />
        </header>

        <main class="content">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
