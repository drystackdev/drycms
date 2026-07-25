import type { FileEntry } from './file-manager-types.js';

/** The 12 thumbnail categories the CDN serves an `ic-*.svg` for. */
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

const THUMB_BASE = 'https://pub-c5e31b5cdafb419fb247a8ac2e78df7a.r2.dev/public/assets/icons/files';

/** Category -> CDN filename stem (differs from the category name in a few spots). */
const THUMB_FILE: Record<FileThumbCategory, string> = {
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
	return `${THUMB_BASE}/${THUMB_FILE[category]}.svg`;
}

export function isImageEntry(entry: FileEntry): boolean {
	return entry.kind === 'file' && extensionToCategory(entry.ext) === 'image';
}

/** `.tmp` is a placeholder file dropped into every newly-created folder (object
 * storage like R2 has no such thing as an empty "directory" - a prefix only
 * exists once something is stored under it). Never shown in the UI. */
export function isHiddenEntry(entry: FileEntry): boolean {
	return entry.kind === 'file' && entry.name === '.tmp';
}

export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return '';
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;
	return `${exponent === 0 ? value : value.toFixed(2)} ${units[exponent]}`;
}

export function formatDate(iso: string): { date: string; time: string } {
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
