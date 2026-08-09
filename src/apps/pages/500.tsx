/**
 * Pages-root fallback (`route-tree.ts`'s `buildRouteTree`) - rendered
 * standalone by `render.ts`'s `renderErrorHtml` (no root layout, no
 * `dry()` context, no hydrate script) whenever rendering a page throws.
 *
 * Keep it a plain SYNC component with no data dependency at all: the content
 * layer is exactly what's often broken when this page is what's needed, so
 * it must stay renderable independent of the DB.
 */
export default function ServerErrorPage() {
  return (
    <div class="flex min-h-screen items-center justify-center px-4 text-center">
      <div>
        <p class="text-sm font-semibold uppercase tracking-wide text-slate-500">500</p>
        <h1 class="mt-2 text-2xl font-bold sm:text-3xl">Đã có lỗi xảy ra</h1>
        <p class="mt-2 text-sm text-slate-600">Vui lòng thử lại sau ít phút.</p>
        <a href="/" class="mt-6 inline-block text-sm font-medium underline">
          ← Về trang chủ
        </a>
      </div>
    </div>
  );
}
