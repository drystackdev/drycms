/** `params.slug` (see `plans/app-router.md`'s "Quyết định kiến trúc" #3 -
 * threaded as a normal prop, not a `Dry.params` global) holds the id for
 * this demo (this collection has no `slug` feature to look up by name). */
export default async function UserDetailPage({ params }: { params: { slug: string } }) {
  const user = await dry().collection("user").get(Number(params.slug));

  if (!user) {
    return (
      <main class="space-y-3">
        <h1 class="text-2xl font-bold">Not found</h1>
        <p>
          <a class="text-blue-600 hover:underline" href="/users">
            ← Back to users
          </a>
        </p>
      </main>
    );
  }

  return (
    <main class="space-y-3">
      <h1 class="text-2xl font-bold">{user.name}</h1>
      <p class="text-gray-700">{user.email}</p>
      <p>
        <a class="text-blue-600 hover:underline" href="/users">
          ← Back to users
        </a>
      </p>
    </main>
  );
}
