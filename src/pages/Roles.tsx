import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import DataTable, { type DataTableColumn } from "../components/DataTable.js";
import { PlusIcon } from "../components/icons/index.js";
import { createContentEntriesApi, type EntryListResult } from "../content-types/entries-http-api.js";
import { useFetch } from "../hooks/useFetch.js";
import { useDocumentTitle } from "./page-common.js";
import { canAccess } from "../store/auth.js";
import { createContentTypesApi } from "../content-types/http-api.js";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
}

/** `role` is a plain content type on the backend (same API every other
 * collection uses), but gets its own list+edit UI rather than the generic
 * `ContentEntryList`/`ContentEntryEditor` - see `RoleEditor.tsx` for why
 * (permission toggles, a user picker, no generic field loop). Role counts are
 * expected to be small, so this fetches everything at once rather than
 * paginating - same "fetch all, no server query" mode `ContentEntryList.tsx`
 * uses for its own small/client-search collections. */
const FETCH_ALL_SIZE = 10_000;

export default function Roles() {
  const { route } = useLocation();
  useDocumentTitle("Roles");
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "role"), []);
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const [roleTypeId, setRoleTypeId] = useState<string | null>(null);
  useEffect(() => { void typesApi.list().then((types) => setRoleTypeId(types.find((type) => type.name === "role")?.id ?? null)); }, [typesApi]);
  const canCreate = !!roleTypeId && canAccess(roleTypeId, "create");

  const { data, loading, error } = useFetch<EntryListResult>("roles:list", (ifVersion, signal) =>
    entriesApi.listVersioned({ page: 0, pageSize: FETCH_ALL_SIZE }, ifVersion, signal),
  );
  // The seeded Super Admin role is an internal bypass role, not a role that
  // administrators configure. Keep it in the underlying entries API because
  // authentication needs it, but omit it from this management screen.
  const rows: Row[] = (data?.rows ?? [])
    .filter((r) => r.value.isSuperAdmin !== true)
    .map((r) => ({
      id: r.id,
      name: String(r.value.name ?? ""),
      description: String(r.value.description ?? ""),
    }));
  const loadError = error ? (error instanceof Error ? error.message : "Failed to load roles.") : null;

  const columns: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", sortable: true },
    {
      key: "description",
      label: "Description",
      render: (value) => <>{value ? String(value) : <i class="hint">No description</i>}</>,
    },
  ];

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Roles</h1>
          <p>Named sets of permissions users can be assigned.</p>
        </div>
      </div>

      {loadError && <span class="error">{loadError}</span>}
      {loading && <span class="hint">Loading...</span>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyLabel="No roles yet."
        onRowClick={(row) => route(`${path}/roles/${row.id}`)}
        actions={canCreate ? (
          <button type="button" onClick={() => route(`${path}/roles/new`)}>
            <PlusIcon /> Add
          </button>
        ) : undefined}
      />
    </>
  );
}
