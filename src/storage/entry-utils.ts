import type { FileEntry, FileManagerSource } from './file-manager-types.js';
import { fileThumbnails, type FileThumbnailName } from './file-manager-thumbnails.js';

/** The 12 thumbnail categories with a bundled `ic-*.svg`. */
export type FileThumbCategory =
	| 'folder'
	| 'txt'
	| 'zip'
	| 'audio'
	| 'image'
	| 'video'
	| 'word'
	| 'excel'
	| 'powerpoint'
	| 'pdf'
	| 'photoshop'
	| 'illustrator';

/** Category -> `file-icons/` filename stem (differs from the category name in a few spots). */
const THUMB_FILE: Record<FileThumbCategory, FileThumbnailName> = {
	folder: 'ic-folder',
	txt: 'ic-txt',
	zip: 'ic-zip',
	audio: 'ic-audio',
	image: 'ic-img',
	video: 'ic-video',
	word: 'ic-word',
	excel: 'ic-excel',
	powerpoint: 'ic-power-point',
	pdf: 'ic-pdf',
	photoshop: 'ic-pts',
	illustrator: 'ic-ai',
};

const EXT_TO_CATEGORY: Record<string, FileThumbCategory> = {
	jpg: 'image',
	jpeg: 'image',
	png: 'image',
	gif: 'image',
	svg: 'image',
	webp: 'image',
	mp4: 'video',
	mov: 'video',
	avi: 'video',
	webm: 'video',
	mp3: 'audio',
	wav: 'audio',
	ogg: 'audio',
	doc: 'word',
	docx: 'word',
	xls: 'excel',
	xlsx: 'excel',
	csv: 'excel',
	ppt: 'powerpoint',
	pptx: 'powerpoint',
	pdf: 'pdf',
	zip: 'zip',
	rar: 'zip',
	'7z': 'zip',
	psd: 'photoshop',
	ai: 'illustrator',
	txt: 'txt',
	md: 'txt',
};

export function extensionToCategory(ext: string | undefined): FileThumbCategory {
	if (!ext) return 'txt';
	return EXT_TO_CATEGORY[ext.toLowerCase()] ?? 'txt';
}

export function thumbnailUrl(entry: FileEntry): string {
	const category = entry.kind === 'folder' ? 'folder' : extensionToCategory(entry.ext);
	return fileThumbnails[THUMB_FILE[category]];
}

export function isImageEntry(entry: FileEntry): boolean {
	return entry.kind === 'file' && extensionToCategory(entry.ext) === 'image';
}

/** `.dir` is a placeholder file dropped into every newly-created folder (object
 * storage like R2 has no such thing as an empty "directory" - a prefix only
 * exists once something is stored under it). Never shown in the UI. */
export function isHiddenEntry(entry: FileEntry): boolean {
	return entry.kind === 'file' && entry.name === '.dir';
}

/** `id`s are paths (see `FileManagerSource`) - the folder containing one is
 * everything before its last `/`, root when there isn't one. Shared by
 * `ImageField` and `RichTextField`'s image-insert picker, both of which need
 * to re-scope a `FileManager` dialog to wherever a previously-picked id
 * actually lives. */
export function parentFolderOf(id: string): string | null {
	const slash = id.lastIndexOf('/');
	return slash === -1 ? null : id.slice(0, slash);
}

/** A picked id is either a `source` path (resolved through `resolveFileUrls`/
 * `FileManager`) or an already-absolute URL (typed into a picker's own
 * "Link" tab) - the two are told apart by shape alone, no separate flag
 * (same convention `ImageField`'s own `isLinkValue` uses). */
function isUrlId(id: string): boolean {
	return /^https?:\/\//i.test(id);
}

/**
 * Resolves a batch of `source` ids to their real, directly-usable URLs
 * (`FileEntry.previewUrl`) - for callers that need to persist a *self-
 * contained* value (no `source`/admin API available to resolve it back
 * later), unlike a content-type "image" column's stored id (resolved at
 * display time instead, e.g. `ContentEntryList.tsx`'s own `${path}/api/
 * storage/${id}` build). Same "listAll, else list the first id's folder"
 * lookup `ImageField`'s own thumbnail-resolving `useEffect` and `image-
 * insert-button.tsx`'s `confirm` each already inline - shared here so a
 * third copy doesn't join them. An id already shaped like an absolute URL
 * (a picker's own "Link" tab) passes through unchanged; a real id `list()`/
 * `listAll()` never turns up for (deleted out from under the picker, say)
 * falls back to the bare id rather than dropping it. */
export async function resolveFileUrls(source: FileManagerSource, ids: string[]): Promise<string[]> {
	const fileIds = ids.filter((id) => !isUrlId(id));
	if (fileIds.length === 0) return ids;
	const all = (await source.listAll?.()) ?? null;
	const list = all ?? (await source.list(parentFolderOf(fileIds[0]!)));
	const byId = new Map(list.map((entry) => [entry.id, entry] as const));
	return ids.map((id) => byId.get(id)?.previewUrl ?? id);
}

export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return '';
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;
	return `${exponent === 0 ? value : value.toFixed(2)} ${units[exponent]}`;
}

export function formatDate(iso: string | undefined): { date: string; time: string } {
	if (iso === undefined) return { date: '', time: '' };
	const d = new Date(iso);
	return {
		date: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
		time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
	};
}

/** Breadcrumb chain from root down to (and including) `folderId`. */
export function folderPath(entries: FileEntry[], folderId: string | null): FileEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const chain: FileEntry[] = [];
	let current = folderId ? byId.get(folderId) : undefined;
	while (current) {
		chain.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return chain;
}

/** Same comparison `sortEntries` uses for equality - locale-aware, case-insensitive,
 * so e.g. "Report.PDF" collides with "report.pdf". */
export function namesEqual(a: string, b: string): boolean {
	return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

/** Folders always sort before files; each group sorts by name (locale, case-insensitive). */
export function sortEntries(entries: FileEntry[], direction: 'asc' | 'desc' = 'asc'): FileEntry[] {
	const factor = direction === 'asc' ? 1 : -1;
	return [...entries].sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) * factor;
	});
}

export function isAccepted(entry: FileEntry, accept: string[] | undefined): boolean {
	if (entry.kind === 'folder') return true;
	if (!accept || accept.length === 0) return true;
	const ext = entry.ext?.toLowerCase();
	return !!ext && accept.map((a) => a.toLowerCase().replace(/^\./, '')).includes(ext);
}

/** `id` plus every entry nested under it (folders included, recursively). */
export function collectDescendantIds(entries: FileEntry[], id: string): Set<string> {
	const byParent = new Map<string | null, FileEntry[]>();
	for (const entry of entries) {
		const siblings = byParent.get(entry.parentId) ?? [];
		siblings.push(entry);
		byParent.set(entry.parentId, siblings);
	}
	const collected = new Set<string>([id]);
	const queue = [id];
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const child of byParent.get(current) ?? []) {
			if (collected.has(child.id)) continue;
			collected.add(child.id);
			queue.push(child.id);
		}
	}
	return collected;
}

/** Rewrites `id`'s subtree (itself included) as if it now lived under
 * `newParentId` with leaf name `newName` - every descendant's `id`/`parentId`
 * gets the same prefix swap (`id` is always a strict path prefix of its own
 * descendants' ids, by construction of `parentId` chains, so a plain slice is
 * safe - no need for a smarter path-segment join). Pure: returns a new array,
 * doesn't mutate `entries`. Used for `FileManager`'s optimistic move/rename
 * patches - applied *before* the server confirms, then overwritten by
 * whatever authoritative entry/entries the request actually resolves with. */
export function retargetSubtree(
	entries: FileEntry[],
	id: string,
	newParentId: string | null,
	newName: string,
): FileEntry[] {
	const source = entries.find((entry) => entry.id === id);
	if (!source) return entries;
	const newId = newParentId ? `${newParentId}/${newName}` : newName;
	if (newId === id) return entries;
	const descendantIds = collectDescendantIds(entries, id);
	const rewrite = (path: string) => newId + path.slice(id.length);
	return entries.map((entry) => {
		if (entry.id === id) return { ...entry, id: newId, parentId: newParentId, name: newName };
		if (!descendantIds.has(entry.id)) return entry;
		return {
			...entry,
			id: rewrite(entry.id),
			parentId: entry.parentId === id ? newId : rewrite(entry.parentId!),
		};
	});
}

export interface FolderNode {
	entry: FileEntry | null; // null = the synthetic root
	depth: number;
}

/** Every folder (root first), pre-order, indented by `depth` - for the move/copy destination picker. */
export function listFolders(entries: FileEntry[]): FolderNode[] {
	const byParent = new Map<string | null, FileEntry[]>();
	for (const entry of entries) {
		if (entry.kind !== 'folder') continue;
		const siblings = byParent.get(entry.parentId) ?? [];
		siblings.push(entry);
		byParent.set(entry.parentId, siblings);
	}
	const nodes: FolderNode[] = [{ entry: null, depth: 0 }];
	const walk = (parentId: string | null, depth: number) => {
		const children = sortEntries(byParent.get(parentId) ?? []);
		for (const child of children) {
			nodes.push({ entry: child, depth });
			walk(child.id, depth + 1);
		}
	};
	walk(null, 1);
	return nodes;
}
