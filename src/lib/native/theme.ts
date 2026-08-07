/**
 * Global theme (system/light/dark) behaviour - plain DOM/TS, no framework
 * involved. Importing this module is enough to activate it; it wires itself
 * up once on import.
 *
 * Applies the `light`/`dark` class to the nearest `.dry` root (or `<body>`)
 * and persists the choice to the same `drycms:store` `localStorage` entry
 * `useStore("theme", ...)` reads/writes (see `ThemeToggle`, the Preact
 * island version of this control) - so a page mixing both stays in sync
 * either way. The pre-mount flash is avoided separately, by `index.html`'s
 * own inline script reading the same storage before first paint.
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

/** Same effect as `applyTheme`, wrapped in the View Transitions API for a
 * circular-reveal transition ("vòng tròn phóng ra") growing from `origin` -
 * the actual click/tap point (see `clickOrigin` below), so the circle
 * starts exactly where the user's finger/cursor was, not just somewhere on
 * the toggle - see `base.css`'s `::view-transition-*` rules for the actual
 * animation, `--dry-theme-transition-*` here is just the geometry those
 * read. Pure progressive enhancement: unsupported browsers (no Chromium)
 * and a `prefers-reduced-motion: reduce` visitor both fall straight through
 * to the instant `applyTheme`, exactly like before this existed - the
 * circle is a bonus, never a requirement for the theme to actually
 * change. */
export function applyThemeTransition(theme: DryTheme, origin: { x: number; y: number }) {
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (!document.startViewTransition || reducedMotion) {
		applyTheme(theme);
		return;
	}

	const radius = Math.hypot(
		Math.max(origin.x, window.innerWidth - origin.x),
		Math.max(origin.y, window.innerHeight - origin.y),
	);
	const root = document.documentElement;
	root.style.setProperty('--dry-theme-transition-x', `${origin.x}px`);
	root.style.setProperty('--dry-theme-transition-y', `${origin.y}px`);
	root.style.setProperty('--dry-theme-transition-radius', `${radius}px`);

	document.startViewTransition(() => {
		applyTheme(theme);
	});
}

/** Center of `element`'s own box - fallback origin for a keyboard-activated
 * click (Enter/Space on a focused button), whose synthetic `MouseEvent`
 * carries `clientX`/`clientY` both `0` rather than a real pointer
 * position. */
function elementCenter(element: Element): { x: number; y: number } {
	const rect = element.getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** The real click/tap point from `event`, or `elementCenter(fallback)` for
 * a keyboard activation (see that function's own doc comment) - `0, 0` is
 * never a legitimate click position for a control that isn't already
 * pinned to the viewport's top-left corner. */
export function clickOrigin(event: MouseEvent, fallback: Element): { x: number; y: number } {
	if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
	return elementCenter(fallback);
}

function initThemeToggle() {
	if (document.body.dataset.dryThemeInit) return;
	document.body.dataset.dryThemeInit = 'true';

	const onClick = (event: MouseEvent) => {
		const trigger = (event.target as HTMLElement).closest?.('[data-theme-toggle]');
		if (!trigger) return;
		const next = ORDER[(ORDER.indexOf(readStoredTheme()) + 1) % ORDER.length] as DryTheme;
		writeStoredTheme(next);
		applyThemeTransition(next, clickOrigin(event, trigger));
	};

	document.addEventListener('click', onClick);
}

if (typeof document !== 'undefined') initThemeToggle();
