import { useState } from "preact/hooks";

/**
 * Interactive island - a plain (non-`async`) component, composed into
 * `UsersListPage`'s returned tree below rather than called directly. Hooks
 * only work inside a component Preact itself dispatches (`renderToStringAsync`
 * server-side, `hydrate()` client-side) - an `async function` page/layout
 * component never gets that treatment (it's invoked as a bare function to
 * resolve its `dry()` call, see `resolve-match.ts`), so `useState` inside
 * one always throws. See `plans/app-router.md`'s Giai đoạn 2 for the spike
 * that confirmed this.
 */
function AddUserButton() {
  const [toggle, setToggle] = useState(false);
  return (
    <button
      onClick={() => setToggle(!toggle)}
      class={`rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 ${toggle ? "bg-green-600 hover:bg-green-700" : ""}`}
    >
      Add User
    </button>
  );
}

export default async function UsersListPage() {
  const { rows } = await dry().collection("user").list();

  return (
    <main class="space-y-3">
      <h1 class="text-2xl font-bold">Users</h1>
      <AddUserButton />
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
