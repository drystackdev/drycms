import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export interface ListOption {
	value: string;
	label: string;
	disabled?: boolean;
}

/** Case-insensitive substring match on `label`. */
export function filterOptions<T extends ListOption>(options: T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return options;
	return options.filter((option) => option.label.toLowerCase().includes(needle));
}

export function firstEnabledIndex(options: ListOption[]): number {
	return options.findIndex((option) => !option.disabled);
}

export function lastEnabledIndex(options: ListOption[]): number {
	for (let index = options.length - 1; index >= 0; index -= 1) {
		if (!options[index]?.disabled) return index;
	}
	return -1;
}

/** Next enabled index in `direction` (1 or -1) from `from`, clamped (no wrap). */
export function nextEnabledIndex(options: ListOption[], from: number, direction: 1 | -1): number {
	let index = from;
	while (true) {
		const candidate = index + direction;
		if (candidate < 0 || candidate >= options.length) return from;
		index = candidate;
		if (!options[index]?.disabled) return index;
	}
}

/** First enabled option whose label starts with `buffer`, searching after `from`. */
export function matchTypeahead(options: ListOption[], buffer: string, from: number): number {
	const needle = buffer.toLowerCase();
	if (!needle || options.length === 0) return -1;
	for (let step = 1; step <= options.length; step += 1) {
		const index = (from + step) % options.length;
		const option = options[index];
		if (option && !option.disabled && option.label.toLowerCase().startsWith(needle)) {
			return index;
		}
	}
	return -1;
}

/** Builds a typeahead buffer from keypresses, resetting after a short pause. */
export function useTypeahead(onMatch: (buffer: string) => void) {
	const [buffer, setBuffer] = useState('');

	useEffect(() => {
		if (!buffer) return;
		const timer = setTimeout(() => setBuffer(''), 500);
		return () => clearTimeout(timer);
	}, [buffer]);

	return (char: string) => {
		const next = buffer + char.toLowerCase();
		setBuffer(next);
		onMatch(next);
	};
}

/** Closes an open popup when a pointer goes down outside every given ref.
 *
 * On mobile, `.select`/`.datepicker-trigger`'s popup becomes a bottom sheet
 * with a full-viewport dimming backdrop rendered as that same element's
 * `::before` (components.css, `.select:has(> .datepicker-popup)::before` and
 * the `.select-popup` equivalent) - not a real DOM node of its own. A tap
 * anywhere on that backdrop is reported with `event.target` equal to the
 * wrapper element itself (pseudo-elements aren't hit-testable targets in
 * their own right), which is indistinguishable by `.contains()` alone from a
 * real tap on the wrapper's own padding/gap (e.g. between MultiSelect's tag
 * chips) - both need to keep working, but the backdrop case must close the
 * popup while the padding case must not. The two differ in one way: real
 * content (the trigger button, the popup and everything in it) is a proper
 * descendant, so it's always "inside" regardless of where it's rendered
 * (popups routinely extend past the wrapper's own box); a tap landing on the
 * wrapper node exactly is only "inside" if the pointer coordinates are
 * actually within ITS OWN rect - the backdrop covers the full viewport far
 * beyond that small rect, so a coordinate check tells the two apart. */
export function useOutsideClick(open: boolean, refs: RefObject<HTMLElement>[], onClose: () => void) {
	useEffect(() => {
		if (!open) return;
		const isInside = (ref: RefObject<HTMLElement>, event: PointerEvent) => {
			const el = ref.current;
			const target = event.target as Node;
			if (!el?.contains(target)) return false;
			if (target !== el) return true;
			const rect = el.getBoundingClientRect();
			return (
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			);
		};
		const handlePointerDown = (event: PointerEvent) => {
			if (refs.some((ref) => isInside(ref, event))) return;
			onClose();
		};
		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	}, [open, onClose]);
}

/** Closes an open popup when focus leaves `ref`'s subtree, e.g. via Tab -
 * `useOutsideClick` only reacts to pointer events, so keyboard-only users
 * tabbing past the trigger/input previously left the popup open and
 * visually stranded. `focusout` bubbles (unlike `blur`), so one listener on
 * the wrapper catches focus leaving any descendant (input, option, ...). */
export function useCloseOnBlur(open: boolean, ref: RefObject<HTMLElement>, onClose: () => void) {
	useEffect(() => {
		if (!open) return;
		const el = ref.current;
		if (!el) return;
		const handleFocusOut = (event: FocusEvent) => {
			const next = event.relatedTarget as Node | null;
			if (next && el.contains(next)) return;
			onClose();
		};
		el.addEventListener('focusout', handleFocusOut);
		return () => el.removeEventListener('focusout', handleFocusOut);
	}, [open, ref, onClose]);
}

/** Closes an open popup on window resize, mirroring `tooltip.ts`'s own
 * resize-dismiss: a popup's `position: fixed` coordinates (`useFloatingPosition`
 * below, or `Popover.tsx`'s own position effect) are measured once when it
 * opens and don't track the trigger through a reflow, so after a resize they
 * point at empty space - dropped rather than re-measured, same reasoning as
 * the tooltip. */
export function useCloseOnResize(open: boolean, onClose: () => void) {
	// `onClose` via a ref, not a `useEffect` dep - callers pass a fresh inline
	// closure each render, and depending on it directly would tear down and
	// re-add the listener on every one of those renders (not just when `open`
	// changes). That churn is more than wasted work: a real window resize can
	// fire other listeners registered earlier (`usePopupFlip`'s own resize
	// handler among them) whose state update triggers a synchronous re-render
	// between listener invocations of the *same* dispatch - if that re-render
	// happens to detach and re-add this listener mid-dispatch, the spec skips
	// it for the event already in flight (a listener added during dispatch
	// only applies to future events), so it silently never fires for that
	// resize at all.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const handler = () => onCloseRef.current();
		window.addEventListener('resize', handler);
		return () => window.removeEventListener('resize', handler);
	}, [open]);
}

/** Fixed-position coordinates for a popup anchored to `anchorRef`, full width
 * by default - mirrors Popover.tsx's own position effect. `top` accounts for
 * `openUp` by pointing at the anchor's top edge instead of its bottom; pair
 * with `transform: translateY(-100%)` in the caller when `openUp` is true so
 * the popup's own (unmeasured) height grows upward from that point instead of
 * downward from it.
 *
 * Re-measures on a `ResizeObserver` of the anchor, not just when `open`/
 * `openUp` change - MultiSelect's anchor grows taller as picked chips wrap
 * onto more lines, which would otherwise leave the popup floating at the
 * anchor's pre-wrap (shorter) height instead of following it down. */
export function useFloatingPosition(
	open: boolean,
	anchorRef: RefObject<HTMLElement>,
	openUp: boolean,
	gap = 6,
): { top: number; left: number; width: number } | null {
	const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

	useLayoutEffect(() => {
		if (!open) return;
		const anchor = anchorRef.current;
		if (!anchor) return;
		const measure = () => {
			const rect = anchor.getBoundingClientRect();
			setPosition({
				left: rect.left,
				top: openUp ? rect.top - gap : rect.bottom + gap,
				width: rect.width,
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(anchor);
		return () => observer.disconnect();
	}, [open, openUp]);

	return open ? position : null;
}

/** Wires a `popover="auto"` element's imperative show/hide to `open`, and
 * listens for the native `toggle` event so `onLightDismiss` fires when the
 * browser closes it itself (outside click, Escape) - keeps React state from
 * going stale the same way Popover.tsx's own `toggle` listener does. */
export function useNativePopover(open: boolean, ref: RefObject<HTMLElement>, onLightDismiss: () => void) {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (open) el.showPopover?.();
		else el.hidePopover?.();
	}, [open]);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const handleToggle = (event: Event) => {
			if ((event as Event & { newState?: string }).newState === 'closed') onLightDismiss();
		};
		el.addEventListener('toggle', handleToggle);
		return () => el.removeEventListener('toggle', handleToggle);
	}, [onLightDismiss]);
}

/**
 * Locks every scrollable ancestor of `ref` (a plain `overflow: auto`
 * container, or the page itself) while `active` - keeps a popover's anchor
 * from drifting out from under it while it's open.
 */
export function useScrollLock(active: boolean, ref: RefObject<HTMLElement>) {
	useEffect(() => {
		if (!active) return;
		const locked: { el: HTMLElement; overflow: string }[] = [];
		let node: HTMLElement | null = ref.current;
		while (node) {
			if (node.scrollHeight > node.clientHeight + 1) {
				locked.push({ el: node, overflow: node.style.overflow });
				node.style.overflow = 'hidden';
			}
			node = node.parentElement;
		}
		locked.push({ el: document.body, overflow: document.body.style.overflow });
		document.body.style.overflow = 'hidden';
		return () => {
			for (const { el, overflow } of locked) el.style.overflow = overflow;
		};
	}, [active, ref]);
}

/**
 * Whether a popup anchored below `anchorRef` should instead drop upward,
 * because there isn't enough viewport space below it.
 */
export function usePopupFlip(
	open: boolean,
	anchorRef: RefObject<HTMLElement>,
	estimatedHeight = 280,
): boolean {
	const [openUp, setOpenUp] = useState(false);

	useLayoutEffect(() => {
		if (!open) return;
		const measure = () => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (!rect) return;
			const spaceBelow = window.innerHeight - rect.bottom;
			const spaceAbove = rect.top;
			setOpenUp(spaceBelow < estimatedHeight && spaceAbove > spaceBelow);
		};
		measure();
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	}, [open]);

	return open && openUp;
}

/** Single printable character from a keydown event, or `null` for anything else. */
export function printableChar(event: KeyboardEvent): string | null {
	if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
		return null;
	}
	return event.key;
}

/** Opens/closes a native `<dialog>` to match `active`, and reports back when
 * the dialog closes itself (Escape, backdrop click, or an in-dialog
 * `close()` call) - but NOT when it closes because `active` itself just
 * turned false (e.g. the caller already handled a successful confirm),
 * since the native `close` event fires either way and can't tell the two
 * apart on its own. Shared by every native-`<dialog>` consumer (`Confirm
 * Dialog`, `FieldDialog`, `ImageField`, `FileManager`'s own dialogs). */
export function useDialogSync(active: boolean, onDismiss: () => void) {
	const ref = useRef<HTMLDialogElement>(null);
	const closingProgrammatically = useRef(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (active && !el.open) el.showModal();
		if (!active && el.open) {
			closingProgrammatically.current = true;
			el.close();
		}
	}, [active]);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const handleClose = () => {
			if (closingProgrammatically.current) {
				closingProgrammatically.current = false;
				return;
			}
			onDismiss();
		};
		el.addEventListener('close', handleClose);
		return () => el.removeEventListener('close', handleClose);
	}, [onDismiss]);

	return ref;
}
