export default async function HomePage() {
  const { total: userTotal } = await dry().collection("user").list();
  const { total: roleTotal } = await dry().collection("role").list();

  return (
    <main class="space-y-3">
      <h1 class="text-2xl font-bold">App Router demo</h1>
      <p class="text-gray-700">
        {userTotal} user(s), {roleTotal} role(s) in the database.
      </p>
      <p class="text-gray-700">
        Try{" "}
        <a class="text-blue-600 hover:underline" href="/users">
          /users
        </a>{" "}
        (collection list) or{" "}
        <a class="text-blue-600 hover:underline" href="/roles">
          /roles
        </a>{" "}
        (another collection, no nested layout).
      </p>
    </main>
  );
}
