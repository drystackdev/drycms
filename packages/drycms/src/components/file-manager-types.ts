export type FileKind = 'folder' | 'file';

export interface FileEntry {
	id: string;
	name: string;
	/** `null` = root. */
	parentId: string | null;
	kind: FileKind;
	/** File extension (no dot), lower-case. Folders don't have one. */
	ext?: string;
	/** Bytes. For folders this is a mock aggregate size (shown alongside `fileCount`). */
	size?: number;
	modifiedAt: string;
	/** Folders only: shown next to their size, e.g. "1.12 Gb · 200 files". */
	fileCount?: number;
	/** Object URL for files uploaded this session (real `File` blob) - lets the preview show the actual image instead of a placeholder. */
	previewUrl?: string;
}
