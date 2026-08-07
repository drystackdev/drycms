import { useState } from "preact/hooks";

interface NavLink {
  href: string;
  label: string;
}

/** Plain sync component - hooks work here (see APP-ROUTER.md's async/sync rule). */
function MobileNavToggle({ navLinks }: { navLinks: NavLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div class="sm:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        class="flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
      >
        <span class="sr-only">Mở menu</span>
        <svg viewBox="0 0 24 24" class="h-6 w-6">
          {open ? (
            <g fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path stroke-linecap="round" d="m14.5 9.5l-5 5m0-5l5 5" />
            </g>
          ) : (
            <path
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.5"
              d="M20 7H4m16 5H4m16 5H4"
            />
          )}
        </svg>
      </button>
      {open ? (
        <div class="absolute inset-x-0 top-16 z-20 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
          <nav class="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                class="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-900"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

export default async function RootLayout({ children }: { children?: unknown }) {
  const site = await dry().singleton("siteSettings").get();
  // This layout renders on EVERY page, so its replay-log cost is paid site-
  // wide - `select` keeps `name`/`createdAt`/`updatedAt` out of it. `refs`
  // stays `true` rather than a `(refs) => refs.map(...)` transform on
  // purpose: a transformed value is no longer VEI-editable, and the nav
  // labels below should stay editable in place. `where` still filters on
  // `name` even though it isn't selected.
  const { rows: menus } = await dry()
    .collection("menu")
    .list({ select: { refs: true }, where: [{ field: "name", op: "eq", value: "Main Navigation" }] });
  const navLinks: NavLink[] = menus[0]?.refs.map((ref) => ({ href: ref.href, label: ref.label })) ?? [];
  if (!site) return null;

  return (
    <div class="flex min-h-screen flex-col bg-white font-sans text-slate-900">
      <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <a
            href="/"
            class="flex items-center gap-2 text-lg font-bold text-red-900"
          >
            <span class="flex h-9 w-9 items-center justify-center rounded-full bg-red-800 text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                <path
                  fill-rule="evenodd"
                  d="M8.962 19.37C6.019 16.972 2 13.009 2 9.26C2 3.35 7.5.663 12 5.5C16.5.663 22 3.349 22 9.26c0 3.748-4.02 7.711-6.962 10.11C13.706 20.458 13.04 21 12 21s-1.706-.543-3.038-1.63m1.131-8.624q.133-.19.23-.325c.056.098.119.211.194.348l1.71 3.11c.166.302.33.598.493.813c.175.23.482.545.975.555c.493.009.813-.295.996-.518c.172-.209.345-.498.523-.794l.055-.093c.221-.367.36-.598.483-.764c.113-.153.179-.203.228-.23c.049-.028.125-.059.315-.077c.206-.02.474-.02.904-.02H18a.75.75 0 0 0 0-1.5h-.834c-.387 0-.73 0-1.016.027a2.2 2.2 0 0 0-.91.264a2.2 2.2 0 0 0-.694.644c-.171.231-.347.525-.546.857l-.048.08c-.087.144-.159.264-.224.368l-.21-.377l-1.709-3.108c-.154-.28-.307-.56-.463-.765c-.17-.223-.462-.52-.93-.544c-.467-.026-.789.237-.982.441c-.177.187-.36.448-.543.71l-.31.442c-.227.325-.37.527-.493.673c-.113.134-.176.178-.223.202c-.046.025-.118.051-.293.067c-.19.017-.438.018-.834.018H6a.75.75 0 0 0 0 1.5h.768c.357 0 .674 0 .94-.024c.29-.027.571-.085.85-.23c.28-.146.489-.343.676-.565c.173-.204.354-.463.559-.756z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
            {site.brandName}
          </a>
          <nav class="hidden gap-6 sm:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                class="text-sm font-medium text-slate-600 hover:text-red-900"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <a
            href={site.headerCtaHref ?? "/contact"}
            class="hidden rounded-full bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 sm:block"
          >
            {site.headerCtaLabel}
          </a>
          <MobileNavToggle navLinks={navLinks} />
        </div>
      </header>

      <main class="flex-1">{children as never}</main>

      <footer class="border-t border-slate-200 bg-slate-50">
        <div class="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          <div>
            <p class="text-lg font-bold text-red-900">{site.brandName}</p>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">{site.footerDescription}</p>
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900">Liên kết</p>
            <ul class="mt-2 space-y-2 text-sm text-slate-600">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} class="hover:text-red-900">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900">Liên hệ</p>
            <ul class="mt-2 space-y-2 text-sm text-slate-600">
              <li>
                <a href={`tel:${(site.phone ?? "").replace(/\D/g, "")}`} class="hover:text-red-900">
                  {site.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${site.email}`} class="hover:text-red-900">
                  {site.email}
                </a>
              </li>
              <li>
                <a href={site.fanpageUrl} class="hover:text-red-900">
                  Fanpage Facebook
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div class="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-500">{site.copyrightText}</div>
      </footer>
    </div>
  );
}
