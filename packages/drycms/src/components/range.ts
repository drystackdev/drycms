/**
 * Global `input[type="range"]` behaviour - plain DOM/TS, no framework
 * involved. Importing this module is enough to activate it; it wires itself
 * up once on import.
 *
 * Keeps every range input's `--value` (0-100, drives the WebKit track fill
 * in forms.css) synced to the value the user is dragging to - WebKit has no
 * `::-webkit-range-progress` pseudo-element to fill natively, unlike
 * Firefox's `::-moz-range-progress`. One delegated listener covers every
 * range on the page, present now or added later.
 */

function initRangeFill() {
	if (document.body.dataset.dryRangeInit) return;
	document.body.dataset.dryRangeInit = 'true';

	const onInput = (event: Event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
		const min = target.min === '' ? 0 : Number(target.min);
		const max = target.max === '' ? 100 : Number(target.max);
		const percent = max === min ? 0 : ((Number(target.value) - min) / (max - min)) * 100;
		target.style.setProperty('--value', String(percent));
	};

	document.addEventListener('input', onInput);
}

if (typeof document !== 'undefined') initRangeFill();
