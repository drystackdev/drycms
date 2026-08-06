/**
 * Pages-root fallback (`route-tree.ts`'s `buildRouteTree`) - rendered by
 * `page-handler.ts` for any URL that matches no real route AND has no
 * matching `redirect` row. Wrapped by the root layout like any other page
 * (a route miss isn't a content-layer failure, so there's no reason to
 * withhold the site's own nav/chrome here) - see `500.tsx` for the opposite
 * choice and why.
 */
export default async function NotFoundPage() {
  return (
    <div class="mx-auto max-w-5xl px-4 py-24 text-center">
      <p class="text-sm font-semibold uppercase tracking-wide text-red-900">404</p>
      <h1 class="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Không tìm thấy trang</h1>
      <p class="mt-2 text-sm text-slate-600">Trang này có thể đã bị gỡ hoặc đường dẫn không đúng.</p>
      <a
        href="/"
        class="mt-6 inline-block text-sm font-medium text-red-900 hover:underline"
      >
        ← Về trang chủ
      </a>
    </div>
  );
}
