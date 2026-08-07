function formatDate(date: Date): string {
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function HomePage() {
  const home = await dry().singleton("homepage").get();
  const { rows: latestPosts } = await dry().collection("blog").list({
    sort: { field: "date", dir: "desc" },
    pageSize: 3,
  });
  const { rows: categories } = await dry().collection("category").list();
  const categoryNameById = new Map(categories.map((c) => [c.id, c.title]));

  if (!home) return null;
  const { hero, valueProps, videoSection, latestPostsSection, pressSection, pressMentions, bottomCta } = home;

  return (
    <div>
      <section class="relative overflow-hidden bg-red-50">
        <div class="mx-auto flex max-w-6xl flex-col px-4 sm:flex-row sm:items-end">
          <div class="flex flex-col justify-center gap-1 py-10 sm:w-1/2 sm:py-24">
            <span class="w-fit rounded-full bg-red-100 px-4 py-1 text-sm font-medium text-red-900">
              {hero.eyebrow}
            </span>
            <h1 class="mt-4 text-5xl font-bold text-slate-900 uppercase">
              {hero.headline}
            </h1>
            <p class="mt-2 text-lg font-semibold text-red-900">
              {hero.subtitle}
            </p>
            <p class="mt-4 max-w-lg text-sm leading-relaxed text-slate-600 sm:text-base">
              {hero.content}
            </p>
            <div class="mt-6 flex flex-wrap gap-3">
              <a
                href="/blogs"
                class="rounded-full bg-red-800 px-6 py-3 text-sm font-semibold text-white hover:bg-red-900"
              >
                Xem bài viết
              </a>
              <a
                href="/contact"
                class="rounded-full border border-red-800 px-6 py-3 text-sm font-semibold text-red-900 hover:bg-red-50"
              >
                Liên hệ tư vấn
              </a>
            </div>
          </div>
          <div class="-mx-4 mt-8 aspect-4/3 sm:mx-0 sm:mt-0 sm:w-1/2">
            <img
              src={hero.image}
              alt="Mai Anh Quyền tại lễ trao giải Báo chí toàn quốc về phòng, chống HIV/AIDS"
              class="h-full w-full object-cover"
              style={{
                maskImage:
                  "linear-gradient(to right, transparent, black 35%), linear-gradient(to left, transparent, black 15%), linear-gradient(to bottom, transparent, black 25%)",
                maskComposite: "intersect",
              }}
            />
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="grid gap-6 sm:grid-cols-3">
          {valueProps.map((item) => (
            <div
              key={item.headline}
              class="rounded-2xl border border-slate-200 p-6"
            >
              <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-900">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  class="h-5 w-5"
                >
                  <path
                    d="m8.5 12.5l2 2l5-5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
              <h3 class="text-base font-semibold text-slate-900">
                {item.headline}
              </h3>
              <p class="mt-2 text-sm leading-relaxed text-slate-600">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section class="relative isolate overflow-hidden">
        <video
          class="absolute inset-0 h-full w-full object-cover"
          src={videoSection.videoUrl}
          autoPlay
          loop
          muted
          playsInline
        />
        <div class="absolute inset-0 bg-slate-900/60" />
        <div class="relative mx-auto flex min-h-140 max-w-6xl flex-col items-center justify-center gap-4 px-4 py-24 text-center text-white">
          <h2 class="text-2xl font-bold sm:text-3xl">
            {videoSection.heading}
          </h2>
          <p class="max-w-xl text-sm leading-relaxed text-slate-100 sm:text-base">
            {videoSection.description}
          </p>
          <a
            href={videoSection.ctaHref ?? "/blogs"}
            class="mt-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-red-900 hover:bg-red-50"
          >
            {videoSection.ctaLabel}
          </a>
        </div>
      </section>

      <section class="bg-slate-50">
        <div class="mx-auto max-w-6xl px-4 py-16">
          <div class="mb-8 flex items-end justify-between">
            <h2 class="text-2xl font-bold text-slate-900">{latestPostsSection.heading}</h2>
            <a
              href={latestPostsSection.viewAllHref ?? "/blogs"}
              class="text-sm font-medium text-red-900 hover:underline"
            >
              Xem tất cả →
            </a>
          </div>
          <div class="grid gap-6 sm:grid-cols-3">
            {latestPosts.map((post) => (
              <a
                key={post.slug}
                href={`/blogs/${post.slug}`}
                class="overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                {post.image ? (
                  <img src={post.image} alt={post.title} class="h-36 w-full object-cover" />
                ) : (
                  <div class="h-36 bg-slate-200" />
                )}
                <div class="space-y-2 p-5">
                  <span class="text-xs font-semibold uppercase tracking-wide text-red-900">
                    {post.category !== null ? categoryNameById.get(post.category!) : null}
                  </span>
                  <h3 class="text-base font-semibold text-slate-900">
                    {post.title}
                  </h3>
                  <p class="text-xs text-slate-500">{formatDate(post.date)}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="mb-8 flex items-end justify-between">
          <h2 class="text-2xl font-bold text-slate-900">{pressSection.heading}</h2>
          <a
            href={pressSection.viewAllHref ?? "/about"}
            class="text-sm font-medium text-red-900 hover:underline"
          >
            Xem tất cả →
          </a>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          {pressMentions.map((item) => (
            <a
              key={item.headline}
              href={item.href ?? "#"}
              target="_blank"
              rel="noreferrer"
              class="group flex items-start gap-4 rounded-2xl border border-slate-200 p-5 hover:border-red-300 hover:bg-red-50"
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt={item.outlet}
                  class="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div class="h-12 w-12 shrink-0 rounded-lg bg-slate-200" />
              )}
              <div class="flex-1">
                <p class="text-xs font-semibold uppercase tracking-wide text-red-900">
                  {item.outlet}
                </p>
                <p class="mt-1 text-sm font-semibold text-slate-900 group-hover:text-red-900">
                  {item.headline}
                </p>
                <p class="mt-1 text-xs text-slate-500">{item.date}</p>
              </div>
              <svg
                viewBox="0 0 24 24"
                class="mt-1 h-4 w-4 shrink-0 text-slate-400 group-hover:text-red-800"
              >
                <g fill="none" stroke="currentColor" stroke-width="1.5">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m9 15l6-6m0 0h-4.5M15 9v4.5"
                  />
                  <path d="M2 12c0-4.714 0-7.071 1.464-8.536C4.93 2 7.286 2 12 2s7.071 0 8.535 1.464C22 4.93 22 7.286 22 12s0 7.071-1.465 8.535C19.072 22 16.714 22 12 22s-7.071 0-8.536-1.465C2 19.072 2 16.714 2 12Z" />
                </g>
              </svg>
            </a>
          ))}
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="flex flex-col items-center gap-4 rounded-2xl bg-red-800 px-8 py-12 text-center text-white">
          <h2 class="text-2xl font-bold">{bottomCta.heading}</h2>
          <p class="max-w-xl text-sm leading-relaxed text-red-50">
            {bottomCta.description}
          </p>
          <a
            href={bottomCta.ctaHref ?? "/contact"}
            class="rounded-full bg-white px-6 py-3 text-sm font-semibold text-red-900 hover:bg-red-50"
          >
            {bottomCta.ctaLabel}
          </a>
        </div>
      </section>
    </div>
  );
}
