import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { OverlayScrollbars } from 'overlayscrollbars';
import type { PartialOptions } from 'overlayscrollbars';

export interface OverlayScrollbarsHandle<T extends HTMLElement> {
	ref: RefObject<T>;
	/** Scrolls the OverlayScrollbars-managed viewport back to the top. */
	scrollToTop: () => void;
	/** Scrolls the OverlayScrollbars-managed viewport to its newest content.
	 * `behavior` defaults to `"auto"` (instant) - pass `"smooth"` for a
	 * deliberate user-triggered jump (e.g. a "new messages" chip), and leave
	 * it `"auto"` for a "stick to bottom while streaming" tick, where a
	 * smooth animation re-triggering on every delta would fight itself. */
	scrollToBottom: (options?: { behavior?: ScrollBehavior }) => void;
	/** Whether the viewport is within `px` of its own bottom right now - the
	 * "should an incoming message auto-scroll, or has the reader scrolled up
	 * to read something older" check (`status/magic-chat.md`'s "auto-scroll
	 * dính đáy"). `false` before the instance has mounted. */
	isNearBottom: (px?: number) => boolean;
	/** The real scrolling element OverlayScrollbars generates (see this
	 * function's own doc comment on `.os-viewport`) - an escape hatch for a
	 * caller that needs to attach its own `scroll` listener (e.g. to notice
	 * the reader scrolling away from the bottom themselves) rather than just
	 * read/set position through the methods above. `undefined` before the
	 * instance has mounted. */
	viewport: () => HTMLElement | undefined;
}

const defaultOptions: PartialOptions = {
	scrollbars: {
		theme: 'os-theme-dry',
		autoHide: 'move',
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
		scrollToBottom: ({ behavior = "auto" }: { behavior?: ScrollBehavior } = {}) => {
			const viewport = instance.current?.elements().viewport;
			if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior });
		},
		isNearBottom: (px = 48) => {
			const viewport = instance.current?.elements().viewport;
			if (!viewport) return false;
			return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= px;
		},
		viewport: () => instance.current?.elements().viewport,
	};
}
