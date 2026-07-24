import { useEffect, useState } from 'preact/hooks';
import { CloseIcon, MenuIcon } from './icons.js';

/**
 * Opens the off-canvas sidebar on small screens by toggling `data-dry-open` on
 * the shell element, which is all the CSS needs.
 */
export default function SidebarToggle() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const shell = document.querySelector<HTMLElement>('[data-dry-shell]');
		if (!shell) return;
		if (open) shell.setAttribute('data-dry-open', '');
		else shell.removeAttribute('data-dry-open');
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		const onClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('[data-dry-sidebar]') || target?.closest('[data-dry-sidebar-toggle]')) {
				return;
			}
			setOpen(false);
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('click', onClick);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('click', onClick);
		};
	}, [open]);

	return (
		<button
			type="button"
			data-variant="ghost"
			data-size="icon"
			data-dry-sidebar-toggle
			data-dry-mobile-only
			aria-expanded={open}
			aria-label={open ? 'Close navigation' : 'Open navigation'}
			onClick={() => setOpen((value) => !value)}
		>
			{open ? <CloseIcon /> : <MenuIcon />}
		</button>
	);
}
