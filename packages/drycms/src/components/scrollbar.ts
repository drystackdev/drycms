/**
 * Global `.scrollbar-auto` behaviour - plain DOM/TS, no framework involved.
 * Importing this module is enough to activate it; it wires itself up once
 * on import (same shape as tooltip.ts).
 *
 * Hides the native scrollbar on any `.scrollbar-auto` element - scrolling
 * itself stays 100% native (momentum, wheel, keyboard, touch all untouched) -
 * and lazily injects one `.scroll-over` thumb/track as a real CHILD of it
 * (`.scrollbar-auto` is `position: relative`, see utilities.css) on first
 * hover/scroll. Being a real child - not a wrapper-level or body-portaled
 * element - means it's naturally clipped by `.scrollbar-auto` and by any of
 * its ancestors' own `overflow`, at any nesting depth ("scroll trong
 * scroll"), the same way any other DOM content would be; a body-portaled
 * `position: fixed` element (the `tooltip.ts` technique) doesn't get that for
 * free and can visually leak outside a clipping ancestor while an active
 * scroll needs to keep it on screen and in sync.
 *
 * `.scroll-over` uses `position: absolute`, not `sticky` - `sticky` avoids
 * scrolling away but still occupies a slot in `.scrollbar-auto`'s own
 * grid/flex layout if it lays out its children that way (the exact bug that
 * broke `.field-dialog-scroll`'s grid under SimpleBar). `absolute` is fully
 * removed from grid/flex flow, but - since `.scrollbar-auto` is both its
 * containing block AND the scroll container - it scrolls away with the
 * content like any other absolutely-positioned descendant of a scrolling box
 * would. `updateThumb()` below compensates by writing the element's current
 * `scrollTop` into `--dry-scroll-offset`; `transform: translateY(...)` in
 * CSS cancels the scroll back out, keeping the overlay visually pinned to
 * the box's own top edge.
 *
 * See status/scrollbar.md for the full design writeup and
 * utilities.css/components.css for the CSS half.
 *
 * Skipped entirely on touch/coarse-pointer devices (checked once at import
 * time) - those already get an OS-native overlay scrollbar.
 */

const HIDE_DELAY_MS = 1000;
const MIN_THUMB_SIZE = 24;

interface ScrollState {
	over: HTMLElement;
	resizeObserver: ResizeObserver;
	hideTimer: number | null;
	dragging: boolean;
}

const states = new WeakMap<HTMLElement, ScrollState>();

function metrics(el: HTMLElement) {
	const trackHeight = el.clientHeight;
	const thumbSize = Math.max(MIN_THUMB_SIZE, (el.clientHeight / el.scrollHeight) * trackHeight);
	const maxThumbPos = trackHeight - thumbSize;
	const maxScroll = el.scrollHeight - el.clientHeight;
	const thumbPos = maxScroll > 0 ? (el.scrollTop / maxScroll) * maxThumbPos : 0;
	return { thumbSize, thumbPos, maxThumbPos, maxScroll };
}

function updateThumb(el: HTMLElement, over: HTMLElement) {
	const { thumbSize, thumbPos } = metrics(el);
	over.style.setProperty('--dry-scroll-offset', `${el.scrollTop}px`);
	over.style.setProperty('--dry-scroll-thumb-size', `${thumbSize}px`);
	over.style.setProperty('--dry-scroll-thumb-pos', `${thumbPos}px`);
}

function scheduleHide(state: ScrollState) {
	if (state.hideTimer) window.clearTimeout(state.hideTimer);
	state.hideTimer = window.setTimeout(() => {
		if (!state.dragging) state.over.classList.remove('visible');
	}, HIDE_DELAY_MS);
}

function onThumbPointerDown(el: HTMLElement, state: ScrollState) {
	return (event: PointerEvent) => {
		const over = state.over;
		const rect = over.getBoundingClientRect();
		const { thumbSize, thumbPos, maxThumbPos, maxScroll } = metrics(el);
		const pointerY = event.clientY - rect.top;
		const onThumb = pointerY >= thumbPos && pointerY <= thumbPos + thumbSize;
		// Clicking the track outside the thumb jumps straight to that position,
		// centering the thumb under the pointer - same as native OS scrollbars.
		const startOffset = onThumb ? pointerY - thumbPos : thumbSize / 2;
		if (!onThumb) {
			const jumpPos = Math.min(Math.max(pointerY - startOffset, 0), maxThumbPos);
			el.scrollTop = maxThumbPos > 0 ? (jumpPos / maxThumbPos) * maxScroll : 0;
		}

		state.dragging = true;
		if (state.hideTimer) window.clearTimeout(state.hideTimer);
		over.setPointerCapture(event.pointerId);

		const onMove = (moveEvent: PointerEvent) => {
			const moveRect = over.getBoundingClientRect();
			const { maxThumbPos: mtp, maxScroll: ms } = metrics(el);
			const y = Math.min(Math.max(moveEvent.clientY - moveRect.top - startOffset, 0), mtp);
			el.scrollTop = mtp > 0 ? (y / mtp) * ms : 0;
		};
		const onUp = (upEvent: PointerEvent) => {
			state.dragging = false;
			over.releasePointerCapture(upEvent.pointerId);
			over.removeEventListener('pointermove', onMove);
			over.removeEventListener('pointerup', onUp);
			over.removeEventListener('pointercancel', onUp);
			scheduleHide(state);
		};
		over.addEventListener('pointermove', onMove);
		over.addEventListener('pointerup', onUp);
		over.addEventListener('pointercancel', onUp);
	};
}

function createOverlay(el: HTMLElement): ScrollState {
	const over = document.createElement('div');
	over.className = 'scroll-over';
	el.append(over);
	updateThumb(el, over);

	const resizeObserver = new ResizeObserver(() => {
		if (el.scrollHeight <= el.clientHeight) {
			over.classList.remove('visible');
			return;
		}
		updateThumb(el, over);
	});
	resizeObserver.observe(el);

	const state: ScrollState = { over, resizeObserver, hideTimer: null, dragging: false };
	over.addEventListener('pointerdown', onThumbPointerDown(el, state));
	return state;
}

function ensureState(el: HTMLElement): ScrollState | null {
	const existing = states.get(el);
	if (existing) return existing;
	if (el.scrollHeight <= el.clientHeight) return null;
	const state = createOverlay(el);
	states.set(el, state);
	return state;
}

function show(el: HTMLElement) {
	const state = ensureState(el);
	if (!state) return;
	updateThumb(el, state.over);
	state.over.classList.add('visible');
	scheduleHide(state);
}

function hide(el: HTMLElement) {
	const state = states.get(el);
	if (!state || state.dragging) return;
	state.over.classList.remove('visible');
}

function initScrollbar() {
	if (document.body.dataset.dryScrollInit) return;
	document.body.dataset.dryScrollInit = 'true';

	if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

	// `.scroll-over` is a real child of `.scrollbar-auto` now, so a plain
	// `closest()` walk (same as tooltip.ts) is enough - moving onto it is
	// moving onto a descendant, not a sibling, so mouseout won't fire for it.
	const onOver = (event: Event) => {
		const target = (event.target as HTMLElement).closest?.('.scrollbar-auto');
		if (target instanceof HTMLElement) show(target);
	};
	const onOut = (event: Event) => {
		const target = (event.target as HTMLElement).closest?.('.scrollbar-auto');
		if (!(target instanceof HTMLElement)) return;
		const related = (event as MouseEvent).relatedTarget as HTMLElement | null;
		if (related?.closest?.('.scrollbar-auto') === target) return;
		hide(target);
	};
	const onScroll = (event: Event) => {
		if (event.target instanceof HTMLElement && event.target.classList.contains('scrollbar-auto')) {
			show(event.target);
		}
	};

	document.addEventListener('mouseover', onOver);
	document.addEventListener('mouseout', onOut);
	// `scroll` doesn't bubble - capture on window to catch it from any
	// `.scrollbar-auto`, same technique tooltip.ts uses to dismiss on
	// ancestor scroll.
	window.addEventListener('scroll', onScroll, { capture: true, passive: true });
}

if (typeof document !== 'undefined') initScrollbar();
