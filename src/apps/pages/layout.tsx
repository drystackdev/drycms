import { useState } from "preact/hooks";

const NAV_LINKS = [
  { href: "/", label: "Trang chủ" },
  { href: "/about", label: "Giới thiệu" },
  { href: "/blogs", label: "Blog" },
  { href: "/contact", label: "Liên hệ" },
];

/** Plain sync component - hooks work here (see APP-ROUTER.md's async/sync rule). */
function MobileNavToggle() {
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-6 w-6">
          {open ? <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />}
        </svg>
      </button>
      {open ? (
        <div class="absolute inset-x-0 top-16 z-20 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
          <nav class="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} class="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-700">
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
  return (
    <div class="flex min-h-screen flex-col bg-white font-sans text-slate-900">
      <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <a href="/" class="flex items-center gap-2 text-lg font-bold text-teal-700">
            <span class="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-white">+</span>
            [Tên thương hiệu]
          </a>
          <nav class="hidden gap-6 sm:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} class="text-sm font-medium text-slate-600 hover:text-teal-700">
                {link.label}
              </a>
            ))}
          </nav>
          <a
            href="/contact"
            class="hidden rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 sm:block"
          >
            Tư vấn ngay
          </a>
          <MobileNavToggle />
        </div>
      </header>

      <main class="flex-1">{children as never}</main>

      <footer class="border-t border-slate-200 bg-slate-50">
        <div class="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          <div>
            <p class="text-lg font-bold text-teal-700">[Tên thương hiệu]</p>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Đồng hành và chia sẻ kiến thức về HIV, điều trị ARV một
              cách riêng tư và tận tâm.
            </p>
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-900">Liên kết</p>
            <ul class="mt-2 space-y-2 text-sm text-slate-600">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} class="hover:text-teal-700">
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
                <a href="tel:0000000000" class="hover:text-teal-700">
                  0000 000 000
                </a>
              </li>
              <li>
                <a href="mailto:contact@example.com" class="hover:text-teal-700">
                  contact@example.com
                </a>
              </li>
              <li>
                <a href="#" class="hover:text-teal-700">
                  Fanpage Facebook
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div class="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-500">
          © 2026 [Tên thương hiệu]. Nội dung chỉ mang tính chất tham khảo, không thay thế tư vấn y tế chuyên môn.
        </div>
      </footer>
    </div>
  );
}
