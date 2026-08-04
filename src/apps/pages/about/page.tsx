const MISSION_ITEMS = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse.",
];

const EXPERIENCE_ITEMS = [
  { year: "2026", text: "Lorem ipsum dolor sit amet consectetur adipiscing elit." },
  { year: "2024", text: "Sed do eiusmod tempor incididunt ut labore et dolore magna." },
  { year: "2021", text: "Ut enim ad minim veniam quis nostrud exercitation ullamco." },
];

const PRESS_MENTIONS = [
  { outlet: "[Tên báo/tạp chí]", title: "Lorem ipsum dolor sit amet consectetur adipiscing elit", date: "12/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", title: "Sed do eiusmod tempor incididunt ut labore et dolore", date: "10/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", title: "Ut enim ad minim veniam quis nostrud exercitation", date: "06/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", title: "Duis aute irure dolor in reprehenderit in voluptate", date: "03/2025", href: "#" },
];

export default async function AboutPage() {
  return (
    <div>
      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="grid items-center gap-10 sm:grid-cols-2">
          <img
            src="/IMG_8153.JPG"
            alt="Mai Anh Quyền"
            class="aspect-square w-full rounded-2xl object-cover object-bottom"
          />
          <div class="space-y-4">
            <span class="rounded-full bg-teal-100 px-4 py-1 text-sm font-medium text-teal-700">Giới thiệu</span>
            <h1 class="text-3xl mt-2 font-bold text-slate-900 sm:text-4xl">Mai Anh Quyền</h1>
            <p class="text-sm leading-relaxed text-slate-600">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et
              dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.
            </p>
          </div>
        </div>
      </section>

      <section class="bg-slate-50">
        <div class="mx-auto max-w-6xl px-4 py-16">
          <h2 class="text-2xl font-bold text-slate-900">Câu chuyện của tôi</h2>
          <div class="mt-4 space-y-4 text-sm leading-relaxed text-slate-600">
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent nec lacus vel elit dictum interdum. Nulla
              facilisi. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.
            </p>
            <p>
              Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
              Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est
              laborum.
            </p>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <h2 class="text-2xl font-bold text-slate-900">Sứ mệnh</h2>
        <ul class="mt-6 space-y-3">
          {MISSION_ITEMS.map((item) => (
            <li key={item} class="flex items-start gap-3 text-sm leading-relaxed text-slate-600">
              <span class="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3">
                  <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section class="bg-slate-50">
        <div class="mx-auto max-w-6xl px-4 py-16">
          <h2 class="text-2xl font-bold text-slate-900">Kinh nghiệm & Chứng chỉ</h2>
          <ol class="mt-6 space-y-6 border-l border-slate-200 pl-6">
            {EXPERIENCE_ITEMS.map((item) => (
              <li key={item.year} class="relative">
                <span class="absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-teal-600" />
                <p class="text-sm font-semibold text-teal-700">{item.year}</p>
                <p class="mt-1 text-sm leading-relaxed text-slate-600">{item.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <h2 class="text-2xl font-bold text-slate-900">Bài báo nói về tôi</h2>
        <p class="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.
        </p>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
          {PRESS_MENTIONS.map((item) => (
            <a
              key={item.title}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              class="group flex items-start gap-4 rounded-2xl border border-slate-200 p-5 hover:border-teal-300 hover:bg-teal-50"
            >
              <div class="h-12 w-12 shrink-0 rounded-lg bg-slate-200" />
              <div class="flex-1">
                <p class="text-xs font-semibold uppercase tracking-wide text-teal-700">{item.outlet}</p>
                <p class="mt-1 text-sm font-semibold text-slate-900 group-hover:text-teal-700">{item.title}</p>
                <p class="mt-1 text-xs text-slate-500">{item.date}</p>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                class="mt-1 h-4 w-4 shrink-0 text-slate-400 group-hover:text-teal-600"
              >
                <path d="M7 17L17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </a>
          ))}
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="flex flex-col items-center gap-4 rounded-2xl bg-teal-600 px-8 py-12 text-center text-white">
          <h2 class="text-2xl font-bold">Cùng trò chuyện với tôi</h2>
          <p class="max-w-xl text-sm leading-relaxed text-teal-50">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.
          </p>
          <a href="/contact" class="rounded-full bg-white px-6 py-3 text-sm font-semibold text-teal-700 hover:bg-teal-50">
            Liên hệ ngay
          </a>
        </div>
      </section>
    </div>
  );
}
