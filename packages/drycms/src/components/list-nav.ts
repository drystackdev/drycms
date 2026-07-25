import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
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
		if (candidate < 0 || candidate >= options.length) return index;
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

/** Closes an open popup when a pointer goes down outside every given ref. */
export function useOutsideClick(open: boolean, refs: RefObject<HTMLElement>[], onClose: () => void) {
	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (refs.some((ref) => ref.current?.contains(target))) return;
			onClose();
		};
		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	}, [open, onClose]);
}

/**
 * Locks every scrollable ancestor of `ref` (a SimpleBar pane, a plain
 * `overflow: auto` container, or the page itself) while `active` - keeps a
 * popover's anchor from drifting out from under it while it's open.
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
