/**
 * The site's root route (`/`) - the starter `bun run new:project` leaves
 * behind. Hardcoded on purpose; make it `async` and read real content with
 * `dry()` once you have content types, e.g.
 *
 *   const home = await dry().singleton("homepage").get();
 *   const { rows } = await dry().collection("blog").list({ pageSize: 3 });
 *
 * `dry()` is an ambient global here - no import needed (see
 * `src/apps/dry.generated.d.ts`, regenerated on every dev-server start).
 */
const SITE_NAME = "sivelap";

export default function HomePage() {
  return (
    <div class="mx-auto max-w-3xl px-4 py-20">
      <p class="text-sm font-semibold uppercase tracking-wide text-slate-500">drycms</p>
      <h1 class="mt-2 text-4xl font-bold">{SITE_NAME}</h1>
      <p class="mt-4 text-slate-600">
        Trang này là starter trống. Sửa <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">src/apps/pages/page.tsx</code>{" "}
        để bắt đầu.
      </p>

      <ol class="mt-8 space-y-3 text-slate-700">
        <li>
          1. Vào <a href="/dry" class="font-medium underline">/dry</a> và tạo tài khoản admin đầu tiên.
        </li>
        <li>2. Tạo content type trong Content → Apply and build.</li>
        <li>
          3. Đọc dữ liệu ra trang bằng <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">dry()</code>, rồi{" "}
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">bun run seed:sync</code> để đóng gói schema.
        </li>
      </ol>
    </div>
  );
}
