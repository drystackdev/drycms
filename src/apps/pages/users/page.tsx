export default async function UsersListPage() {
  const { rows } = await dry().collection("user").list();

  return (
    <main class="space-y-3">
      <h1 class="text-2xl font-bold">Users</h1>
      <ul class="space-y-1">
        {rows.map((user) => (
          <li key={user.id}>
            <a class="text-blue-600 hover:underline" href={`/users/${user.id}`}>
              {user.name}
            </a>{" "}
            <span class="text-gray-500">- {user.email}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
