/**
 * Global theme (system/light/dark) behaviour - plain DOM/TS, no framework
 * involved. Importing this module is enough to activate it; it wires itself
 * up once on import.
 *
 * Applies the `light`/`dark` class to the nearest `.dry` root (or `<body>`)
 * and persists the choice to the same `drycms:store` `localStorage` entry
 * `useStore("theme", ...)` reads/writes (see `ThemeToggle`, the Preact
 * island version of this control) - so a page mixing both stays in sync
 * either way. The pre-mount flash is avoided separately, by `app.astro`'s
 * inline script reading the same storage before first paint.
 *
 * Any `[data-theme-toggle]` element cycles system -> light -> dark on click
 * - for pages with no Preact at all. `ThemeToggle` itself intentionally
 * doesn't carry that attribute: it already cycles via its own `onClick`, and
 * both firing on the same click would cycle twice.
 */

export type DryTheme = 'system' | 'light' | 'dark';

const ORDER: DryTheme[] = ['system', 'light', 'dark'];

// Mirrors `useStore.ts`'s STORAGE_KEY / object-of-keys format, duplicated
// as a literal (rather than imported) so this module stays framework-free.
const STORAGE_KEY = 'drycms:store';

function readStore(): Record<string, unknown> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function writeStore(store: Record<string, unknown>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
		// Private mode / storage disabled - theme still applies for this load.
	}
}

export function readStoredTheme(): DryTheme {
	const value = readStore().theme;
	return value === 'light' || value === 'dark' ? value : 'system';
}

function writeStoredTheme(theme: DryTheme) {
	writeStore({ ...readStore(), theme });
}

/** Applies `theme` to the DOM. Doesn't touch storage - callers that need it
 * persisted (the delegated click handler below, `ThemeToggle`) do that
 * themselves. */
export function applyTheme(theme: DryTheme) {
	const root = document.querySelector<HTMLElement>('.dry') ?? document.body;
	root.classList.remove('light', 'dark');
	if (theme !== 'system') root.classList.add(theme);
}

function initThemeToggle() {
	if (document.body.dataset.dryThemeInit) return;
	document.body.dataset.dryThemeInit = 'true';

	const onClick = (event: MouseEvent) => {
		const trigger = (event.target as HTMLElement).closest?.('[data-theme-toggle]');
		if (!trigger) return;
		const next = ORDER[(ORDER.indexOf(readStoredTheme()) + 1) % ORDER.length] as DryTheme;
		writeStoredTheme(next);
		applyTheme(next);
	};

	document.addEventListener('click', onClick);
}

if (typeof document !== 'undefined') initThemeToggle();
