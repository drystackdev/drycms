import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from '../components/ConfirmDialog.js';
import DataTable, { type DataTableColumn } from '../components/DataTable.js';
import { TrashIcon } from '../components/icons/index.js';
import { toast } from '../components/Toast.js';
import { createContentEntriesApi } from '../content-types/entries-http-api.js';
import { discardEntryDraft, entryDraftIndex } from '../content-types/entry-draft-store.js';
import { createContentTypesApi } from '../content-types/http-api.js';
import { permissionActionsFor, type PermissionAction } from '../content-types/permissions.js';
import type { ContentTypeDefinition } from '../content-types/types.js';
import { useFetch } from '../hooks/useFetch.js';
import { authState, canAccess } from '../store/auth.js';
import { useDocumentTitle } from './page-common.js';

const ACTION_LABELS: Record<PermissionAction, string> = {
	view: 'View',
	create: 'Create',
	update: 'Update',
	delete: 'Delete',
	setting: 'Setting',
	magic: 'Magic',
};

interface CollectionRow extends Record<string, unknown> {
	id: string;
	label: string;
	name: string;
	fieldCount: number;
	entries: number | null;
}

interface SingletonRow extends Record<string, unknown> {
	id: string;
	label: string;
	name: string;
	fieldCount: number;
	hasData: boolean | null;
}

interface DraftRow extends Record<string, unknown> {
	id: string;
	typeLabel: string;
	entryLabel: string;
	updatedAt: number;
	typeSlug: string;
	entryId: string | null;
	kind: ContentTypeDefinition['kind'] | undefined;
}

export default function Dashboard() {
	useDocumentTitle('Dashboard');
	const { route } = useLocation();

	const contentTypesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
	const { data: contentTypes } = useFetch<ContentTypeDefinition[]>('content-types:list', (ifVersion, signal) =>
		contentTypesApi.listVersioned(ifVersion, signal),
	);

	const collections = useMemo(
		() => (contentTypes ?? []).filter((t) => t.kind === 'collection' && !t.hidden && canAccess(t.id, 'view')),
		[contentTypes],
	);
	const singletons = useMemo(
		() => (contentTypes ?? []).filter((t) => t.kind === 'singleton' && !t.hidden && canAccess(t.id, 'setting')),
		[contentTypes],
	);

	// Per-collection entry counts and per-singleton "has data" - the schema
	// list has no aggregate of its own, so this fetches page 1 of each
	// accessible resource just for its `total`/existence, same "one request
	// per resource" tradeoff `Roles.tsx` accepts for its own small lists.
	const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
	useEffect(() => {
		let cancelled = false;
		Promise.all(
			collections.map(async (type) => {
				try {
					const { total } = await createContentEntriesApi(`${path}/api/content`, type.name).list({ page: 0, pageSize: 1 });
					return [type.id, total] as const;
				} catch {
					return [type.id, 0] as const;
				}
			}),
		).then((results) => {
			if (!cancelled) setEntryCounts(Object.fromEntries(results));
		});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `collections` is derived from `contentTypes`; re-running per its own identity would refetch every render.
	}, [contentTypes]);

	const [singletonHasData, setSingletonHasData] = useState<Record<string, boolean>>({});
	useEffect(() => {
		let cancelled = false;
		Promise.all(
			singletons.map(async (type) => {
				try {
					const entry = await createContentEntriesApi(`${path}/api/content`, type.name).getSingleton();
					return [type.id, entry !== null] as const;
				} catch {
					return [type.id, false] as const;
				}
			}),
		).then((results) => {
			if (!cancelled) setSingletonHasData(Object.fromEntries(results));
		});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- same reasoning as the entry-count effect above.
	}, [contentTypes]);

	// Every unsaved local draft (see `entry-draft-store.ts`) across every
	// collection and singleton - the only "currently being edited" concept
	// this app has; there's no server-side editing lock.
	const typesByName = useMemo(() => new Map((contentTypes ?? []).map((t) => [t.name, t])), [contentTypes]);
	const draftRows: DraftRow[] = useMemo(
		() =>
			Object.entries(entryDraftIndex.value)
				.map(([key, entry]) => {
					const type = typesByName.get(entry.typeSlug);
					return {
						id: key,
						typeLabel: type?.label ?? entry.typeSlug,
						entryLabel: entry.entryId ? `#${entry.entryId}` : type?.kind === 'singleton' ? 'Settings' : 'New entry',
						updatedAt: entry.updatedAt,
						typeSlug: entry.typeSlug,
						entryId: entry.entryId,
						kind: type?.kind,
					};
				})
				.sort((a, b) => b.updatedAt - a.updatedAt),
		[entryDraftIndex.value, typesByName],
	);

	// Row pending discard confirmation - `null` when the dialog is closed.
	const [draftToDiscard, setDraftToDiscard] = useState<DraftRow | null>(null);
	const [discarding, setDiscarding] = useState(false);

	async function handleDiscardDraft() {
		if (!draftToDiscard) return;
		setDiscarding(true);
		try {
			await discardEntryDraft(draftToDiscard.typeSlug, draftToDiscard.entryId);
			toast.add({ type: 'success', title: `Discarded draft for "${draftToDiscard.typeLabel}".` });
			setDraftToDiscard(null);
		} finally {
			setDiscarding(false);
		}
	}

	const totalEntries = collections.reduce((sum, type) => sum + (entryCounts[type.id] ?? 0), 0);

	const stats = [
		{ label: 'Collections', value: String(collections.length) },
		{ label: 'Singletons', value: String(singletons.length) },
		{ label: 'Total entries', value: String(totalEntries) },
		{ label: 'Being edited', value: String(draftRows.length) },
	];

	const collectionColumns: DataTableColumn<CollectionRow>[] = [
		{ key: 'label', label: 'Collection', sortable: true },
		{ key: 'name', label: 'Name' },
		{ key: 'fieldCount', label: 'Fields', numeric: true, sortable: true },
		{
			key: 'entries',
			label: 'Entries',
			numeric: true,
			sortable: true,
			render: (value) => <>{value === null ? <span class="hint">…</span> : String(value)}</>,
		},
	];
	const collectionRows: CollectionRow[] = collections.map((type) => ({
		id: type.id,
		label: type.label,
		name: type.name,
		fieldCount: type.fields.length,
		entries: entryCounts[type.id] ?? null,
	}));

	const singletonColumns: DataTableColumn<SingletonRow>[] = [
		{ key: 'label', label: 'Singleton', sortable: true },
		{ key: 'name', label: 'Name' },
		{ key: 'fieldCount', label: 'Fields', numeric: true, sortable: true },
		{
			key: 'hasData',
			label: 'Status',
			render: (value) => (
				<span class={`badge sm ${value === null ? 'outline' : value ? 'success' : 'warning'}`}>
					{value === null ? 'Loading…' : value ? 'Configured' : 'Empty'}
				</span>
			),
		},
	];
	const singletonRows: SingletonRow[] = singletons.map((type) => ({
		id: type.id,
		label: type.label,
		name: type.name,
		fieldCount: type.fields.length,
		hasData: singletonHasData[type.id] ?? null,
	}));

	const draftColumns: DataTableColumn<DraftRow>[] = [
		{ key: 'typeLabel', label: 'Content type', sortable: true },
		{ key: 'entryLabel', label: 'Entry' },
		{
			key: 'updatedAt',
			label: 'Last edited',
			sortable: true,
			render: (value) => <>{new Date(value as number).toLocaleString()}</>,
		},
		{
			key: 'id',
			label: '',
			render: (_value, row) => (
				<button
					type="button"
					class="ghost icon sm"
					aria-label={`Discard draft for "${row.typeLabel}"`}
					data-tooltip="Discard"
					// Otherwise this would also trigger the row's own `onRowClick`
					// (navigate to the editor) - see `DataTable.tsx`'s guidance.
					onClick={(event) => {
						event.stopPropagation();
						setDraftToDiscard(row);
					}}
				>
					<TrashIcon />
				</button>
			),
		},
	];

	function draftHref(row: DraftRow): string {
		if (row.kind === 'singleton') return `${path}/content/${row.typeSlug}`;
		return `${path}/content/${row.typeSlug}/${row.entryId ?? 'new'}`;
	}

	const user = authState.value.user;
	const permissionRows = [...collections, ...singletons]
		.map((type) => ({ type, actions: permissionActionsFor(type).filter((action) => canAccess(type.id, action)) }))
		.filter((row) => row.actions.length > 0);

	return (
		<>
			<div class="page-header">
				<div>
					<h1>Dashboard</h1>
					<p>An overview of everything drycms is managing.</p>
				</div>
			</div>

			<div class="grid cols-4">
				{stats.map((stat) => (
					<article class="card" key={stat.label}>
						<header>
							<p>{stat.label}</p>
							<span class="metric">{stat.value}</span>
						</header>
					</article>
				))}
			</div>

			<div class="grid cols-2">
				<section class="card flush">
					<header>
						<h2>Collections</h2>
						<p>
							{collections.length} collection{collections.length === 1 ? '' : 's'} you can access.
						</p>
					</header>
					<div style="padding: 0 1.25rem 1.25rem">
						<DataTable
							columns={collectionColumns}
							rows={collectionRows}
							rowKey={(row) => row.id}
							pageSize={5}
							searchable={false}
							emptyLabel="No collections yet."
							onRowClick={(row) => route(`${path}/content/${row.name}`)}
						/>
					</div>
				</section>

				<section class="card flush">
					<header>
						<h2>Singletons</h2>
						<p>
							{singletons.length} singleton{singletons.length === 1 ? '' : 's'} you can access.
						</p>
					</header>
					<div style="padding: 0 1.25rem 1.25rem">
						<DataTable
							columns={singletonColumns}
							rows={singletonRows}
							rowKey={(row) => row.id}
							pageSize={5}
							searchable={false}
							emptyLabel="No singletons yet."
							onRowClick={(row) => route(`${path}/content/${row.name}`)}
						/>
					</div>
				</section>
			</div>

			<section class="card flush">
				<header>
					<h2>Items being edited</h2>
					<p>Unsaved local drafts across every collection and singleton, on this device.</p>
				</header>
				<div style="padding: 0 1.25rem 1.25rem">
					<DataTable
						columns={draftColumns}
						rows={draftRows}
						rowKey={(row) => row.id}
						pageSize={5}
						searchable={false}
						emptyLabel="Nothing is being edited right now."
						onRowClick={(row) => route(draftHref(row))}
					/>
				</div>
			</section>

			<section class="card">
				<header>
					<h2>Your permissions</h2>
					<p>Roles and granted actions for your account.</p>
				</header>

				<div class="field">
					<label>Roles</label>
					<div class="row" style={{ flexWrap: 'wrap', gap: '0.375rem' }}>
						{user?.isSuperAdmin && <span class="badge sm success">Super Admin - full access</span>}
						{!user?.isSuperAdmin &&
							(!user || user.roles.length === 0 ? (
								<span class="hint">No roles assigned.</span>
							) : (
								user.roles.map((role) => (
									<span key={role} class="badge sm info">
										{role}
									</span>
								))
							))}
					</div>
				</div>

				{!user?.isSuperAdmin && (
					<div class="stack" style={{ marginTop: '1rem', gap: '0.5rem' }}>
						{permissionRows.length === 0 && <span class="hint">No content permissions granted.</span>}
						{permissionRows.map(({ type, actions }) => (
							<div key={type.id} class="row justify-between">
								<span>{type.label}</span>
								<div class="row" style={{ flexWrap: 'wrap', gap: '0.25rem' }}>
									{actions.map((action) => (
										<span key={action} class="badge sm outline">
											{ACTION_LABELS[action]}
										</span>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			<ConfirmDialog
				open={draftToDiscard !== null}
				title="Discard this draft?"
				message={
					<p>
						This discards the unsaved local draft for "{draftToDiscard?.typeLabel}"
						{draftToDiscard?.entryLabel ? ` (${draftToDiscard.entryLabel})` : ''}. This cannot be undone.
					</p>
				}
				confirmLabel="Discard"
				destructive
				busy={discarding}
				onConfirm={handleDiscardDraft}
				onCancel={() => setDraftToDiscard(null)}
			/>
		</>
	);
}
