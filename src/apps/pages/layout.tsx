/**
 * Root layout for the public site - wraps every page under
 * `src/apps/pages/**`, including `404.tsx` (see `docs/APP-ROUTER.md`).
 *
 * Plain SYNC component with no data dependency, which is what makes a
 * brand-new project renderable: the demo site's layout read a
 * `siteSettings` singleton and a `menu` collection through `dry()`, and
 * neither exists until you model them. Once they do, make this `async` and
 * read them here - a layout renders on every page, so keep the read narrow
 * with `select` (see `dry-reader.ts`'s `DrySelect`).
 */
const SITE_NAME = "sivelap";

export default function RootLayout({ children }: { children?: unknown }) {
  return (
    <div class="flex min-h-screen flex-col bg-white font-sans text-slate-900">
      <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <a href="/" class="text-lg font-bold">
            {SITE_NAME}
          </a>
          <a
            href="/dry"
            class="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Quản trị
          </a>
        </div>
      </header>

      <main class="flex-1">{children as never}</main>

      <footer class="border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} {SITE_NAME}
      </footer>
    </div>
  );
}
