/**
 * Pages-root fallback (`route-tree.ts`'s `buildRouteTree`) - rendered
 * standalone by `render.ts`'s `renderErrorHtml` (no root layout, no `dry()`
 * context, no hydrate script) whenever rendering a page throws, both for a
 * failure caught before any render started (`page-handler.ts`'s own setup:
 * schema/content adapters, SEO defaults, VEI session) and, on a best-effort
 * basis, one that happens mid-render (see `render.ts`'s `RenderPageOptions.
 * onRenderError` doc comment for why that second case can't recover the
 * HTTP status code).
 *
 * Deliberately a plain SYNC component with no data dependency at all - the
 * root layout calls `dry()` for nav/site settings, which is exactly the
 * kind of thing that's often broken when this page is what's needed, so it
 * must stay renderable independent of the content/DB layer.
 */
export default function ServerErrorPage() {
  return (
    <div class="flex min-h-screen items-center justify-center px-4 text-center">
      <div>
        <p class="text-sm font-semibold uppercase tracking-wide text-red-900">500</p>
        <h1 class="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Đã có lỗi xảy ra</h1>
        <p class="mt-2 text-sm text-slate-600">Vui lòng thử lại sau ít phút.</p>
        <a
          href="/"
          class="mt-6 inline-block text-sm font-medium text-red-900 hover:underline"
        >
          ← Về trang chủ
        </a>
      </div>
    </div>
  );
}
