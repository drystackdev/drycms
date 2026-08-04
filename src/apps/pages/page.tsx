const VALUE_PROPS = [
  {
    title: "Kiến thức đáng tin cậy",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent nec lacus vel elit dictum interdum.",
  },
  {
    title: "Đồng hành riêng tư",
    text: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  {
    title: "Cộng đồng hỗ trợ",
    text: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  },
];

const LATEST_POSTS = [
  { tag: "Kiến thức cơ bản", title: "Lorem ipsum dolor sit amet consectetur", date: "01/08/2026" },
  { tag: "Điều trị ARV", title: "Ut enim ad minim veniam quis nostrud", date: "29/07/2026" },
  { tag: "Hỏi đáp", title: "Duis aute irure dolor in reprehenderit", date: "27/07/2026" },
];

export default async function HomePage() {
  return (
    <div>
      <section class="relative overflow-hidden bg-teal-50">
        <div class="mx-auto flex max-w-6xl flex-col px-4 sm:flex-row sm:items-end">
          <div class="flex flex-col justify-center gap-1 py-10 sm:w-1/2 sm:py-24">
            <span class="w-fit rounded-full bg-teal-100 px-4 py-1 text-sm font-medium text-teal-700">
              Kiến thức HIV & ARV
            </span>
            <h1 class="mt-4 text-5xl font-bold text-slate-900 uppercase">Mai Anh Quyền</h1>
            <p class="mt-2 text-lg font-semibold text-teal-700">
              Tiếp cận viên cộng đồng, chung tay phòng chống HIV/AIDS
            </p>
            <p class="mt-4 max-w-lg text-sm leading-relaxed text-slate-600 sm:text-base">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et
              dolore magna aliqua.
            </p>
            <div class="mt-6 flex flex-wrap gap-3">
              <a href="/blogs" class="rounded-full bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-700">
                Xem bài viết
              </a>
              <a
                href="/contact"
                class="rounded-full border border-teal-600 px-6 py-3 text-sm font-semibold text-teal-700 hover:bg-teal-50"
              >
                Liên hệ tư vấn
              </a>
            </div>
          </div>
          <div class="-mx-4 mt-8 aspect-4/3 sm:mx-0 sm:mt-0 sm:w-1/2">
            <img
              src="/image.JPG"
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
          {VALUE_PROPS.map((item) => (
            <div key={item.title} class="rounded-2xl border border-slate-200 p-6">
              <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-5 w-5">
                  <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <h3 class="text-base font-semibold text-slate-900">{item.title}</h3>
              <p class="mt-2 text-sm leading-relaxed text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section class="relative isolate overflow-hidden">
        <video
          class="absolute inset-0 h-full w-full object-cover"
          src="/video_16x9_480_noaudio_trimmed.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        <div class="absolute inset-0 bg-slate-900/60" />
        <div class="relative mx-auto flex min-h-140 max-w-6xl flex-col items-center justify-center gap-4 px-4 py-24 text-center text-white">
          <h2 class="text-2xl font-bold sm:text-3xl">Lorem ipsum dolor sit amet consectetur adipiscing elit</h2>
          <p class="max-w-xl text-sm leading-relaxed text-slate-100 sm:text-base">
            Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud.
          </p>
          <a href="/blogs" class="mt-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-teal-700 hover:bg-teal-50">
            Xem bài viết
          </a>
        </div>
      </section>

      <section class="bg-slate-50">
        <div class="mx-auto max-w-6xl px-4 py-16">
          <div class="mb-8 flex items-end justify-between">
            <h2 class="text-2xl font-bold text-slate-900">Bài viết mới nhất</h2>
            <a href="/blogs" class="text-sm font-medium text-teal-700 hover:underline">
              Xem tất cả →
            </a>
          </div>
          <div class="grid gap-6 sm:grid-cols-3">
            {LATEST_POSTS.map((post) => (
              <article key={post.title} class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div class="h-36 bg-slate-200" />
                <div class="space-y-2 p-5">
                  <span class="text-xs font-semibold uppercase tracking-wide text-teal-700">{post.tag}</span>
                  <h3 class="text-base font-semibold text-slate-900">{post.title}</h3>
                  <p class="text-xs text-slate-500">{post.date}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="flex flex-col items-center gap-4 rounded-2xl bg-teal-600 px-8 py-12 text-center text-white">
          <h2 class="text-2xl font-bold">Bạn cần được tư vấn riêng tư?</h2>
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
