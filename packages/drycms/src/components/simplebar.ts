import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import SimpleBar from 'simplebar';

type SimpleBarInstance = InstanceType<typeof SimpleBar>;

export interface SimpleBarHandle<T extends HTMLElement> {
	ref: RefObject<T>;
	/** Scrolls the SimpleBar-managed scroll area back to the top. */
	scrollToTop: () => void;
}

/**
 * Mounts a SimpleBar instance on the ref'd element and tears it down on
 * unmount. Used instead of SimpleBar's global `data-simplebar` auto-init,
 * which only scans the DOM present at `DOMContentLoaded` and can't be relied
 * on for elements a Preact render mounts later.
 *
 * `deps` defaults to `[]` (mount once, for elements present from first
 * render, e.g. `DryLayout`'s sidebar/main). Pass e.g. `[open]` for an element
 * that's conditionally rendered later - the ref is still null on first
 * mount, so the effect needs to re-run once that condition flips.
 */
export function useSimpleBar<T extends HTMLElement>(deps: unknown[] = []): SimpleBarHandle<T> {
	const ref = useRef<T>(null);
	const instance = useRef<SimpleBarInstance | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		instance.current = new SimpleBar(el);
		return () => {
			instance.current?.unMount();
			instance.current = null;
		};
	}, deps);

	return {
		ref,
		scrollToTop: () => instance.current?.getScrollElement()?.scrollTo({ top: 0 }),
	};
}
