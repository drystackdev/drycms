import { useEffect, useState } from 'preact/hooks';
import { MonitorIcon, MoonIcon, SunIcon } from './icons.js';

export type DryTheme = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'drycms:theme';

const ORDER: DryTheme[] = ['system', 'light', 'dark'];

const LABELS: Record<DryTheme, string> = {
	system: 'System theme',
	light: 'Light theme',
	dark: 'Dark theme',
};

function applyTheme(theme: DryTheme) {
	const root = document.querySelector<HTMLElement>('.dry') ?? document.body;
	if (theme === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', theme);
	try {
		localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// Private mode / storage disabled — the theme still applies for this page.
	}
}

function readStoredTheme(): DryTheme {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	} catch {
		// ignore
	}
	return 'system';
}

/**
 * Cycles system → light → dark. Starts from `system` so the server-rendered
 * markup matches the first client render, then syncs to storage on mount.
 */
export default function ThemeToggle() {
	const [theme, setTheme] = useState<DryTheme>('system');

	useEffect(() => {
		setTheme(readStoredTheme());
	}, []);

	const next = () => {
		const value = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] as DryTheme;
		setTheme(value);
		applyTheme(value);
	};

	return (
		<button
			type="button"
			data-variant="ghost"
			data-size="icon"
			onClick={next}
			title={LABELS[theme]}
			aria-label={LABELS[theme]}
		>
			{theme === 'dark' ? <MoonIcon /> : theme === 'light' ? <SunIcon /> : <MonitorIcon />}
		</button>
	);
}
