import { useMemo, useState } from "preact/hooks";
import type { Blog, Category } from "../../dry.generated.js";

function formatDate(date: Date): string {
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Exactly the fields `BlogsPage`'s `list({ select })` asks for - written as
 * `Pick`s of the generated interfaces so a schema change still flows through
 * to this component instead of drifting behind a hand-written shape. */
type PostCard = Pick<Blog, "id" | "slug" | "title" | "excerpt" | "image" | "date" | "category">;
type CategoryChip = Pick<Category, "id" | "title">;

/** Plain sync component - hooks work here (see APP-ROUTER.md's async/sync rule). */
function BlogsFilterSection({ posts, categories }: { posts: PostCard[]; categories: CategoryChip[] }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);
  const normalizedSearch = search.trim().toLocaleLowerCase("vi-VN");

  return (
    <>
      <div class="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="relative w-full sm:max-w-xs">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11.5" cy="11.5" r="9.5" />
            <path d="M18.5 18.5L22 22" stroke-linecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Tìm kiếm bài viết..."
            class="w-full rounded-full border border-slate-300 py-2 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-red-600 focus:outline-none"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            class={`rounded-full px-4 py-1.5 text-xs font-medium ${activeCategory === null ? "bg-red-800 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Tất cả
          </button>
          {categories.map((category) => (
            <button
              type="button"
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              class={`rounded-full px-4 py-1.5 text-xs font-medium ${activeCategory === category.id ? "bg-red-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {category.title}
            </button>
          ))}
        </div>
      </div>

      <div class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => {
          const matchesCategory = activeCategory === null || post.category === activeCategory;
          const matchesSearch =
            normalizedSearch === "" || post.title.toLocaleLowerCase("vi-VN").includes(normalizedSearch);
          const visible = matchesCategory && matchesSearch;
          return (
            <a
              href={`/blogs/${post.slug}`}
              key={post.slug}
              style={visible ? undefined : { display: "none" }}
              class="overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              {post.image ? (
                <img src={post.image} alt={post.title} class="h-40 w-full object-cover" />
              ) : (
                <div class="h-40 bg-slate-200" />
              )}
              <div class="space-y-2 p-5">
                <span class="text-xs font-semibold uppercase tracking-wide text-red-900">
                  {post.category != null ? categoryNameById.get(post.category) : null}
                </span>
                <h3 class="text-base font-semibold text-slate-900">
                  {post.title}
                </h3>
                <p class="text-sm leading-relaxed text-slate-600">
                  {post.excerpt}
                </p>
                <p class="text-xs text-slate-500">{formatDate(post.date)}</p>
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}

export default async function BlogsPage() {
  const blogsPage = await dry().singleton("blogsPage").get();
  // `select` narrows each row to the fields the cards below render -
  // everything else stays out of the SQL read and out of the replay log this
  // page embeds for hydration (see `dry-reader.ts`'s `DrySelect`).
  const { rows: posts } = await dry().collection("blog").list({
    select: { slug: true, title: true, excerpt: true, image: true, date: true, category: true },
    sort: { field: "date", dir: "desc" },
  });
  const { rows: categories } = await dry().collection("category").list({ select: { title: true } });

  if (!blogsPage) return null;
  const { header } = blogsPage;

  return (
    <div class="mx-auto max-w-6xl px-4 py-16">
      <div class="max-w-2xl">
        <span class="rounded-full bg-red-100 px-4 py-1 text-sm font-medium text-red-900">
          {header.eyebrow}
        </span>
        <h1 class="mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">
          {header.headline}
        </h1>
        <p class="mt-3 text-sm leading-relaxed text-slate-600">
          {header.description}
        </p>
      </div>

      <BlogsFilterSection posts={posts} categories={categories} />
    </div>
  );
}
