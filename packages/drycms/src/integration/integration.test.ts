import { describe, expect, it, vi } from 'vitest';
import { dry } from './integration.js';

type SetupParams = Parameters<
	NonNullable<ReturnType<typeof dry>['hooks']['astro:config:setup']>
>[0];

function runSetup(integration: ReturnType<typeof dry>, overrides: Partial<SetupParams> = {}) {
	const updateConfig = vi.fn();
	const injectRoute = vi.fn();
	const addRenderer = vi.fn();
	const info = vi.fn();
	const warn = vi.fn();

	const params = {
		config: { integrations: [], redirects: {} },
		command: 'build',
		isRestart: false,
		updateConfig,
		addRenderer,
		addWatchFile: vi.fn(),
		injectScript: vi.fn(),
		injectRoute,
		addClientDirective: vi.fn(),
		addDevToolbarApp: vi.fn(),
		addMiddleware: vi.fn(),
		createCodegenDir: vi.fn(),
		logger: { info, warn, error: vi.fn(), debug: vi.fn(), fork: vi.fn() },
		...overrides,
	} as unknown as SetupParams;

	integration.hooks['astro:config:setup']?.(params);

	return { updateConfig, injectRoute, addRenderer, info, warn };
}

describe('dry()', () => {
	it('is named drycms', () => {
		expect(dry().name).toBe('drycms');
	});

	it('injects the app catch-all route, the storage API route, and the content-types API route', () => {
		const { injectRoute } = runSetup(dry());

		expect(injectRoute).toHaveBeenCalledTimes(3);
		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/dry/[...slug]',
			entrypoint: 'drycms/app.astro',
		});
		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/dry/api/storage/[...slug]',
			entrypoint: 'drycms/routes/storage.ts',
		});
		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/dry/api/content-types/[...slug]',
			entrypoint: 'drycms/routes/content-types.ts',
		});
	});

	it('registers a storage virtual-config plugin', () => {
		const { updateConfig } = runSetup(dry());

		// `@astrojs/preact`'s own setup hook also calls `updateConfig` (for its
		// babel/jsx config), so this is not necessarily the first call.
		const plugins = updateConfig.mock.calls
			.flatMap((call) => (call[0] as { vite?: { plugins?: { name: string }[] } }).vite?.plugins ?? [])
			.map((plugin) => plugin.name);
		expect(plugins).toContain('drycms:virtual-storage-config');
	});

	it('switches the project to server output', () => {
		const { updateConfig } = runSetup(dry());

		expect(updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({ output: 'server' }),
		);
	});

	it('warns when it changes the output mode, but not when already server', () => {
		const { warn } = runSetup(dry());
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('output: "server"'));

		const { warn: warn2 } = runSetup(dry(), {
			config: { integrations: [], output: 'server' },
		} as unknown as Partial<SetupParams>);
		expect(warn2).not.toHaveBeenCalledWith(expect.stringContaining('output: "server"'));
	});

	it('honours a custom path', () => {
		const { injectRoute } = runSetup(dry({ path: 'admin/' }));

		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/admin/[...slug]',
			entrypoint: 'drycms/app.astro',
		});
		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/admin/api/storage/[...slug]',
			entrypoint: 'drycms/routes/storage.ts',
		});
	});

	it('registers the Preact renderer with absolute entrypoints', () => {
		const { addRenderer } = runSetup(dry());

		expect(addRenderer).toHaveBeenCalledTimes(1);
		const renderer = addRenderer.mock.calls[0]?.[0];
		expect(renderer.name).toBe('@astrojs/preact');
		expect(renderer.serverEntrypoint).toMatch(/^\/.*@astrojs\/preact\/dist\/server\.js$/);
		expect(renderer.clientEntrypoint).toMatch(/^\//);
	});

	it('does not register a second renderer when @astrojs/preact is already used', () => {
		const { addRenderer } = runSetup(dry(), {
			config: { integrations: [{ name: '@astrojs/preact' }], redirects: {} },
		} as unknown as Partial<SetupParams>);

		expect(addRenderer).not.toHaveBeenCalled();
	});

	it('fails fast on an invalid path', () => {
		expect(() => dry({ path: '/' })).toThrow(/cannot be the site root/);
	});
});
