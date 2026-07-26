import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { ComponentChildren } from 'preact';
import Icon from './Icon.js';
import SidebarToggle from './SidebarToggle.js';
import ThemeToggle from './ThemeToggle.js';
import Toaster from './Toast.js';
import type { IconName } from './icons.js';
import { useSimpleBar } from './simplebar.js';
import { path } from 'virtual:drycms/config';

const SIDEBAR_COLLAPSED_KEY = 'drycms:sidebar-collapsed';

function readStoredCollapsed(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
	} catch {
		return false;
	}
}

interface Props {
	children?: ComponentChildren;
}

const NAV: { key: string; label: string; href: string; icon: IconName; ready: boolean }[] = [
	{ key: 'dashboard', label: 'Dashboard', href: `${path}/dashboard`, icon: 'Dashboard', ready: true },
	{ key: 'showcase', label: 'Showcase', href: `${path}/showcase`, icon: 'Media', ready: true },
	{ key: 'content', label: 'Content', href: `${path}/content`, icon: 'Content', ready: false },
	{ key: 'media', label: 'Media', href: `${path}/media`, icon: 'Media', ready: true },
	{ key: 'users', label: 'Users', href: `${path}/users`, icon: 'Users', ready: false },
	{ key: 'settings', label: 'Settings', href: `${path}/settings`, icon: 'Settings', ready: false },
];

export default function DryLayout({ children }: Props) {
	const { url } = useLocation();
	const sidebar = useSimpleBar<HTMLElement>();
	const main = useSimpleBar<HTMLDivElement>();
	const [collapsed, setCollapsed] = useState(false);

	/* Shown in the topbar; `document.title` is set by each page instead. */
	const title = NAV.find((item) => url.startsWith(item.href))?.label ?? 'drycms';

	useEffect(() => {
		const stored = readStoredCollapsed();
		setCollapsed(stored);
		document.querySelector<HTMLElement>('.shell')?.classList.toggle('collapsed', stored);
	}, []);

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		document.querySelector<HTMLElement>('.shell')?.classList.toggle('collapsed', next);
		try {
			localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
		} catch {
			// Private mode / storage disabled - collapse still applies for this page.
		}
	};

	return (
		<div class="shell">
			<aside class="sidebar" ref={sidebar.ref}>
				<div class="sidebar-head">
					<a class="brand" href={`${path}/dashboard`}>
						<Icon name="Brand" />
						<span>drycms</span>
					</a>

					<button
						type="button"
						class="ghost icon desktop-only"
						aria-expanded={!collapsed}
						aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
						title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
						onClick={toggleCollapsed}
					>
						<Icon name={collapsed ? 'ArrowRight' : 'ArrowLeft'} />
					</button>
				</div>

				<nav aria-label="Admin">
					<span class="nav-label">Manage</span>
					{NAV.map((item) =>
						item.ready ? (
							<a
								key={item.key}
								href={item.href}
								aria-current={url.startsWith(item.href) ? 'page' : undefined}
								data-tooltip={collapsed ? item.label : undefined}
								data-tooltip-placement="right"
							>
								<Icon name={item.icon} />
								<span>{item.label}</span>
							</a>
						) : (
							<a
								key={item.key}
								aria-disabled="true"
								style="pointer-events: none; opacity: 0.55"
								data-tooltip={collapsed ? item.label : undefined}
								data-tooltip-placement="right"
							>
								<Icon name={item.icon} />
								<span>{item.label}</span>
								<span class="spacer" />
								<span class="badge outline">Soon</span>
							</a>
						),
					)}
				</nav>

				<span class="spacer"></span>
				<small>
					Mounted at <code>{path}</code>
				</small>
			</aside>

			<div class="main" ref={main.ref}>
				<header class="topbar">
					<SidebarToggle />
					<strong>{title}</strong>
					<span class="spacer"></span>
					<ThemeToggle />
				</header>

				<main class="content">{children}</main>
			</div>

			<Toaster />
		</div>
	);
}
