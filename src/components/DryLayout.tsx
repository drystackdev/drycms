import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { ComponentChildren } from "preact";
import Icon from "./Icon.js";
import SidebarToggle from "./SidebarToggle.js";
import SyncIndicator from "./SyncIndicator.js";
import ThemeToggle from "./ThemeToggle.js";
import Toaster from "./Toast.js";
import type { IconName } from "./icons.js";
import { path } from "virtual:drycms/config";
import { collapsed } from "../store/dashboard.js";
import { contentTypesVersion } from "../store/content-types.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";
import { useStore } from "../hooks/useStore.js";
import { useFetch } from "../hooks/useFetch.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { authState, logout } from "../store/auth.js";

interface Props {
  children?: ComponentChildren;
}

const NAV: {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  ready: boolean;
}[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: `${path}/dashboard`,
    icon: "Dashboard",
    ready: true,
  },
  {
    key: "showcase",
    label: "Showcase",
    href: `${path}/showcase`,
    icon: "Showcase",
    ready: true,
  },
  {
    key: "richtext-demo",
    label: "Rich Text Demo",
    href: `${path}/richtext-demo`,
    icon: "Content",
    ready: true,
  },
  {
    key: "content-types",
    label: "Content Types",
    href: `${path}/content-types`,
    icon: "Content",
    ready: true,
  },
  {
    key: "content",
    label: "Content",
    href: `${path}/content`,
    icon: "Content",
    ready: true,
  },
  {
    key: "media",
    label: "Media",
    href: `${path}/media`,
    icon: "Media",
    ready: true,
  },
  {
    key: "icon-management",
    label: "Icon Management",
    href: `${path}/icon-management`,
    icon: "IconManagement",
    ready: true,
  },
  {
    key: "richtext-components",
    label: "Custom Components",
    href: `${path}/richtext-components`,
    icon: "Content",
    ready: true,
  },
  {
    key: "users",
    label: "Users",
    href: `${path}/content/user`,
    icon: "Users",
    ready: true,
  },
  {
    key: "roles",
    label: "Roles",
    href: `${path}/roles`,
    icon: "Settings",
    ready: true,
  },
  {
    key: "ai-keys",
    label: "AI Keys",
    href: `${path}/content/aiKey`,
    icon: "Settings",
    ready: true,
  },
  {
    key: "settings",
    label: "Settings",
    href: `${path}/settings`,
    icon: "Settings",
    ready: false,
  },
];

const CONTENT_PREFIX = `${path}/content/`;

/** Content-type slugs with their own dedicated top-level nav entry (e.g.
 * "Users" -> `/content/user`), derived from NAV so it can't drift out of
 * sync. `ContentEntryList` uses this to skip its back button for these -
 * they're primary destinations reached from the sidebar, not a drill-down
 * from the generic "Content" list, so there's nothing to go "back" to. */
export const pinnedContentTypeSlugs = new Set(
  NAV.filter((item) => item.href.startsWith(CONTENT_PREFIX)).map((item) => item.href.slice(CONTENT_PREFIX.length)),
);

/** Whether `href` is the active nav item for `url` - an exact match, or a
 * path segment beneath it (`${href}/...`). A plain `url.startsWith(href)`
 * would also match "/content-types" against href "/content" (since one
 * string just literally starts with the other's characters), lighting up
 * two nav items at once once the "Content" entry ships. */
function isActiveNavItem(url: string, href: string): boolean {
  return url === href || url.startsWith(`${href}/`);
}

/** The "Content" header link is active for any `/content/*` page EXCEPT one
 * that's also another NAV item's own dedicated href (e.g. "Users" pointing
 * at `/content/user`) - otherwise both would light up at once whenever that
 * shortcut's target happens to live under `/content`. */
function isContentHeaderActive(url: string, contentHref: string): boolean {
  if (!isActiveNavItem(url, contentHref)) return false;
  return !NAV.some(
    (other) => other.key !== "content" && other.ready && other.href !== contentHref && isActiveNavItem(url, other.href),
  );
}

export default function DryLayout({ children }: Props) {
  const { url } = useLocation();
  const { ref: sidebar } = useOverlayScrollbars<HTMLElement>([], { overflow: { x: 'hidden' } });
  const { ref: main, scrollToTop: scrollMainToTop } = useOverlayScrollbars<HTMLDivElement>();

  const toggleCollapsed = () => (collapsed.value = !collapsed.value);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    shell?.classList.toggle("collapsed", collapsed.value);
  }, [collapsed.value]);

  // The "Content" submenu's own collapse/expand state, independent of the
  // whole-sidebar `collapsed` signal above.
  const [contentMenuOpen, setContentMenuOpen] = useStore("contentSubmenuOpen", true);
  const contentTypesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) => contentTypesApi.listVersioned(ifVersion, signal),
    [contentTypesApi],
  );
  // Same cache key `ContentTypes.tsx` uses - a warm IndexedDB entry from
  // either page shows up instantly in the other. Unlike a route component,
  // this sidebar lives outside `<Router>` and never remounts (see
  // `App.tsx`), so `key` alone can't pick up a change made through
  // `ContentTypeEditor` - the `contentTypesVersion.value` effect below does
  // that instead, by calling this same hook's `reload()`.
  const { data: contentTypes, reload: reloadContentTypes } = useFetch<ContentTypeDefinition[]>(
    "content-types:list",
    listFetcher,
  );
  const skipFirstVersionEffect = useRef(true);
  useEffect(() => {
    if (skipFirstVersionEffect.current) {
      skipFirstVersionEffect.current = false;
      return;
    }
    void reloadContentTypes();
  }, [contentTypesVersion.value, reloadContentTypes]);
  // `hidden` types (role/permission/aiKey) are reached through their own
  // dedicated page instead - see `types.ts`'s doc comment.
  const contentNavItems = useMemo(
    () => (contentTypes ?? []).filter((t) => t.kind !== "component" && !t.hidden),
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

  return (
    <div class="shell">
      <aside class="sidebar" ref={sidebar}>
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

        <nav aria-label="Admin">
          {!collapsed.value && <span class="nav-label">Manage</span>}
          {NAV.map((item) =>
            item.key === "content" ? (
              <div key={item.key} class="nav-group">
                <div class="nav-group-header">
                  <a
                    href={item.href}
                    aria-current={isContentHeaderActive(url, item.href) ? "page" : undefined}
                    data-tooltip={collapsed.value ? item.label : undefined}
                    data-tooltip-placement="right"
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </a>
                  {!collapsed.value && contentNavItems.length > 0 && (
                    <button
                      type="button"
                      class="ghost icon sm"
                      aria-expanded={contentMenuOpen}
                      aria-label={contentMenuOpen ? "Collapse Content menu" : "Expand Content menu"}
                      onClick={() => setContentMenuOpen(!contentMenuOpen)}
                    >
                      <Icon name="ArrowDown" class={contentMenuOpen ? "nav-chevron" : "nav-chevron collapsed"} />
                    </button>
                  )}
                </div>
                {!collapsed.value && contentMenuOpen && (
                  <div class="nav-subitems">
                    {contentNavItems.map((type) => {
                      const href = `${path}/content/${type.name}`;
                      return (
                        <a key={type.id} href={href} class="nav-subitem" aria-current={isActiveNavItem(url, href) ? "page" : undefined}>
                          <span>{type.label}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : item.ready ? (
              <a
                key={item.key}
                href={item.href}
                aria-current={isActiveNavItem(url, item.href) ? "page" : undefined}
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
        </nav>

        <span class="spacer"></span>
        <small>
          Mounted at <code>{path}</code>
        </small>
      </aside>

      <div class="main" ref={main}>
        <header class="topbar">
          <SidebarToggle />
          <span class="spacer"></span>
          <SyncIndicator />
          <ThemeToggle />
          {authState.value.user && (
            <>
              <span class="hint">{authState.value.user.name}</span>
              <button type="button" class="ghost sm" onClick={() => void logout()}>
                Sign out
              </button>
            </>
          )}
        </header>

        <main class="content">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
