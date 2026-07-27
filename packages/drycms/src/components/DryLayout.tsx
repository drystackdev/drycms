import { useEffect, useState } from "preact/hooks";
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

const SIDEBAR_COLLAPSED_KEY = "drycms:sidebar-collapsed";

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
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
    icon: "Media",
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
    ready: false,
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
    href: `${path}/users`,
    icon: "Users",
    ready: false,
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

  useEffect(() => {
    const stored = readStoredCollapsed();
    collapsed.value = stored;
    document
      .querySelector<HTMLElement>(".shell")
      ?.classList.toggle("collapsed", stored);
  }, []);

  const toggleCollapsed = () => (collapsed.value = !collapsed.value);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed.value));
    } catch {
      // Ignore localStorage errors (e.g. private mode)
    }
  }, [collapsed.value]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    shell?.classList.toggle("collapsed", collapsed.value);
  }, [collapsed.value]);

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
            <span>drycms</span>
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
            item.ready ? (
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
