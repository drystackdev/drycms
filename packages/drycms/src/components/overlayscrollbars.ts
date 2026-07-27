import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { OverlayScrollbars } from 'overlayscrollbars';
import type { PartialOptions } from 'overlayscrollbars';

export interface OverlayScrollbarsHandle<T extends HTMLElement> {
	ref: RefObject<T>;
	/** Scrolls the OverlayScrollbars-managed viewport back to the top. */
	scrollToTop: () => void;
}

const defaultOptions: PartialOptions = {
	scrollbars: {
		theme: 'os-theme-dry',
		autoHide: 'leave',
		autoHideDelay: 400,
	},
};

/**
 * Mounts an OverlayScrollbars instance on the ref'd element and tears it
 * down on unmount. Used instead of the library's `data-overlayscrollbars-initialize`
 * auto-init, which only scans the DOM present at `DOMContentLoaded` and can't
 * be relied on for elements a Preact render mounts later.
 *
 * `deps` defaults to `[]` (mount once, for elements present from first
 * render, e.g. `DryLayout`'s sidebar/main). Pass e.g. `[open]` for an element
 * that's conditionally rendered later - the ref is still null on first
 * mount, so the effect needs to re-run once that condition flips.
 *
 * Once initialized, the ref'd element becomes a non-scrolling "host" -
 * OverlayScrollbars moves the actual `overflow`/`scrollTop` onto an internal
 * `.os-viewport` child it generates, so code that needs to scroll the
 * element programmatically (rather than just render it) must go through
 * `scrollToTop()` instead of calling `.scrollTo()` on the ref directly.
 */
export function useOverlayScrollbars<T extends HTMLElement>(
	deps: unknown[] = [],
	options?: PartialOptions,
): OverlayScrollbarsHandle<T> {
	const ref = useRef<T>(null);
	const instance = useRef<OverlayScrollbars | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		instance.current = OverlayScrollbars(el, {
			...defaultOptions,
			...options,
			scrollbars: { ...defaultOptions.scrollbars, ...options?.scrollbars },
		});
		return () => {
			instance.current?.destroy();
			instance.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);

	return {
		ref,
		scrollToTop: () => instance.current?.elements().viewport.scrollTo({ top: 0 }),
	};
}
