import { describe, expect, it } from 'vitest';
import {
	VIRTUAL_CONFIG_ID,
	VIRTUAL_ICONS_CONFIG_ID,
	VIRTUAL_STORAGE_CONFIG_ID,
	dryFixOptimizeDeps,
	dryVirtualConfig,
	dryVirtualIconsConfig,
	dryVirtualStorageConfig,
} from './virtual.js';

describe('dryVirtualConfig', () => {
	it('resolves and loads the resolved path', () => {
		const plugin = dryVirtualConfig({
			path: '/dry',
			storage: { kind: 'local', root: '/srv/storage' },
			icons: { kind: 'local', root: '/srv/icons' },
			content: { engine: 'sqlite', file: '/srv/content.sqlite' },
			experimentalClientSearch: false,
		});
		const resolved = (plugin.resolveId as (id: string) => string | null)(VIRTUAL_CONFIG_ID);
		expect(resolved).toBe(`\0${VIRTUAL_CONFIG_ID}`);
		expect((plugin.resolveId as (id: string) => string | null)('something-else')).toBeNull();

		const code = (plugin.load as (id: string) => string | null)(resolved!);
		expect(code).toContain(`export const path = "/dry";`);
			expect(code).toContain(`export const experimentalClientSearch = false;`);
	});

	it('load() returns null for an unrelated id', () => {
		const plugin = dryVirtualConfig({
			path: '/dry',
			storage: { kind: 'local', root: '/srv/storage' },
			icons: { kind: 'local', root: '/srv/icons' },
			content: { engine: 'sqlite', file: '/srv/content.sqlite' },
			experimentalClientSearch: false,
		});
		expect((plugin.load as (id: string) => string | null)('unrelated')).toBeNull();
	});
});

describe('dryVirtualStorageConfig', () => {
	it('resolves and loads the resolved storage option', () => {
		const plugin = dryVirtualStorageConfig({ kind: 'local', root: '/srv/storage' });
		const resolved = (plugin.resolveId as (id: string) => string | null)(VIRTUAL_STORAGE_CONFIG_ID);
		expect(resolved).toBe(`\0${VIRTUAL_STORAGE_CONFIG_ID}`);
		expect((plugin.resolveId as (id: string) => string | null)('something-else')).toBeNull();

		const code = (plugin.load as (id: string) => string | null)(resolved!);
		expect(code).toContain(`"kind":"local"`);
		expect(code).toContain(`"root":"/srv/storage"`);
	});

	it('load() returns null for an unrelated id', () => {
		const plugin = dryVirtualStorageConfig({ kind: 'local', root: '/srv/storage' });
		expect((plugin.load as (id: string) => string | null)('unrelated')).toBeNull();
	});
});

describe('dryVirtualIconsConfig', () => {
	it('resolves and loads the resolved icons option', () => {
		const plugin = dryVirtualIconsConfig({ kind: 'local', root: '/srv/icons' });
		const resolved = (plugin.resolveId as (id: string) => string | null)(VIRTUAL_ICONS_CONFIG_ID);
		expect(resolved).toBe(`\0${VIRTUAL_ICONS_CONFIG_ID}`);
		expect((plugin.resolveId as (id: string) => string | null)('something-else')).toBeNull();

		const code = (plugin.load as (id: string) => string | null)(resolved!);
		expect(code).toContain(`"kind":"local"`);
		expect(code).toContain(`"root":"/srv/icons"`);
	});

	it('load() returns null for an unrelated id', () => {
		const plugin = dryVirtualIconsConfig({ kind: 'local', root: '/srv/icons' });
		expect((plugin.load as (id: string) => string | null)('unrelated')).toBeNull();
	});
});

describe('dryFixOptimizeDeps', () => {
	it('drops unaliased @astrojs/preact entries, keeps aliased ones', () => {
		const plugin = dryFixOptimizeDeps({ '@astrojs/preact/client.js': '/abs/client.js' });
		const config: { optimizeDeps?: { include?: string[] } } = {
			optimizeDeps: {
				include: ['@astrojs/preact/client.js', '@astrojs/preact/server.js', 'other-package'],
			},
		};
		(plugin.config as (config: typeof config) => void)(config);
		expect(config.optimizeDeps?.include).toEqual(['@astrojs/preact/client.js', 'other-package']);
	});
});
