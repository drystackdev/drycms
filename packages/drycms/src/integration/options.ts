export interface DryOption {
	/**
	 * Base path the drycms admin UI is mounted on.
	 * Visiting it redirects to `${path}/dashboard`.
	 *
	 * @default "/dry"
	 */
	path?: string;
}

export interface ResolvedDryOption {
	/** Normalized base path, always leading slash and never trailing slash. */
	path: string;
	/** `${path}/dashboard` — the landing route of the admin UI. */
	dashboardPath: string;
	/** `${path}/showcase` — the component gallery. */
	showcasePath: string;
}

/** Routes injected by the integration, relative to the resolved base path. */
export const DRY_ROUTES = [
	{ segment: 'dashboard', entrypoint: 'drycms/routes/dashboard.astro' },
	{ segment: 'showcase', entrypoint: 'drycms/routes/showcase.astro' },
] as const;

export const DEFAULT_PATH = '/dry';

/**
 * Normalizes and validates user options. Throws on values that would produce a
 * broken route so the failure surfaces at config time rather than at request time.
 */
export function resolveOptions(options: DryOption = {}): ResolvedDryOption {
	const raw = options.path ?? DEFAULT_PATH;

	if (typeof raw !== 'string') {
		throw new TypeError(`[drycms] \`path\` must be a string, received ${typeof raw}.`);
	}

	let path = raw.trim().replace(/\\/g, '/');
	if (!path.startsWith('/')) path = `/${path}`;
	path = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '');

	if (path === '') {
		throw new Error(
			'[drycms] `path` cannot be the site root ("/"), it would take over every route. Use something like "/dry".',
		);
	}
	if (/[[\]]/.test(path)) {
		throw new Error(`[drycms] \`path\` cannot contain route parameters, received "${raw}".`);
	}
	if (/[?#\s]/.test(path)) {
		throw new Error(`[drycms] \`path\` cannot contain "?", "#" or whitespace, received "${raw}".`);
	}

	return {
		path,
		dashboardPath: `${path}/dashboard`,
		showcasePath: `${path}/showcase`,
	};
}
