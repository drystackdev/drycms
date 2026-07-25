import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import type { FileEntry } from './file-manager-types.js';
import {
	collectDescendantIds,
	folderPath,
	formatBytes,
	formatDate,
	isAccepted,
	isHiddenEntry,
	isImageEntry,
	sortEntries,
	thumbnailUrl,
} from './file-manager-utils.js';
import {
	AddFolderIcon,
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CloseIcon,
	CopyIcon,
	GridIcon,
	ListViewIcon,
	MinusIcon,
	MoreVerticalIcon,
	MoveIcon,
	PasteIcon,
	PlusIcon,
	RenameIcon,
	ReplaceIcon,
	TrashIcon,
	UploadIcon,
	XIcon,
} from './icons.js';
import { useOutsideClick, usePopupFlip, useScrollLock } from './list-nav.js';
import { toast } from './Toast.js';
import FileManagerUploadArtwork from './FileManagerUploadArtwork.js';

export interface FileManagerProps {
	/** Mock dataset - the component keeps its own copy and mutates it locally (move/copy/delete/rename/replace/upload never touch the original array). */
	data: FileEntry[];
	/** Selected id(s). Single mode (`multiple` false): a `string` (`''` when nothing's picked). Multi mode (the default): a `string[]`. */
	value?: string | string[];
	onChange?: (value: string | string[]) => void;
	/** @default true */
	multiple?: boolean;
	/** Extensions (no dot) a file must match to be selectable. Non-matching files are shown disabled, not hidden. Folders are never disabled by this. */
	accept?: string[];
	/** @default "list" */
	defaultView?: 'list' | 'grid';
}

type MoveCopyState = { mode: 'move' | 'copy'; ids: string[] } | null;

/** Opens/closes a native `<dialog>` to match `active`, and reports back when the dialog closes itself (Escape, backdrop click, or an in-dialog `close()` call). */
function useDialogSync(active: boolean, onDismiss: () => void) {
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (active && !el.open) el.showModal();
		if (!active && el.open) el.close();
	}, [active]);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const handleClose = () => onDismiss();
		el.addEventListener('close', handleClose);
		return () => el.removeEventListener('close', handleClose);
	}, [onDismiss]);

	return ref;
}

// --------------------------------------------------------------- More menu

interface MoreMenuProps {
	label: string;
	onMove: () => void;
	onCopy: () => void;
	onRename: () => void;
	onReplace: () => void;
	onDelete: () => void;
}

function MoreMenu({ label, onMove, onCopy, onRename, onReplace, onDelete }: MoreMenuProps) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);
	const openUp = usePopupFlip(open, wrapRef, 220);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	useOutsideClick(open, [wrapRef], () => setOpen(false));
	useScrollLock(open, wrapRef);

	useLayoutEffect(() => {
		if (!open) {
			setPosition(null);
			return;
		}
		const rect = wrapRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({ left: rect.right, top: openUp ? rect.top - 4 : rect.bottom + 4 });
	}, [open, openUp]);

	const run = (action: () => void) => {
		setOpen(false);
		action();
	};

	return (
		<div class="file-more" ref={wrapRef}>
			<button
				type="button"
				class="ghost icon sm"
				data-tooltip="More actions"
				aria-label={`More actions for ${label}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={(event) => {
					event.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				<MoreVerticalIcon />
			</button>
			{/* Portaled to `<body>` - a menu nested inside a scroll/overflow-clipped
			 * row (the table's `.scroll` wrapper, a grid card, ...) would otherwise
			 * get cut off instead of floating free. Scroll is locked (see
			 * `useScrollLock`) while it's open so its fixed position stays put. */}
			{open &&
				position &&
				createPortal(
					<ul
						class={openUp ? 'file-more-menu up' : 'file-more-menu'}
						role="menu"
						style={{
							position: 'fixed',
							left: `${position.left}px`,
							top: `${position.top}px`,
							transform: openUp ? 'translate(-100%, -100%)' : 'translate(-100%, 0)',
						}}
						onClick={(event) => event.stopPropagation()}
					>
						<li role="none">
							<button type="button" role="menuitem" onClick={() => run(onMove)}>
								<MoveIcon /> Move
							</button>
						</li>
						<li role="none">
							<button type="button" role="menuitem" onClick={() => run(onCopy)}>
								<CopyIcon /> Copy
							</button>
						</li>
						<li role="none">
							<button type="button" role="menuitem" onClick={() => run(onRename)}>
								<RenameIcon /> Rename
							</button>
						</li>
						<li role="none">
							<button type="button" role="menuitem" onClick={() => run(onReplace)}>
								<ReplaceIcon /> Replace
							</button>
						</li>
						<li class="file-more-menu-separator" role="separator" />
						<li role="none">
							<button type="button" role="menuitem" class="file-more-menu-danger" onClick={() => run(onDelete)}>
								<TrashIcon /> Delete
							</button>
						</li>
					</ul>,
					document.body,
				)}
		</div>
	);
}

// --------------------------------------------------------------- Breadcrumb

function Breadcrumb({ chain, onNavigate }: { chain: FileEntry[]; onNavigate: (id: string | null) => void }) {
	return (
		<nav class="file-breadcrumb" aria-label="Breadcrumb">
			<button type="button" class="link" onClick={() => onNavigate(null)}>
				Root
			</button>
			{chain.map((entry) => (
				<span key={entry.id}>
					<span class="file-breadcrumb-sep" aria-hidden="true">/</span>
					<button type="button" class="link" onClick={() => onNavigate(entry.id)}>
						{entry.name}
					</button>
				</span>
			))}
		</nav>
	);
}

// ------------------------------------------------------------------ Toolbar

interface ToolbarProps {
	query: string;
	onQuery: (value: string) => void;
	view: 'list' | 'grid';
	onView: (view: 'list' | 'grid') => void;
	onNewFolder: () => void;
	onUpload: () => void;
}

function Toolbar({ query, onQuery, view, onView, onNewFolder, onUpload }: ToolbarProps) {
	return (
		<div class="file-toolbar row">
			<input
				type="search"
				value={query}
				placeholder="Search this folder…"
				aria-label="Search this folder"
				style="max-width: 18rem"
				onInput={(event) => onQuery((event.currentTarget as HTMLInputElement).value)}
			/>
			<span class="spacer" />
			<div class="file-view-toggle" role="group" aria-label="View">
				<button
					type="button"
					class="ghost icon sm"
					data-tooltip="List view"
					aria-pressed={view === 'list'}
					aria-label="List view"
					onClick={() => onView('list')}
				>
					<ListViewIcon />
				</button>
				<button
					type="button"
					class="ghost icon sm"
					data-tooltip="Grid view"
					aria-pressed={view === 'grid'}
					aria-label="Grid view"
					onClick={() => onView('grid')}
				>
					<GridIcon />
				</button>
			</div>
			<button type="button" class="outline sm" onClick={onNewFolder}>
				<AddFolderIcon /> New folder
			</button>
			<button type="button" class="outline sm" onClick={onUpload}>
				<UploadIcon /> Upload
			</button>
		</div>
	);
}

// ---------------------------------------------------------------- List view

interface ViewProps {
	entries: FileEntry[];
	selectedIds: string[];
	isDisabled: (entry: FileEntry) => boolean;
	onToggle: (entry: FileEntry) => void;
	onOpen: (entry: FileEntry) => void;
	more: (entry: FileEntry) => ComponentChildren;
}

function ListView({
	entries,
	selectedIds,
	isDisabled,
	sortDir,
	onSort,
	onToggle,
	onOpen,
	more,
	multiple,
	allSelected,
	onToggleAll,
}: ViewProps & { sortDir: 'asc' | 'desc'; onSort: () => void; multiple: boolean; allSelected: boolean; onToggleAll: () => void }) {
	return (
		<div class="scroll">
			<table class="file-table">
				<thead>
					<tr>
						<th class="file-table-check">
							{multiple ? (
								<input
									type="checkbox"
									checked={allSelected}
									data-tooltip={allSelected ? 'Unselect all' : 'Select all'}
									aria-label={allSelected ? 'Unselect all' : 'Select all'}
									onChange={onToggleAll}
								/>
							) : (
								<span class="sr-only">Select</span>
							)}
						</th>
						<th>
							<button type="button" class="link sm" onClick={onSort}>
								Name
								{sortDir === 'asc' ? <ArrowUpIcon /> : <ArrowDownIcon />}
							</button>
						</th>
						<th class="numeric">Size</th>
						<th>Type</th>
						<th>Modified</th>
						<th class="file-table-more">
							<span class="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{entries.length === 0 ? (
						<tr>
							<td colSpan={6}>
								<div class="empty">No files.</div>
							</td>
						</tr>
					) : (
						entries.map((entry) => {
							const selected = selectedIds.includes(entry.id);
							const disabled = isDisabled(entry);
							const { date, time } = formatDate(entry.modifiedAt);
							return (
								<tr key={entry.id} class={selected ? 'selected' : undefined}>
									<td class="file-table-check">
										<input
											type="checkbox"
											checked={selected}
											disabled={disabled}
											aria-label={`Select ${entry.name}`}
											onClick={(event) => event.stopPropagation()}
											onChange={() => onToggle(entry)}
										/>
									</td>
									<td>
										<button type="button" class="file-name-cell" onClick={() => onOpen(entry)}>
											<img class="file-thumb-icon" src={thumbnailUrl(entry)} alt="" width={20} height={20} />
											<span>{entry.name}</span>
										</button>
									</td>
									<td class="numeric">{formatBytes(entry.size)}</td>
									<td>{entry.kind === 'folder' ? 'folder' : entry.ext}</td>
									<td>
										<div>{date}</div>
										<small class="muted">{time}</small>
									</td>
									<td class="file-table-more">{more(entry)}</td>
								</tr>
							);
						})
					)}
				</tbody>
			</table>
		</div>
	);
}

// ---------------------------------------------------------------- Grid view

function GridView({ entries, selectedIds, isDisabled, onToggle, onOpen, more }: ViewProps) {
	if (entries.length === 0) return <div class="empty">No files.</div>;

	return (
		<div class="file-grid">
			{entries.map((entry) => {
				const selected = selectedIds.includes(entry.id);
				const disabled = isDisabled(entry);
				return (
					<div key={entry.id} class="file-card">
						<div class="file-card-head">
							{/* Purely the selection hit-target - opening happens via the name below, so this never doubles as a button (the overlay input would swallow every click anyway).
							 * Thumbnail and checkbox both always sit in the DOM; CSS (`:hover`, `:checked`, `:has()`) drives which one shows. */}
							<div class="file-card-select">
								<img class="file-card-thumb" src={thumbnailUrl(entry)} alt="" width={40} height={40} />
								{!disabled && (
									<input
										type="checkbox"
										class="file-card-checkbox"
										checked={selected}
										aria-label={`Select ${entry.name}`}
										onChange={() => onToggle(entry)}
									/>
								)}
							</div>
							{more(entry)}
						</div>
						<button type="button" class="file-card-name" onClick={() => onOpen(entry)}>
							{entry.name}
						</button>
						<small class="muted">
							{formatBytes(entry.size)}
							{entry.kind === 'folder' ? ` · ${entry.fileCount ?? 0} files` : ''}
						</small>
					</div>
				);
			})}
		</div>
	);
}

// ----------------------------------------------------------- Selection bar

interface SelectionBarProps {
	count: number;
	multiple: boolean;
	allSelected: boolean;
	onSelectAll: () => void;
	onUnselectAll: () => void;
	onMove: () => void;
	onCopy: () => void;
	onDelete: () => void;
}

function SelectionBar({ count, multiple, allSelected, onSelectAll, onUnselectAll, onMove, onCopy, onDelete }: SelectionBarProps) {
	return (
		<div class="file-selection-bar">
			<div class="row">
				{multiple && (
					<button type="button" class="ghost sm" onClick={allSelected ? onUnselectAll : onSelectAll}>
						{allSelected ? 'Unselect all' : 'Select all'}
					</button>
				)}
				<strong>{count} selected</strong>
			</div>
			<div class="row">
				<button type="button" class="ghost icon sm" data-tooltip="Copy" aria-label="Copy selection" onClick={onCopy}>
					<CopyIcon />
				</button>
				<button type="button" class="ghost icon sm" data-tooltip="Move" aria-label="Move selection" onClick={onMove}>
					<MoveIcon />
				</button>
				<button type="button" class="icon sm destructive" data-tooltip="Delete" aria-label="Delete selection" onClick={onDelete}>
					<TrashIcon />
				</button>
			</div>
		</div>
	);
}

// ------------------------------------------------------------- Clipboard bar

interface ClipboardBarProps {
	mode: 'move' | 'copy';
	count: number;
	canPaste: boolean;
	onPaste: () => void;
	onCancel: () => void;
}

/** Shown after Move/Copy is picked from a row or the selection bar - browse to
 * the destination folder, then Paste there. Replaces a folder-tree dialog
 * with the cut/copy-then-paste flow users already know from a file explorer. */
function ClipboardBar({ mode, count, canPaste, onPaste, onCancel }: ClipboardBarProps) {
	return (
		<div class="file-selection-bar">
			<div class="row">
				<strong>
					{count} item{count === 1 ? '' : 's'} {mode === 'move' ? 'to move' : 'to copy'}
				</strong>
				{!canPaste && <small class="muted">Can't paste into this folder</small>}
			</div>
			<div class="row">
				<button type="button" class="ghost sm" onClick={onCancel}>
					Cancel
				</button>
				<button type="button" class="sm" disabled={!canPaste} onClick={onPaste}>
					<PasteIcon /> Paste here
				</button>
			</div>
		</div>
	);
}

// ------------------------------------------------------------ Rename dialog

function RenameDialog({ target, onClose, onSubmit }: { target: FileEntry | null; onClose: () => void; onSubmit: (name: string) => void }) {
	const ref = useDialogSync(target !== null, onClose);
	const [name, setName] = useState('');

	useEffect(() => {
		if (target) setName(target.name);
	}, [target]);

	return (
		<dialog ref={ref} aria-label="Rename">
			{target && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const trimmed = name.trim();
						if (trimmed) onSubmit(trimmed);
					}}
				>
					<header>
						<h3>Rename</h3>
					</header>
					<input type="text" value={name} onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)} />
					<footer>
						<button type="button" class="outline" onClick={onClose}>
							Cancel
						</button>
						<button type="submit">Save</button>
					</footer>
				</form>
			)}
		</dialog>
	);
}

// -------------------------------------------------------- New folder dialog

function NewFolderDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
	const ref = useDialogSync(open, onClose);
	const [name, setName] = useState('');

	useEffect(() => {
		if (open) setName('');
	}, [open]);

	return (
		<dialog ref={ref} aria-label="New folder">
			{open && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const trimmed = name.trim();
						if (trimmed) onSubmit(trimmed);
					}}
				>
					<header>
						<h3>New folder</h3>
					</header>
					<input
						type="text"
						placeholder="Folder name"
						value={name}
						onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
					/>
					<footer>
						<button type="button" class="outline" onClick={onClose}>
							Cancel
						</button>
						<button type="submit" disabled={!name.trim()}>
							Create
						</button>
					</footer>
				</form>
			)}
		</dialog>
	);
}

// -------------------------------------------------------------- Upload dialog

function UploadDialog({
	open,
	folderPathLabel,
	onClose,
	onSubmit,
}: {
	open: boolean;
	folderPathLabel: string;
	onClose: () => void;
	onSubmit: (files: File[]) => void;
}) {
	const ref = useDialogSync(open, onClose);
	const [files, setFiles] = useState<File[]>([]);
	const [dragOver, setDragOver] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) setFiles([]);
	}, [open]);

	const addFiles = (list: FileList | null) => {
		if (!list || list.length === 0) return;
		setFiles((current) => [...current, ...Array.from(list)]);
	};

	return (
		<dialog ref={ref} class="file-dialog file-upload-dialog" aria-label="Upload files">
			{open && (
				<>
					<header>
						<h3>Upload files</h3>
						<p>
							Uploading to <strong>{folderPathLabel}</strong>
						</p>
					</header>

					<div
						class={dragOver ? 'upload-dropzone dragging' : 'upload-dropzone'}
						onDragOver={(event) => {
							event.preventDefault();
							setDragOver(true);
						}}
						onDragLeave={() => setDragOver(false)}
						onDrop={(event) => {
							event.preventDefault();
							setDragOver(false);
							addFiles((event as unknown as DragEvent).dataTransfer?.files ?? null);
						}}
					>
						<FileManagerUploadArtwork />
						<strong>Drop or select files</strong>
						<p>
							Drag files here, or{' '}
							<button type="button" class="link" onClick={() => inputRef.current?.click()}>
								browse
							</button>{' '}
							your device.
						</p>
						<input
							ref={inputRef}
							type="file"
							multiple
							hidden
							onChange={(event) => {
								addFiles((event.currentTarget as HTMLInputElement).files);
								(event.currentTarget as HTMLInputElement).value = '';
							}}
						/>
					</div>

					{files.length > 0 && (
						<ul class="upload-file-list">
							{files.map((file, index) => (
								<li key={`${file.name}-${index}`}>
									<span>{file.name}</span>
									<small class="muted">{formatBytes(file.size)}</small>
									<button
										type="button"
										class="ghost icon sm"
										data-tooltip="Remove"
										aria-label={`Remove ${file.name}`}
										onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
									>
										<XIcon />
									</button>
								</li>
							))}
						</ul>
					)}

					<footer>
						<button type="button" class="outline" onClick={onClose}>
							Cancel
						</button>
						<button type="button" disabled={files.length === 0} onClick={() => onSubmit(files)}>
							Upload{files.length > 0 ? ` (${files.length})` : ''}
						</button>
					</footer>
				</>
			)}
		</dialog>
	);
}

// ---------------------------------------------------------------- Preview

interface PreviewDialogProps {
	entry: FileEntry | null;
	scope: FileEntry[];
	onClose: () => void;
	onNavigate: (id: string) => void;
	onMove: (ids: string[]) => void;
	onCopy: (ids: string[]) => void;
	onRename: (id: string) => void;
	onReplace: (id: string) => void;
	onDelete: (ids: string[]) => void;
}

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;

function PreviewDialog({ entry, scope, onClose, onNavigate, onMove, onCopy, onRename, onReplace, onDelete }: PreviewDialogProps) {
	const ref = useDialogSync(entry !== null, onClose);
	const index = entry ? scope.findIndex((item) => item.id === entry.id) : -1;
	const [direction, setDirection] = useState<'prev' | 'next'>('next');
	const [zoom, setZoom] = useState(100);
	const canLoop = scope.length > 1;
	const image = entry !== null && isImageEntry(entry) && !!entry.previewUrl;

	useEffect(() => {
		setZoom(100);
	}, [entry?.id]);

	const goPrev = () => {
		if (!canLoop || index < 0) return;
		setDirection('prev');
		onNavigate(scope[index === 0 ? scope.length - 1 : index - 1]!.id);
	};
	const goNext = () => {
		if (!canLoop || index < 0) return;
		setDirection('next');
		onNavigate(scope[index === scope.length - 1 ? 0 : index + 1]!.id);
	};

	useEffect(() => {
		if (!entry) return;
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft') goPrev();
			else if (event.key === 'ArrowRight') goNext();
		};
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entry, index, scope]);

	const zoomBy = (delta: number) => setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)));

	return (
		<dialog ref={ref} class="file-preview" aria-label="File preview">
			{entry && (
				<>
					<header class="file-preview-header">
						<span class="file-preview-name">{entry.name}</span>
						<div class="row">
							<MoreMenu
								label={entry.name}
								onMove={() => onMove([entry.id])}
								onCopy={() => onCopy([entry.id])}
								onRename={() => onRename(entry.id)}
								onReplace={() => onReplace(entry.id)}
								onDelete={() => onDelete([entry.id])}
							/>
							<button type="button" class="ghost icon sm" data-tooltip="Close" aria-label="Close preview" onClick={onClose}>
								<CloseIcon />
							</button>
						</div>
					</header>

					<div class="file-preview-body">
						<button
							type="button"
							class="file-preview-nav ghost icon lg prev"
							data-tooltip="Previous"
							aria-label="Previous file"
							disabled={!canLoop}
							onClick={goPrev}
						>
							<ArrowLeftIcon />
						</button>

						<div
							class="file-preview-stage"
							onWheel={
								image
									? (event) => {
											event.preventDefault();
											zoomBy(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
										}
									: undefined
							}
						>
							<div key={entry.id} class={direction === 'prev' ? 'file-preview-slide from-left' : 'file-preview-slide from-right'}>
								{image ? (
									<img
										src={entry.previewUrl}
										alt={entry.name}
										class="file-preview-image"
										style={{ transform: `scale(${zoom / 100})` }}
									/>
								) : (
									<div class="file-preview-card">
										<img src={thumbnailUrl(entry)} alt="" width={64} height={64} />
										<dl class="file-preview-rows">
											<div class="file-preview-row">
												<dt>Name</dt>
												<dd>{entry.name}</dd>
											</div>
											<div class="file-preview-row">
												<dt>Size</dt>
												<dd>{formatBytes(entry.size)}</dd>
											</div>
											<div class="file-preview-row">
												<dt>Modified</dt>
												<dd>{formatDate(entry.modifiedAt).date}</dd>
											</div>
											<div class="file-preview-row">
												<dt>Type</dt>
												<dd>{entry.kind === 'folder' ? 'folder' : entry.ext ?? 'file'}</dd>
											</div>
										</dl>
									</div>
								)}
							</div>
						</div>

						<button
							type="button"
							class="file-preview-nav ghost icon lg next"
							data-tooltip="Next"
							aria-label="Next file"
							disabled={!canLoop}
							onClick={goNext}
						>
							<ArrowRightIcon />
						</button>
					</div>

					{image && (
						<div class="file-preview-zoom">
							<button type="button" class="ghost icon sm" data-tooltip="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)}>
								<MinusIcon />
							</button>
							<input
								type="text"
								inputMode="numeric"
								class="file-preview-zoom-input"
								aria-label="Zoom level"
								value={`${zoom}%`}
								onInput={(event) => {
									const digits = (event.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '');
									if (digits) setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(digits))));
								}}
							/>
							<button type="button" class="ghost icon sm" data-tooltip="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
								<PlusIcon />
							</button>
						</div>
					)}

					{scope.length > 1 && (
						<div class="file-preview-filmstrip" role="listbox" aria-label="Files in this folder">
							{scope.map((item) => (
								<button
									key={item.id}
									type="button"
									class={item.id === entry.id ? 'file-preview-filmstrip-item active' : 'file-preview-filmstrip-item'}
									aria-selected={item.id === entry.id}
									onClick={() => onNavigate(item.id)}
								>
									<img src={item.previewUrl ?? thumbnailUrl(item)} alt={item.name} width={40} height={40} />
								</button>
							))}
						</div>
					)}
				</>
			)}
		</dialog>
	);
}

// ---------------------------------------------------------------- Main

/**
 * Self-contained mock file manager: a browsable list/grid over `data`, with
 * move/copy/delete/rename/replace/upload applied to a local copy (the
 * `data` prop is never mutated). Also doubles as a file *picker* - the same
 * checkbox/radio selection that drives the bulk-action Snackbar is reported
 * through `value`/`onChange`, so dropping this inside a host dialog is
 * enough to let it pick file(s) for some other field.
 */
export default function FileManager({ data, value, onChange, multiple = true, accept, defaultView = 'list' }: FileManagerProps) {
	const [entries, setEntries] = useState<FileEntry[]>(data);
	const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
	const [view, setView] = useState<'list' | 'grid'>(defaultView);
	const [query, setQuery] = useState('');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
	const [uncontrolledSelected, setUncontrolledSelected] = useState<string[]>([]);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [renameId, setRenameId] = useState<string | null>(null);
	const [clipboard, setClipboard] = useState<MoveCopyState>(null);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [newFolderOpen, setNewFolderOpen] = useState(false);

	const selectedIds = value === undefined ? uncontrolledSelected : Array.isArray(value) ? value : value ? [value] : [];

	const setSelection = (ids: string[]) => {
		if (value === undefined) setUncontrolledSelected(ids);
		onChange?.(multiple ? ids : (ids[0] ?? ''));
	};

	const scoped = useMemo(
		() => entries.filter((entry) => entry.parentId === currentFolderId && !isHiddenEntry(entry)),
		[entries, currentFolderId],
	);
	const searched = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle ? scoped.filter((entry) => entry.name.toLowerCase().includes(needle)) : scoped;
	}, [scoped, query]);
	const visible = useMemo(() => sortEntries(searched, sortDir), [searched, sortDir]);
	const breadcrumb = useMemo(() => folderPath(entries, currentFolderId), [entries, currentFolderId]);

	const isDisabled = (entry: FileEntry) => !isAccepted(entry, accept);
	const selectableVisible = visible.filter((entry) => !isDisabled(entry));
	const allSelected = selectableVisible.length > 0 && selectableVisible.every((entry) => selectedIds.includes(entry.id));
	const toggleAll = () => setSelection(allSelected ? [] : selectableVisible.map((entry) => entry.id));

	const toggleSelect = (entry: FileEntry) => {
		if (isDisabled(entry)) return;
		const isSelected = selectedIds.includes(entry.id);
		if (multiple) setSelection(isSelected ? selectedIds.filter((id) => id !== entry.id) : [...selectedIds, entry.id]);
		else setSelection(isSelected ? [] : [entry.id]);
	};

	const openEntry = (entry: FileEntry) => {
		if (entry.kind === 'folder') {
			setCurrentFolderId(entry.id);
			setQuery('');
		} else {
			setPreviewId(entry.id);
		}
	};

	const navigateBreadcrumb = (id: string | null) => {
		setCurrentFolderId(id);
		setQuery('');
	};

	const deleteEntries = (ids: string[]) => {
		const toRemove = new Set<string>();
		for (const id of ids) for (const descendant of collectDescendantIds(entries, id)) toRemove.add(descendant);
		setEntries((current) => current.filter((entry) => !toRemove.has(entry.id)));
		setSelection(selectedIds.filter((id) => !toRemove.has(id)));
		if (previewId && toRemove.has(previewId)) setPreviewId(null);
		toast.add({ title: `Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, type: 'success' });
	};

	/* Clears the current selection so the (also sticky, bottom-of-screen)
	 * selection bar hands off to the clipboard bar instead of stacking with it. */
	const requestMove = (ids: string[]) => {
		setClipboard({ mode: 'move', ids });
		setSelection([]);
		toast.add({ title: `${ids.length} item${ids.length === 1 ? '' : 's'} ready to paste`, type: 'info' });
	};
	const requestCopy = (ids: string[]) => {
		setClipboard({ mode: 'copy', ids });
		setSelection([]);
		toast.add({ title: `${ids.length} item${ids.length === 1 ? '' : 's'} ready to paste`, type: 'info' });
	};

	/** Self + every descendant of each clipboard item - can't paste a folder into itself or its own subtree. */
	const clipboardBlocked = useMemo(() => {
		const set = new Set<string>();
		if (!clipboard) return set;
		for (const id of clipboard.ids) for (const descendant of collectDescendantIds(entries, id)) set.add(descendant);
		return set;
	}, [clipboard, entries]);
	const canPaste = clipboard !== null && (currentFolderId === null || !clipboardBlocked.has(currentFolderId));

	const pasteClipboard = () => {
		if (!clipboard || !canPaste) return;
		const { mode, ids } = clipboard;
		const targetId = currentFolderId;
		if (mode === 'move') {
			setEntries((current) => current.map((entry) => (ids.includes(entry.id) ? { ...entry, parentId: targetId } : entry)));
			toast.add({ title: `Moved ${ids.length} item${ids.length === 1 ? '' : 's'}`, type: 'success' });
		} else {
			setEntries((current) => {
				const additions: FileEntry[] = [];
				const cloneTree = (id: string, newParentId: string | null, isTop: boolean) => {
					const source = current.find((entry) => entry.id === id);
					if (!source) return;
					const newId = `copy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
					additions.push({ ...source, id: newId, parentId: newParentId, name: isTop ? `${source.name} copy` : source.name });
					if (source.kind === 'folder') {
						for (const child of current.filter((entry) => entry.parentId === id)) cloneTree(child.id, newId, false);
					}
				};
				for (const id of ids) cloneTree(id, targetId, true);
				return [...current, ...additions];
			});
			toast.add({ title: `Copied ${ids.length} item${ids.length === 1 ? '' : 's'}`, type: 'success' });
		}
		setSelection([]);
		setClipboard(null);
	};

	const renameTargetEntry = renameId ? (entries.find((entry) => entry.id === renameId) ?? null) : null;
	const submitRename = (name: string) => {
		if (!renameId) return;
		setEntries((current) =>
			current.map((entry) =>
				entry.id === renameId ? { ...entry, name, ext: entry.kind === 'file' && name.includes('.') ? name.split('.').pop() : entry.ext } : entry,
			),
		);
		setRenameId(null);
	};

	const replaceInputRef = useRef<HTMLInputElement>(null);
	const replaceTargetId = useRef<string | null>(null);
	const requestReplace = (id: string) => {
		replaceTargetId.current = id;
		replaceInputRef.current?.click();
	};
	const handleReplaceFile = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		const id = replaceTargetId.current;
		input.value = '';
		if (!file || !id) return;
		setEntries((current) =>
			current.map((entry) =>
				entry.id === id
					? {
							...entry,
							size: file.size,
							modifiedAt: new Date().toISOString(),
							previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : entry.previewUrl,
						}
					: entry,
			),
		);
		toast.add({ title: 'File replaced', type: 'success' });
	};

	const submitUpload = (files: File[]) => {
		const additions: FileEntry[] = files.map((file) => ({
			id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: file.name,
			parentId: currentFolderId,
			kind: 'file',
			ext: file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : undefined,
			size: file.size,
			modifiedAt: new Date().toISOString(),
			previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
		}));
		setEntries((current) => [...current, ...additions]);
		setUploadOpen(false);
		toast.add({ title: `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`, type: 'success' });
	};

	/** New folders get a hidden `.tmp` child - see `isHiddenEntry` - so they're
	 * never actually "empty" underneath, matching how the real (R2) backend
	 * this mock stands in for has to represent an empty folder. */
	const createFolder = (name: string) => {
		const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const now = new Date().toISOString();
		setEntries((current) => [
			...current,
			{ id, name, parentId: currentFolderId, kind: 'folder', size: 0, fileCount: 0, modifiedAt: now },
			{ id: `${id}-tmp`, name: '.tmp', parentId: id, kind: 'file', size: 0, modifiedAt: now },
		]);
		setNewFolderOpen(false);
		toast.add({ title: `Created folder "${name}"`, type: 'success' });
	};

	const previewEntry = previewId ? (entries.find((entry) => entry.id === previewId) ?? null) : null;
	const previewScope = useMemo(() => visible.filter((entry) => entry.kind === 'file'), [visible]);
	const currentPathLabel = breadcrumb.length === 0 ? '/' : `/${breadcrumb.map((entry) => entry.name).join('/')}`;

	const renderMore = (entry: FileEntry) => (
		<MoreMenu
			label={entry.name}
			onMove={() => requestMove([entry.id])}
			onCopy={() => requestCopy([entry.id])}
			onRename={() => setRenameId(entry.id)}
			onReplace={() => requestReplace(entry.id)}
			onDelete={() => deleteEntries([entry.id])}
		/>
	);

	return (
		<div class="file-manager">
			<input ref={replaceInputRef} type="file" hidden onChange={handleReplaceFile} />

			<Breadcrumb chain={breadcrumb} onNavigate={navigateBreadcrumb} />
			<Toolbar
				query={query}
				onQuery={setQuery}
				view={view}
				onView={setView}
				onNewFolder={() => setNewFolderOpen(true)}
				onUpload={() => setUploadOpen(true)}
			/>

			{selectedIds.length > 0 && (
				<SelectionBar
					count={selectedIds.length}
					multiple={multiple}
					allSelected={allSelected}
					onSelectAll={() => setSelection(selectableVisible.map((entry) => entry.id))}
					onUnselectAll={() => setSelection([])}
					onMove={() => requestMove(selectedIds)}
					onCopy={() => requestCopy(selectedIds)}
					onDelete={() => deleteEntries(selectedIds)}
				/>
			)}

			{clipboard && (
				<ClipboardBar
					mode={clipboard.mode}
					count={clipboard.ids.length}
					canPaste={canPaste}
					onPaste={pasteClipboard}
					onCancel={() => setClipboard(null)}
				/>
			)}

			{view === 'list' ? (
				<ListView
					entries={visible}
					selectedIds={selectedIds}
					isDisabled={isDisabled}
					sortDir={sortDir}
					onSort={() => setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))}
					onToggle={toggleSelect}
					onOpen={openEntry}
					more={renderMore}
					multiple={multiple}
					allSelected={allSelected}
					onToggleAll={toggleAll}
				/>
			) : (
				<GridView entries={visible} selectedIds={selectedIds} isDisabled={isDisabled} onToggle={toggleSelect} onOpen={openEntry} more={renderMore} />
			)}

			<RenameDialog target={renameTargetEntry} onClose={() => setRenameId(null)} onSubmit={submitRename} />
			<NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} onSubmit={createFolder} />
			<UploadDialog open={uploadOpen} folderPathLabel={currentPathLabel} onClose={() => setUploadOpen(false)} onSubmit={submitUpload} />
			<PreviewDialog
				entry={previewEntry}
				scope={previewScope}
				onClose={() => setPreviewId(null)}
				onNavigate={setPreviewId}
				onMove={requestMove}
				onCopy={requestCopy}
				onRename={(id) => setRenameId(id)}
				onReplace={requestReplace}
				onDelete={deleteEntries}
			/>
		</div>
	);
}
