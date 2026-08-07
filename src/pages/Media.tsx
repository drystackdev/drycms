import { useMemo } from 'preact/hooks';
const { path } = window.__DRY_CONFIG__;
import FileManager from '../components/FileManager/FileManager.js';
import { createHttpFileSource } from '../storage/http-source.js';
import { MEDIA_RESOURCE_ID } from '../content-types/permissions.js';
import { canAccess } from '../store/auth.js';
import { useDocumentTitle } from './page-common.js';

export default function Media() {
	useDocumentTitle('Media');

	// Stable across re-renders - a fresh source would drop FileManager's
	// already-loaded folders and force a re-fetch of whatever's open.
	const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);

	// Client-side only - the underlying `storage` API stays open to any
	// authenticated session (it's shared infrastructure every File/Image
	// field reads/writes through, not just this page), see
	// `permissions.ts`'s `MEDIA_RESOURCE_ID` doc comment.
	if (!canAccess(MEDIA_RESOURCE_ID, 'setting')) {
		return <span class="error">You don't have permission to access Media.</span>;
	}

	return (
		<div class="card">
			<div class="page-header">
				<div>
					<h1>Media</h1>
					<p>Browse, upload, and organize the files stored under <code>storage/</code>.</p>
				</div>
			</div>

			<div class="under" style={{paddingTop: '1rem'}}>
				<FileManager source={source} />
			</div>
		</div>
	);
}
