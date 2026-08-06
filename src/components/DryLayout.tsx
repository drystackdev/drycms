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
import { LogOutIcon, UserIcon } from "./icons/index.js";
import Popover from "./Popover.js";
import SidebarToggle from "./SidebarToggle.js";
import SyncIndicator from "./SyncIndicator.js";
import ThemeToggle from "./ThemeToggle.js";
import Toaster from "./Toast.js";
import type { IconName } from "./icons/index.js";
const { path } = window.__DRY_CONFIG__;
import { collapsed } from "../store/dashboard.js";
import { contentTypesVersion } from "../store/content-types.js";
import { pageHeaderActions } from "../store/page-header.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";
import { useStore } from "../hooks/useStore.js";
import { useFetch } from "../hooks/useFetch.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { authState, canAccess, logout } from "../store/auth.js";
import { PAGE_COMPONENTS_RESOURCE_ID } from "../content-types/permissions.js";
import { temporaryFeatureVisibility } from "../lib/temporary-visibility.js";
import { countEntryDrafts, hasEntryDraft, hydrateEntryDraftIndex, watchEntryDraftIndex } from "../content-types/entry-draft-store.js";

interface Props {
  children?: ComponentChildren;
}

const NAV: {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  ready: boolean;
  section: "Overview" | "Content" | "System" | "Development";
  superAdminOnly?: boolean;
  permissionName?: string;
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
  ...(import.meta.env.DEV
    ? [
        {
          key: "showcase",
          label: "Showcase",
          href: `${path}/showcase`,
          icon: "Showcase" as IconName,
          ready: true,
          section: "Development" as const,
        },
      ]
    : []),
  {
    key: "richtext-demo",
    label: "Rich Text Demo",
    href: `${path}/richtext-demo`,
    icon: "Content",
    ready: true,
    section: "Development",
  },
  {
    key: "code-editer-demo",
    label: "Code Editer Demo",
    href: `${path}/code-editer-demo`,
    icon: "CodeFieldType",
    ready: true,
    section: "Development",
  },
  {
    key: "content-types",
    label: "Content Types",
    href: `${path}/content-types`,
    icon: "Content",
    ready: true,
    section: "Content",
    superAdminOnly: true,
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
    superAdminOnly: true,
  },
  {
    key: "richtext-components",
    label: "Custom Components",
    href: `${path}/richtext-components`,
    icon: "Content",
    ready: true,
    section: "Content",
    superAdminOnly: true,
  },
  {
    key: "page-components",
    label: "Page Components",
    href: `${path}/page-components`,
    icon: "Content",
    ready: true,
    section: "Content",
    permissionResourceId: PAGE_COMPONENTS_RESOURCE_ID,
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
    key: "key-value",
    label: "Key Value",
    href: `${path}/key-value`,
    icon: "KeyValue",
    ready: true,
    section: "System",
    superAdminOnly: true,
  },
  {
    key: "ai-keys",
    label: "AI Keys",
    href: `${path}/content/aiKey`,
    icon: "AiKey",
    ready: true,
    section: "System",
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
    key: "settings",
    label: "Settings",
    href: `${path}/settings`,
    icon: "Settings",
    ready: false,
    section: "System",
  },
];

const NAV_SECTIONS = ["Overview", "Content", "System", "Development"] as const;

const HIDDEN_NAV_KEYS = new Set(
  [
    !temporaryFeatureVisibility.codeEditerDemo && "code-editer-demo",
    !temporaryFeatureVisibility.richtextComponents && "richtext-components",
    !temporaryFeatureVisibility.pageComponents && "page-components",
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

interface ContentNavGroupProps {
  id: string;
  label: string;
  icon: IconName;
  items: ContentTypeDefinition[];
  open: boolean;
  url: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Unsaved-draft indicator (a dot for a singleton, a count badge for a
   * collection) next to each item's label - see `entry-draft-store.ts` and
   * `status/entry-drafts.md`. `null` renders nothing for that item. */
  renderBadge?: (type: ContentTypeDefinition) => ComponentChildren;
}

function ContentNavGroup({
  id,
  label,
  icon,
  items,
  open,
  url,
  collapsed,
  onToggle,
  renderBadge,
}: ContentNavGroupProps) {
  const popupItems = (
    <>
      {items.map((type) => {
        const href = `${path}/content/${type.name}`;
        return (
          <li key={type.id} class="sidebar-nav-popup-item">
            <a role="menuitem" href={href} aria-current={isActiveNavItem(url, href) ? "page" : undefined}>
              {type.label}
              {renderBadge?.(type)}
            </a>
          </li>
        );
      })}
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
            {items.map((type) => {
              const href = `${path}/content/${type.name}`;
              return (
                <a key={type.id} href={href} class="nav-subitem" aria-current={isActiveNavItem(url, href) ? "page" : undefined}>
                  <span>{type.label}</span>
                  {renderBadge?.(type)}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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
    () => (contentTypes ?? []).filter((t) => t.kind === "collection" && !t.hidden && canAccess(t.id, "view")),
    [contentTypes],
  );
  const singletonNavItems = useMemo(
    () => (contentTypes ?? []).filter((t) => t.kind === "singleton" && !t.hidden && canAccess(t.id, "setting")),
    [contentTypes],
  );

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
          <a class="brand" href={`${path}/dashboard`}>
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
                  (!item.superAdminOnly || authState.value.user?.isSuperAdmin) &&
                  (!item.permissionName || (() => {
                    const type = contentTypes?.find((candidate) => candidate.name === item.permissionName);
                    return !!type && canAccess(type.id, "view");
                  })()) &&
                  (!item.permissionResourceId || canAccess(item.permissionResourceId, "setting")),
              );
              if (sectionItems.length === 0) return null;
              return (
                <div key={section} class="nav-section">
                  {!collapsed.value && <span class="nav-section-label">{section}</span>}
                  {section === "Content" && (
                    <>
                      {collectionNavItems.length > 0 && (
                        <ContentNavGroup
                          id="collection-nav-subitems"
                          label="Collection"
                          icon="Collection"
                          items={collectionNavItems}
                          open={collectionMenuOpen}
                          url={url}
                          collapsed={collapsed.value}
                          onToggle={() => setCollectionMenuOpen(!collectionMenuOpen)}
                          renderBadge={(type) => {
                            const count = countEntryDrafts(type.name);
                            return count > 0 ? <span class="badge sm secondary">{count}</span> : null;
                          }}
                        />
                      )}
                      {singletonNavItems.length > 0 && (
                        <ContentNavGroup
                          id="singleton-nav-subitems"
                          label="Singleton"
                          icon="Singleton"
                          items={singletonNavItems}
                          open={singletonMenuOpen}
                          url={url}
                          collapsed={collapsed.value}
                          onToggle={() => setSingletonMenuOpen(!singletonMenuOpen)}
                          renderBadge={(type) =>
                            hasEntryDraft(type.name, null) ? <span class="nav-draft-dot" aria-label="Unsaved changes" /> : null
                          }
                        />
                      )}
                    </>
                  )}
                  {sectionItems.map((item) => item.ready ? (
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
              ))}
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
                    <UserIcon />
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
              {/* Custom `children` (not `items`) so the theme segmented
               * control can sit above the Profile/Logout actions without
               * auto-closing the popover on every click - `items` alone
               * can't mix in non-action content like this. */}
              <li class="popover-menu-theme" role="none">
                <ThemeToggle />
              </li>
              <li class="popover-menu-separator" role="separator" />
              <li role="none">
                <button type="button" role="menuitem" onClick={() => route(`${path}/profile`)}>
                  <UserIcon /> Profile
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" class="popover-menu-danger" onClick={() => void logout()}>
                  <LogOutIcon /> Logout
                </button>
              </li>
            </Popover>
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
