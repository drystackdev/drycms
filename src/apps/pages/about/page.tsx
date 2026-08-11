export default async function AboutPage() {
  const about = await dry().singleton("about").get();
  if (!about) return null;
  const {
    intro,
    story,
    missionSection,
    missionItems,
    experienceSection,
    experienceItems,
    pressSection,
    pressMentions,
    bottomCta,
  } = about;

  return (
    <div>
      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="grid items-center gap-10 sm:grid-cols-2">
          <img
            src={intro.image}
            alt={intro.headline}
            class="aspect-square w-full rounded-2xl object-cover object-bottom"
          />
          <div class="space-y-4">
            <span class="rounded-full bg-red-100 px-4 py-1 text-sm font-medium text-red-900">
              {intro.eyebrow}
            </span>
            <h1 class="text-3xl mt-2 font-bold text-slate-900 sm:text-4xl">
              {intro.headline}
            </h1>
            <p class="text-sm leading-relaxed text-slate-600">
              {intro.description}
            </p>
          </div>
        </div>
      </section>

      <section class="bg-slate-50">
        <div class="mx-auto max-w-6xl px-4 py-16">
          <h2 class="text-2xl font-bold text-slate-900">{story.heading}</h2>
          <div
            class="dry-richtext mt-4 space-y-4 whitespace-pre-line text-sm leading-relaxed text-slate-600"
            dangerouslySetInnerHTML={{ __html: story.content }}
          ></div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <h2 class="text-2xl font-bold text-slate-900">
          {missionSection.heading}
        </h2>
        <ul class="mt-6 space-y-3">
          {missionItems.map((item) => (
            <li
              key={item.text}
              class="flex items-start gap-3 text-sm leading-relaxed text-slate-600"
            >
              <span class="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-900">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  class="h-3 w-3"
                >
                  <path
                    d="m8.5 12.5l2 2l5-5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
              {item.text}
            </li>
          ))}
        </ul>
      </section>

      <section class="bg-slate-50">
        <div class="mx-auto max-w-6xl px-4 py-16">
          <h2 class="text-2xl font-bold text-slate-900">
            {experienceSection.heading}
          </h2>
          <ol class="mt-6 space-y-6 border-l border-slate-200 pl-6">
            {experienceItems.map((item) => (
              <li key={item.year} class="relative">
                <span class="absolute -left-7.25 top-1 h-3 w-3 rounded-full bg-red-800" />
                <p class="text-sm font-semibold text-red-900">{item.year}</p>
                <p class="mt-1 text-sm leading-relaxed text-slate-600">
                  {item.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-16">
        <h2 class="text-2xl font-bold text-slate-900">
          {pressSection.heading}
        </h2>
        <p class="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
          {pressSection.description}
        </p>
        <div class="mt-6 grid gap-4 sm:grid-cols-2">
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
