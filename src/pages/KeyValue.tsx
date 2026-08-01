import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { path } from "virtual:drycms/config";
import { authState, loadSession } from "../store/auth.js";
import Icon from "../components/Icon.js";
import { ReplaceIcon } from "../components/icons.js";
import Combobox from "../components/Combobox.js";
import DataTable from "../components/DataTable.js";
import { useDocumentTitle } from "./page-common.js";

interface KvMeta {
  namespace: string;
  key: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  sizeBytes: number;
}

interface KvListResponse {
  revision: number;
  items: KvMeta[];
  nextCursor?: string;
}

type KvRow = KvMeta & Record<string, unknown>;

const NAMESPACES = [
  "content",
  "storage",
  "icons",
  "richtext",
  "cache",
  "session",
  "config",
];

function formatTime(value: string | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function LoginRedirect() {
  useEffect(() => {
    window.location.assign(`${path}/login`);
  }, []);
  return <progress class="route-progress" />;
}

export default function KeyValue() {
  useDocumentTitle("Key Value");
  const isAuthenticated = authState.value.status === "authenticated";
  const isSuperAdmin =
    authState.value.user?.roles.includes("Super Admin") ?? false;
  const [namespace, setNamespace] = useState("content");
  const [data, setData] = useState<KvListResponse | null>(null);
  const [selected, setSelected] = useState<KvMeta | null>(null);
  const [valueText, setValueText] = useState("");
  const etagRef = useRef<string | undefined>();
  const requestInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const baseUrl = useMemo(() => `${path}/api/key-value`, []);

  const load = useCallback(
    async (force = false, background = false) => {
      if (!isSuperAdmin || !namespace.trim()) return;
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      if (!background) setBusy(true);
      try {
        const headers: HeadersInit = {};
        if (!force && etagRef.current)
          headers["If-None-Match"] = etagRef.current;
        const query = new URLSearchParams({ limit: "100" });
        const response = await fetch(
          `${baseUrl}/${encodeURIComponent(namespace.trim())}?${query}`,
          { headers },
        );
        if (response.status === 304) return;
        if (response.status === 401) {
          await loadSession();
          return;
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(
            body.message ??
              `Failed to load Key Value records (HTTP ${response.status}).`,
          );
        }
        etagRef.current = response.headers.get("ETag") ?? undefined;
        setData((await response.json()) as KvListResponse);
        setError(null);
      } catch (reason) {
        if (!background)
          setError(
            reason instanceof Error
              ? reason.message
              : "Failed to load Key Value records.",
          );
      } finally {
        if (!background) setBusy(false);
        requestInFlight.current = false;
      }
    },
    [baseUrl, isSuperAdmin, namespace],
  );

  useEffect(() => {
    void load(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load(false, true);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false, true);
    }, 5_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const changeNamespace = (next: string) => {
    if (!next || next === namespace) return;
    setNamespace(next);
    setSelected(null);
    setData(null);
    etagRef.current = undefined;
  };

  const openValue = async (item: KvMeta) => {
    setSelected(item);
    try {
      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(item.namespace)}/${encodeURIComponent(item.key)}`,
      );
      if (!response.ok) throw new Error("Key no longer exists.");
      const body = (await response.json()) as { value: unknown };
      setValueText(JSON.stringify(body.value, null, 2));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Failed to load value.",
      );
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const value = JSON.parse(valueText);
      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(selected.namespace)}/${encodeURIComponent(selected.key)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value, durability: "async" }),
        },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => ({}))).message ??
            "Failed to save value.",
        );
      await load(true);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof SyntaxError
          ? "Value must be valid JSON."
          : reason instanceof Error
            ? reason.message
            : "Failed to save value.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete key "${selected.key}"?`)) return;
    setSaving(true);
    try {
      const response = await fetch(
        `${baseUrl}/${encodeURIComponent(selected.namespace)}/${encodeURIComponent(selected.key)}`,
        { method: "DELETE" },
      );
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => ({}))).message ??
            "Failed to delete value.",
        );
      setSelected(null);
      await load(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Failed to delete value.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated) {
    return <LoginRedirect />;
  }

  if (!isSuperAdmin) {
    return (
      <div class="empty">
        <Icon name="Lock" size="2rem" />
        <strong>Super Admin only</strong>
        <small>Key Value is restricted to Super Admin accounts.</small>
      </div>
    );
  }

  return (
    <>
      <div class="page-header">
        <div>
          <h1>Key Value</h1>
          <p>
            Inspect and manage persisted server-side values. Refreshes
            automatically every 5 seconds.
          </p>
        </div>
      </div>

      <section class="card">
        {error && (
          <div class="alert">
            <strong>Key Value error</strong>
            <p>{error}</p>
          </div>
        )}
        <DataTable
          columns={[
            {
              key: "key",
              label: "Key",
              render: (value) => <strong>{String(value)}</strong>,
            },
            { key: "version", label: "Version", numeric: true },
            {
              key: "sizeBytes",
              label: "Size",
              numeric: true,
              render: (value) => (
                <span>{Number(value).toLocaleString()} B</span>
              ),
            },
            {
              key: "updatedAt",
              label: "Updated",
              render: (value) => <span>{formatTime(String(value))}</span>,
            },
            {
              key: "expiresAt",
              label: "Expires",
              render: (value) => (
                <span>{formatTime(value ? String(value) : undefined)}</span>
              ),
            },
          ]}
          rows={(data?.items ?? []) as unknown as KvRow[]}
          rowKey={(row) => String(row.key)}
          pageSize={25}
          searchPlaceholder="Search key…"
          emptyLabel={
            busy ? "Loading…" : "No Key Value records in this namespace."
          }
          onRowClick={(row) => void openValue(row as unknown as KvMeta)}
          actions={
            <div
              class="row"
              style={{
                gap: "0.375rem",
                flexWrap: "nowrap",
                alignItems: "center",
              }}
            >
              <Combobox
                id="kv-namespace"
                value={namespace}
                placeholder="Namespace"
                options={NAMESPACES.map((item) => ({
                  value: item,
                  label: item
                    ? item?.at(0)?.toUpperCase() + item.slice(1)
                    : item,
                }))}
                onChange={changeNamespace}
              />
              <button
                type="button"
                class="outline icon lg"
                aria-label="Refresh Key Value records"
                data-tooltip="Refresh"
                onClick={() => void load(true)}
                disabled={busy}
                style={{ flexShrink: 0 }}
              >
                <ReplaceIcon />
              </button>
            </div>
          }
        />
      </section>

      {selected && (
        <section class="card">
          <header>
            <h2>{selected.key}</h2>
            <p>
              {selected.namespace} · version {selected.version}
            </p>
          </header>
          <div class="field">
            <label for="kv-value">JSON value</label>
            <textarea
              id="kv-value"
              rows={12}
              value={valueText}
              onInput={(event) =>
                setValueText((event.currentTarget as HTMLTextAreaElement).value)
              }
            />
          </div>
          <div class="row">
            <button type="button" onClick={() => void save()} disabled={saving}>
              Save
            </button>
            <button
              type="button"
              class="destructive"
              onClick={() => void remove()}
              disabled={saving}
            >
              Delete
            </button>
          </div>
        </section>
      )}
    </>
  );
}
