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

	it('injects a single catch-all route for the Preact app', () => {
		const { injectRoute } = runSetup(dry());

		expect(injectRoute).toHaveBeenCalledTimes(1);
		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/dry/[...slug]',
			entrypoint: 'drycms/routes/app.astro',
		});
	});

	it('switches the project to server output', () => {
		const { updateConfig } = runSetup(dry());

		expect(updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({ output: 'server' }),
		);
	});

	it('logs when it changes the output mode, but not when already server', () => {
		const { info } = runSetup(dry());
		expect(info).toHaveBeenCalledWith(expect.stringContaining('output: "server"'));

		const { info: info2 } = runSetup(dry(), {
			config: { integrations: [], output: 'server' },
		} as unknown as Partial<SetupParams>);
		expect(info2).not.toHaveBeenCalledWith(expect.stringContaining('output: "server"'));
	});

	it('honours a custom path', () => {
		const { injectRoute } = runSetup(dry({ path: 'admin/' }));

		expect(injectRoute).toHaveBeenCalledWith({
			pattern: '/admin/[...slug]',
			entrypoint: 'drycms/routes/app.astro',
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
