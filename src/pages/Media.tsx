import { useMemo } from 'preact/hooks';
const { path } = window.__DRY_CONFIG__;
import FileManager from '../components/FileManager/FileManager.js';
import { createHttpFileSource } from '../storage/http-source.js';
import { useDocumentTitle } from './page-common.js';

export default function Media() {
	useDocumentTitle('Media');

	// Stable across re-renders - a fresh source would drop FileManager's
	// already-loaded folders and force a re-fetch of whatever's open.
	const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);

	// Open to any authenticated session, no separate permission - the
	// underlying `storage` API is already shared infrastructure every
	// File/Image field reads/writes through, not just this page.
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
