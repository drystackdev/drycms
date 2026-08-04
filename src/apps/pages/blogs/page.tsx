const CATEGORIES = ["Tất cả", "Kiến thức cơ bản", "Điều trị ARV", "Sức khỏe tình dục", "Hỏi đáp"];

const POSTS = [
  { tag: "Kiến thức cơ bản", title: "Lorem ipsum dolor sit amet consectetur", excerpt: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim.", date: "01/08/2026" },
  { tag: "Điều trị ARV", title: "Ut enim ad minim veniam quis nostrud", excerpt: "Exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis.", date: "29/07/2026" },
  { tag: "Hỏi đáp", title: "Duis aute irure dolor in reprehenderit", excerpt: "In voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur.", date: "27/07/2026" },
  { tag: "Sức khỏe tình dục", title: "Excepteur sint occaecat cupidatat non", excerpt: "Proident sunt in culpa qui officia deserunt mollit anim id est laborum.", date: "24/07/2026" },
  { tag: "Kiến thức cơ bản", title: "Praesent nec lacus vel elit dictum", excerpt: "Interdum nulla facilisi vestibulum ante ipsum primis in faucibus orci luctus.", date: "20/07/2026" },
  { tag: "Điều trị ARV", title: "Vestibulum ante ipsum primis in faucibus", excerpt: "Orci luctus et ultrices posuere cubilia curae mauris blandit aliquet.", date: "18/07/2026" },
];

export default async function BlogsPage() {
  return (
    <div class="mx-auto max-w-6xl px-4 py-16">
      <div class="max-w-2xl">
        <span class="rounded-full bg-teal-100 px-4 py-1 text-sm font-medium text-teal-700">Blog</span>
        <h1 class="mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">Kiến thức HIV & ARV</h1>
        <p class="mt-3 text-sm leading-relaxed text-slate-600">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore
          magna aliqua.
        </p>
      </div>

      <div class="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="relative w-full sm:max-w-xs">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" stroke-linecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Tìm kiếm bài viết..."
            class="w-full rounded-full border border-slate-300 py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          {CATEGORIES.map((category, index) => (
            <span
              key={category}
              class={`rounded-full px-4 py-1.5 text-xs font-medium ${
                index === 0 ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {category}
            </span>
          ))}
        </div>
      </div>

      <div class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {POSTS.map((post) => (
          <article key={post.title} class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div class="h-40 bg-slate-200" />
            <div class="space-y-2 p-5">
              <span class="text-xs font-semibold uppercase tracking-wide text-teal-700">{post.tag}</span>
              <h3 class="text-base font-semibold text-slate-900">{post.title}</h3>
              <p class="text-sm leading-relaxed text-slate-600">{post.excerpt}</p>
              <div class="flex items-center justify-between pt-2">
                <p class="text-xs text-slate-500">{post.date}</p>
                <span class="text-sm font-medium text-teal-700">Đọc thêm →</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div class="mt-12 flex items-center justify-center gap-2">
        <span class="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-400">‹</span>
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">
          1
        </span>
        <span class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100">
          2
        </span>
        <span class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100">
          3
        </span>
        <span class="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-400">›</span>
      </div>
    </div>
  );
}
