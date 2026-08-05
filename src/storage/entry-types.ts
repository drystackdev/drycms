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
	/** Absent when the backend didn't resolve it cheaply. */
	modifiedAt?: string;
	/** Folders only: shown next to their size, e.g. "1.12 Gb · 200 files". */
	fileCount?: number;
	/** Object URL for files uploaded this session (real `File` blob) - lets the preview show the actual image instead of a placeholder. */
	previewUrl?: string;
	/** Files only, and only on content-addressed backends (see
	 * `StorageStatEntry.contentHash`) - lets the preview dialog cache the
	 * actual bytes by content instead of path (see `file-manager-blob-cache.ts`). */
	contentHash?: string;
}

/**
 * Where `FileManager` gets its data and sends its writes. `list` is the only
 * required method (a read-only source is legal); every other method's
 * absence hides/disables its matching UI action, the same way `onReplace` is
 * already conditionally omitted for folders today.
 *
 * `id`/`parentId` on returned entries are expected to be real paths (see
 * `createHttpFileSource`/`createMemoryFileSource`), so a `move`/`copy`/
 * `rename` can hand back an entry with a *different* `id` than the one that
 * was acted on - `FileManager` re-lists rather than patching state in place.
 */
export interface FileManagerSource {
	list(folderId: string | null): Promise<FileEntry[]>;
	/** Every entry at every depth, flattened, in one call - lets `FileManager`
	 * prefetch the whole tree once on mount instead of a `list()` per folder as
	 * the user navigates. Optional at the type level for sources that never
	 * support it; when present, a resolved `null` is a *runtime* "actually not
	 * supported for this backend" signal (see `createHttpFileSource` - the
	 * configured storage kind might not implement `StorageAdapter.listAll`,
	 * e.g. future R2/S3), telling `FileManager` to fall back to its existing
	 * lazy per-folder `list()` instead. */
	listAll?(): Promise<FileEntry[] | null>;
	upload?(folderId: string | null, files: File[]): Promise<FileEntry[]>;
	createFolder?(folderId: string | null, name: string): Promise<FileEntry>;
	move?(ids: string[], targetFolderId: string | null): Promise<FileEntry[]>;
	copy?(ids: string[], targetFolderId: string | null): Promise<FileEntry[]>;
	remove?(ids: string[]): Promise<void>;
	rename?(id: string, name: string): Promise<FileEntry>;
	replace?(id: string, file: File): Promise<FileEntry>;
}
