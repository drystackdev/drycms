import { useLocation } from 'preact-iso';
import type { ComponentChildren } from 'preact';
import Icon from './Icon.js';
import SidebarToggle from './SidebarToggle.js';
import ThemeToggle from './ThemeToggle.js';
import Toaster from './Toast.js';
import type { IconName } from './icons.js';
import { useSimpleBar } from './simplebar.js';
import { path } from 'virtual:drycms/config';

interface Props {
	/** Shown in the topbar; the document title is set by each page instead. */
	title?: string;
	children?: ComponentChildren;
}

const NAV: { key: string; label: string; href: string; icon: IconName; ready: boolean }[] = [
	{ key: 'dashboard', label: 'Dashboard', href: `${path}/dashboard`, icon: 'Dashboard', ready: true },
	{ key: 'showcase', label: 'Showcase', href: `${path}/showcase`, icon: 'Media', ready: true },
	{ key: 'content', label: 'Content', href: `${path}/content`, icon: 'Content', ready: false },
	{ key: 'media', label: 'Media', href: `${path}/media`, icon: 'Media', ready: false },
	{ key: 'users', label: 'Users', href: `${path}/users`, icon: 'Users', ready: false },
	{ key: 'settings', label: 'Settings', href: `${path}/settings`, icon: 'Settings', ready: false },
];

export default function DryLayout({ title = 'drycms', children }: Props) {
	const { url } = useLocation();
	const sidebar = useSimpleBar<HTMLElement>();
	const main = useSimpleBar<HTMLDivElement>();

	return (
		<div class="shell">
			<aside class="sidebar" ref={sidebar.ref}>
				<a class="brand" href={`${path}/dashboard`}>
					<Icon name="Brand" />
					drycms
				</a>

				<nav aria-label="Admin">
					<span class="nav-label">Manage</span>
					{NAV.map((item) =>
						item.ready ? (
							<a
								key={item.key}
								href={item.href}
								aria-current={url.startsWith(item.href) ? 'page' : undefined}
							>
								<Icon name={item.icon} />
								{item.label}
							</a>
						) : (
							<a key={item.key} aria-disabled="true" style="pointer-events: none; opacity: 0.55">
								<Icon name={item.icon} />
								{item.label}
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
