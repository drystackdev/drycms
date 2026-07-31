import { useMemo } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import DataTable, { type DataTableColumn } from "../components/DataTable.js";
import { PlusIcon } from "../components/icons.js";
import { createContentEntriesApi, type EntryListResult } from "../content-types/entries-http-api.js";
import { useFetch } from "../hooks/useFetch.js";
import { useDocumentTitle } from "./page-common.js";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  isSuperAdmin: boolean;
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

  const { data, loading, error } = useFetch<EntryListResult>("roles:list", (ifVersion, signal) =>
    entriesApi.listVersioned({ page: 0, pageSize: FETCH_ALL_SIZE }, ifVersion, signal),
  );
  const rows: Row[] = (data?.rows ?? []).map((r) => ({
    id: r.id,
    name: String(r.value.name ?? ""),
    description: String(r.value.description ?? ""),
    isSuperAdmin: !!r.value.isSuperAdmin,
  }));
  const loadError = error ? (error instanceof Error ? error.message : "Failed to load roles.") : null;

  const columns: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", sortable: true },
    {
      key: "description",
      label: "Description",
      render: (value) => <>{value ? String(value) : <i class="hint">No description</i>}</>,
    },
    {
      key: "isSuperAdmin",
      label: "Super Admin",
      sortable: false,
      render: (value) => (value ? <span class="badge warning">Super Admin</span> : <em class="badge secondary">Normal</em>),
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
        actions={
          <button type="button" onClick={() => route(`${path}/roles/new`)}>
            <PlusIcon /> Add
          </button>
        }
      />
    </>
  );
}
