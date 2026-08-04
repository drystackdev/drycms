const CONTACT_CHANNELS = [
  {
    label: "Điện thoại",
    value: "0000 000 000",
    href: "tel:0000000000",
    icon: (
      <path
        d="m10.038 5.316l.649 1.163c.585 1.05.35 2.426-.572 3.349c0 0-1.12 1.119.91 3.148c2.028 2.028 3.147.91 3.147.91c.923-.923 2.3-1.158 3.349-.573l1.163.65c1.585.884 1.772 3.106.379 4.5c-.837.836-1.863 1.488-2.996 1.53c-1.908.073-5.149-.41-8.4-3.66c-3.25-3.251-3.733-6.492-3.66-8.4c.043-1.133.694-2.159 1.53-2.996c1.394-1.393 3.616-1.206 4.5.38Z"
        stroke-linecap="round"
      />
    ),
  },
  {
    label: "Email",
    value: "contact@example.com",
    href: "mailto:contact@example.com",
    icon: (
      <>
        <path d="M2 12c0-3.771 0-5.657 1.172-6.828S6.229 4 10 4h4c3.771 0 5.657 0 6.828 1.172S22 8.229 22 12s0 5.657-1.172 6.828S17.771 20 14 20h-4c-3.771 0-5.657 0-6.828-1.172S2 15.771 2 12Z" />
        <path d="m6 8l2.159 1.8c1.837 1.53 2.755 2.295 3.841 2.295s2.005-.765 3.841-2.296L18 8" stroke-linecap="round" />
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
        <span class="rounded-full bg-red-100 px-4 py-1 text-sm font-medium text-red-900">Liên hệ</span>
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
              class="flex items-center gap-4 rounded-2xl border border-slate-200 p-5 hover:border-red-300 hover:bg-red-50"
            >
              <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-900">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-5 w-5">
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
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-red-600 focus:outline-none"
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
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-red-600 focus:outline-none"
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
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-red-600 focus:outline-none"
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
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-red-600 focus:outline-none"
            />
          </div>
          <button type="submit" class="w-full rounded-full bg-red-800 px-6 py-3 text-sm font-semibold text-white hover:bg-red-900">
            Gửi thông tin
          </button>
        </form>
      </div>
    </div>
  );
}
