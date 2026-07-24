import { describe, expect, it, vi } from 'vitest';
import { dry } from './integration.js';

type SetupParams = Parameters<
	NonNullable<ReturnType<typeof dry>['hooks']['astro:config:setup']>
>[0];

function runSetup(integration: ReturnType<typeof dry>, overrides: Partial<SetupParams> = {}) {
	const updateConfig = vi.fn();
	const injectRoute = vi.fn();
	const addRenderer = vi.fn();
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
		logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn(), fork: vi.fn() },
		...overrides,
	} as unknown as SetupParams;

	integration.hooks['astro:config:setup']?.(params);

	return { updateConfig, injectRoute, addRenderer, warn };
}

describe('dry()', () => {
	it('is named drycms', () => {
		expect(dry().name).toBe('drycms');
	});

	it('injects the dashboard route and its redirect', () => {
		const { injectRoute, updateConfig } = runSetup(dry());

		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/dry/dashboard',
			entrypoint: 'drycms/routes/dashboard.astro',
		});
		expect(updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({ redirects: { '/dry': '/dry/dashboard' } }),
		);
	});

	it('injects the showcase route', () => {
		const { injectRoute } = runSetup(dry());

		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/dry/showcase',
			entrypoint: 'drycms/routes/showcase.astro',
		});
	});

	it('honours a custom path', () => {
		const { injectRoute, updateConfig } = runSetup(dry({ path: 'admin/' }));

		expect(injectRoute.mock.calls.map(([route]) => route.pattern)).toEqual([
			'/admin/dashboard',
			'/admin/showcase',
		]);
		expect(updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({ redirects: { '/admin': '/admin/dashboard' } }),
		);
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

	it('warns when it overwrites an existing redirect', () => {
		const { warn } = runSetup(dry(), {
			config: { integrations: [], redirects: { '/dry': '/somewhere-else' } },
		} as unknown as Partial<SetupParams>);

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('already configured'));
	});

	it('fails fast on an invalid path', () => {
		expect(() => dry({ path: '/' })).toThrow(/cannot be the site root/);
	});
});
