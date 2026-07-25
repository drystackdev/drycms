import { useEffect, useMemo } from 'preact/hooks';
import { path } from 'virtual:drycms/config';
import FileManager from '../components/FileManager.js';
import { createHttpFileSource } from '../components/file-manager-http-source.js';

export default function Media() {
	useEffect(() => {
		document.title = 'Media';
	}, []);

	// Stable across re-renders - a fresh source would drop FileManager's
	// already-loaded folders and force a re-fetch of whatever's open.
	const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);

	return (
		<>
			<div class="page-header">
				<div>
					<h1>Media</h1>
					<p>Browse, upload, and organize the files stored under <code>storage/</code>.</p>
				</div>
			</div>

			<FileManager source={source} />
		</>
	);
}
