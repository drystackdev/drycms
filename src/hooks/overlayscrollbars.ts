import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { OverlayScrollbars } from 'overlayscrollbars';
import type { PartialOptions } from 'overlayscrollbars';

export interface OverlayScrollbarsHandle<T extends HTMLElement, V extends HTMLElement = T> {
	ref: RefObject<T>;
	/** Opt-in: ref this onto an element already nested inside `ref`'s element
	 * that holds the real scrollable content as its own direct children (e.g.
	 * a `display: flex; flex-direction: column` list of rows). When this ref
	 * is attached, OverlayScrollbars is told to manage scroll on THAT element
	 * directly (`elements: { viewport, content: false }`) instead of
	 * generating its own internal viewport/content wrappers and relocating
	 * `ref`'s children two levels deeper - which silently breaks layout rules
	 * (like flex-column) that depended on those children being direct
	 * children of the scrolling element. Leave unattached for the default
	 * (fully library-generated) viewport, which is fine for content that
	 * doesn't depend on that. */
	viewportRef: RefObject<V>;
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
	 * to read something older" check. `false` before the instance has
	 * mounted. */
	isNearBottom: (px?: number) => boolean;
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
 * viewport child it generates (nested two levels deep, inside a padding AND
 * a content wrapper it also generates), so code that needs to scroll the
 * element programmatically (rather than just render it) must go through
 * `scrollToTop()`/`scrollToBottom()` instead of calling `.scrollTo()` on the
 * ref directly - and CSS that depends on the ref's element's children being
 * *direct* children (e.g. `display: flex; flex-direction: column` rows)
 * breaks, since those children get relocated under the generated wrappers.
 * Attach `viewportRef` (see its own doc comment) to opt out of that
 * relocation for callers that need it.
 */
export function useOverlayScrollbars<T extends HTMLElement, V extends HTMLElement = T>(
	deps: unknown[] = [],
	options?: PartialOptions,
): OverlayScrollbarsHandle<T, V> {
	const ref = useRef<T>(null);
	const viewportRef = useRef<V>(null);
	const instance = useRef<OverlayScrollbars | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const customViewport = viewportRef.current;
		instance.current = OverlayScrollbars(
			customViewport ? { target: el, elements: { viewport: customViewport, content: false } } : el,
			{
				...defaultOptions,
				...options,
				scrollbars: { ...defaultOptions.scrollbars, ...options?.scrollbars },
			},
		);
		return () => {
			instance.current?.destroy();
			instance.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);

	return {
		ref,
		viewportRef,
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
	};
}
