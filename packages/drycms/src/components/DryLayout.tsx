import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { ComponentChildren } from "preact";
import Icon from "./Icon.js";
import SidebarToggle from "./SidebarToggle.js";
import ThemeToggle from "./ThemeToggle.js";
import Toaster from "./Toast.js";
import type { IconName } from "./icons.js";
import { path } from "virtual:drycms/config";
import { collapsed } from "../store/dashboard.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";
import { useStore } from "../hooks/useStore.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";

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
    key: "users",
    label: "Users",
    href: `${path}/content/user`,
    icon: "Users",
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

/** Whether `href` is the active nav item for `url` - an exact match, or a
 * path segment beneath it (`${href}/...`). A plain `url.startsWith(href)`
 * would also match "/content-types" against href "/content" (since one
 * string just literally starts with the other's characters), lighting up
 * two nav items at once once the "Content" entry ships. */
function isActiveNavItem(url: string, href: string): boolean {
  return url === href || url.startsWith(`${href}/`);
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
  const [contentTypes, setContentTypes] = useState<ContentTypeDefinition[]>([]);
  const contentTypesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  useEffect(() => {
    contentTypesApi.list().then(setContentTypes).catch(() => setContentTypes([]));
  }, [contentTypesApi]);
  // System types (user/menu/aiKey/role/permission) get their own UI later
  // and are deliberately left out of this generic list - see `status/content.md`.
  const contentNavItems = useMemo(
    () => contentTypes.filter((t) => t.kind !== "component" && !t.system),
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
                    aria-current={isActiveNavItem(url, item.href) ? "page" : undefined}
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
          <ThemeToggle />
        </header>

        <main class="content">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
