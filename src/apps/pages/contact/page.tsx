const CONTACT_CHANNELS = [
  {
    label: "Điện thoại",
    value: "0000 000 000",
    href: "tel:0000000000",
    icon: (
      <path
        d="M4 5c0-.6.4-1 1-1h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3c0 .6-.4 1-1 1A15 15 0 014 6z"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    ),
  },
  {
    label: "Email",
    value: "contact@example.com",
    href: "mailto:contact@example.com",
    icon: (
      <>
        <path d="M4 6h16v12H4z" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M4 7l8 6 8-6" stroke-linecap="round" stroke-linejoin="round" />
      </>
    ),
  },
  {
    label: "Fanpage",
    value: "facebook.com/[tenpage]",
    href: "#",
    icon: (
      <path
        d="M15 8h-2a2 2 0 00-2 2v2H9v3h2v6h3v-6h2l1-3h-3v-2h3z"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    ),
  },
];

export default async function ContactPage() {
  return (
    <div class="mx-auto max-w-6xl px-4 py-16">
      <div class="max-w-2xl">
        <span class="rounded-full bg-teal-100 px-4 py-1 text-sm font-medium text-teal-700">Liên hệ</span>
        <h1 class="mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">Cùng trò chuyện</h1>
        <p class="mt-3 text-sm leading-relaxed text-slate-600">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mọi thông tin được giữ riêng tư và bảo mật tuyệt đối.
        </p>
      </div>

      <div class="mt-10 grid gap-10 lg:grid-cols-5">
        <div class="space-y-4 lg:col-span-2">
          {CONTACT_CHANNELS.map((channel) => (
            <a
              key={channel.label}
              href={channel.href}
              class="flex items-center gap-4 rounded-2xl border border-slate-200 p-5 hover:border-teal-300 hover:bg-teal-50"
            >
              <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-5 w-5">
                  {channel.icon}
                </svg>
              </span>
              <div>
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{channel.label}</p>
                <p class="text-sm font-semibold text-slate-900">{channel.value}</p>
              </div>
            </a>
          ))}
        </div>

        <form class="space-y-4 rounded-2xl border border-slate-200 p-6 lg:col-span-3">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5">
              <label class="text-sm font-medium text-slate-700" for="name">
                Họ tên
              </label>
              <input
                id="name"
                type="text"
                placeholder="Nguyễn Văn A"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-sm font-medium text-slate-700" for="phone">
                Số điện thoại
              </label>
              <input
                id="phone"
                type="tel"
                placeholder="09xx xxx xxx"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-slate-700" for="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="ban@example.com"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-slate-700" for="message">
              Nội dung cần tư vấn
            </label>
            <textarea
              id="message"
              rows={4}
              placeholder="Lorem ipsum dolor sit amet, consectetur adipiscing elit..."
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
            />
          </div>
          <button type="submit" class="w-full rounded-full bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-700">
            Gửi thông tin
          </button>
        </form>
      </div>
    </div>
  );
}
