/**
 * Global `[data-tooltip]` behaviour - plain DOM/TS, no framework involved.
 * Importing this module is enough to activate it; it wires itself up once
 * on import.
 *
 * Shows a `.dry-tooltip` (portaled straight onto `<body>`, positioned via
 * `getBoundingClientRect`) whenever a `[data-tooltip]` element is hovered or
 * focused - a fixed, body-level element instead of a CSS pseudo-element on
 * the trigger so it isn't clipped by a scroll-overflowed ancestor (a table's
 * `.scroll` wrapper, ...). Rendered via the Popover API (`popover="manual"`),
 * same reasoning as `Toaster` in Toast.tsx: it puts the tooltip in the
 * browser's top layer, so a tooltip on a trigger inside (or behind) an open
 * native `<dialog>` still floats above it - a bare `z-index` on a normal-flow
 * element never could, since a top-layer `<dialog>` always wins regardless of
 * z-index. Re-promoted (`hidePopover` + `showPopover`) on every `show()` for
 * the same "last shown wins" reason `Toaster` re-promotes on every new toast -
 * `hide()` itself never calls `hidePopover`, since that would flip the
 * element to `display: none` immediately (per the `[popover]` UA
 * stylesheet) and cut the opacity/scale fade-out short; staying open but
 * `opacity: 0`/`pointer-events: none` is enough to make it inert. Dismissed on
 * mouseout/blur same as a native tooltip, and also on scroll (capturing, so
 * it catches any scrollable ancestor, not just the window) or window resize -
 * once the trigger has moved (or the layout has reflowed), the tooltip's
 * stale fixed position no longer points at it, so it's dropped rather than
 * re-measured.
 *
 * Placement defaults to above/below the trigger, flipping based on available
 * space. Add `data-tooltip-placement="right"` to instead pin it to the
 * trigger's inline-end, vertically centered - used by the collapsed sidebar,
 * where icons sit flush against the viewport edge and a top/bottom tooltip
 * would overlap the nav items above or below.
 */

const TOOLTIP_GAP = 8;
const TOOLTIP_MARGIN = 4;

function initTooltip() {
	if (document.body.dataset.dryTooltipInit) return;
	document.body.dataset.dryTooltipInit = 'true';

	const el = document.createElement('div');
	el.className = 'dry-tooltip';
	el.setAttribute('role', 'tooltip');
	el.setAttribute('popover', 'manual');
	document.body.append(el);
	let trigger: HTMLElement | null = null;

	const hide = () => {
		trigger = null;
		el.classList.remove('dry-tooltip-visible');
	};

	const show = (next: HTMLElement) => {
		const message = next.getAttribute('data-tooltip');
		if (!message) return;
		trigger = next;
		el.textContent = message;
		// Top-layer entries stack by "last shown wins" - re-promoting here
		// keeps this tooltip above any `<dialog>` (or other popover) opened
		// since the last time it was shown.
		if (el.matches?.(':popover-open')) el.hidePopover?.();
		el.showPopover?.();
		const rect = next.getBoundingClientRect();
		const right = next.getAttribute('data-tooltip-placement') === 'right';
		const above = !right && rect.top > 40;
		el.classList.toggle('dry-tooltip-above', above);
		el.classList.toggle('dry-tooltip-below', !right && !above);
		el.classList.toggle('dry-tooltip-right', right);
		el.classList.add('dry-tooltip-visible');
		// offsetWidth/offsetHeight, not getBoundingClientRect() - the latter
		// reflects the entrance `scale` transform, which is still animating in
		// from a fraction of full size right after the class toggle above, and
		// would throw off the centering math below.
		const tipWidth = el.offsetWidth;
		const tipHeight = el.offsetHeight;
		if (right) {
			const top = rect.top + rect.height / 2 - tipHeight / 2;
			el.style.left = `${rect.right + TOOLTIP_GAP}px`;
			el.style.top = `${Math.max(TOOLTIP_MARGIN, Math.min(top, window.innerHeight - tipHeight - TOOLTIP_MARGIN))}px`;
			return;
		}
		const left = rect.left + rect.width / 2 - tipWidth / 2;
		const top = above ? rect.top - TOOLTIP_GAP - tipHeight : rect.bottom + TOOLTIP_GAP;
		el.style.left = `${Math.max(TOOLTIP_MARGIN, Math.min(left, window.innerWidth - tipWidth - TOOLTIP_MARGIN))}px`;
		el.style.top = `${top}px`;
	};

	const onOver = (event: Event) => {
		const target = (event.target as HTMLElement).closest?.('[data-tooltip]');
		if (target instanceof HTMLElement && target !== trigger) show(target);
	};
	const onOut = (event: Event) => {
		const target = (event.target as HTMLElement).closest?.('[data-tooltip]');
		if (target !== trigger) return;
		// Moving onto a child of the same trigger (e.g. the icon inside a
		// button) fires mouseout/focusout too - only hide if the pointer/focus
		// actually left the trigger, not just an element within it.
		const related = (event as MouseEvent | FocusEvent).relatedTarget as HTMLElement | null;
		if (related?.closest?.('[data-tooltip]') === trigger) return;
		hide();
	};
	const onDismiss = () => {
		if (trigger) hide();
	};

	document.addEventListener('mouseover', onOver);
	document.addEventListener('mouseout', onOut);
	document.addEventListener('focusin', onOver);
	document.addEventListener('focusout', onOut);
	window.addEventListener('scroll', onDismiss, { capture: true, passive: true });
	window.addEventListener('resize', onDismiss, { passive: true });
}

if (typeof document !== 'undefined') initTooltip();
