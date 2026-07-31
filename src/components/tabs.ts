/**
 * Global `[role="tablist"]` behaviour - plain DOM/TS, no framework involved.
 * Importing this module is enough to activate it; it wires itself up once
 * on import.
 *
 * Native ARIA tabs (a `role="tablist"` of `role="tab"` buttons, each
 * `aria-controls` an `id`'d `role="tabpanel"`) need a little glue JS to
 * actually switch panels - this is that glue, delegated to `document` so it
 * covers every tablist on the page, present now or added later, with no
 * per-instance wiring required.
 *
 * Clicking a tab marks it `aria-selected`, clears that on its siblings
 * within the same tablist, and toggles `hidden` on the panel each points at
 * via `aria-controls`.
 */

function initTabs() {
	if (document.body.dataset.dryTabsInit) return;
	document.body.dataset.dryTabsInit = 'true';

	const onClick = (event: MouseEvent) => {
		const tab = (event.target as HTMLElement).closest?.('[role="tab"]');
		if (!(tab instanceof HTMLElement)) return;
		const tablist = tab.closest('[role="tablist"]');
		if (!tablist) return;
		for (const other of tablist.querySelectorAll('[role="tab"]')) {
			const selected = other === tab;
			other.setAttribute('aria-selected', String(selected));
			const panelId = other.getAttribute('aria-controls');
			const panel = panelId && document.getElementById(panelId);
			if (panel) panel.toggleAttribute('hidden', !selected);
		}
	};

	document.addEventListener('click', onClick);
}

if (typeof document !== 'undefined') initTabs();
