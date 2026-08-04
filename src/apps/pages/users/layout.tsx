/** Nested layout - only wraps routes under `/users`, stacked inside the
 * root layout (`plans/app-router.md`: "layout.tsx: luôn gọi lòng nhau"). */
export default async function UsersLayout({ children }: { children?: unknown }) {
  return (
    <section class="rounded-md border border-dashed border-gray-400 p-3">
      <p class="mb-2 text-xs text-gray-500">users/layout.tsx (nested layout)</p>
      {children as never}
    </section>
  );
}
