/** No `roles/layout.tsx` here on purpose - only the root layout wraps this
 * page, unlike `/users` which also gets `users/layout.tsx`. */
export default async function RolesListPage() {
  const { rows } = await dry().collection("role").list();

  return (
    <main class="space-y-3">
      <h1 class="text-2xl font-bold">Roles</h1>
      <ul class="space-y-1">
        {rows.map((role) => (
          <li key={role.id}>
            {role.name}
            {role.isSuperAdmin ? <span class="ml-1 text-xs text-amber-600">(super admin)</span> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
