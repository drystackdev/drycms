import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config, resolveOptions } from './options.js';

describe('config', () => {
	it('returns the raw options for startup resolution', () => {
		const options = { path: '/admin', kind: 'cloudflare' as const };
		expect(config(options)).toBe(options);
	});

	it('accepts an omitted options object', () => {
		expect(config()).toEqual({});
	});
});

describe('resolveOptions', () => {
	it('defaults every backend to kind "local"', () => {
		const expected = {
			path: '/dry',
			kind: 'local',
			storage: { kind: 'local', root: resolve(process.cwd(), '.dry/storage') },
			icons: { kind: 'local', root: resolve(process.cwd(), '.dry/icons') },
			content: { engine: 'sqlite', file: resolve(process.cwd(), '.dry/content.sqlite') },
			components: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/richtext-components') },
			},
			pageComponents: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/components') },
			},
			pagesCache: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/pages-cache') },
			},
			typesCache: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/types-cache') },
			},
			ai: {
				mode: 'local', provider: 'codex', command: 'codex',
				args: ['exec', '--ephemeral', '--skip-git-repo-check'],
				cwd: undefined, timeoutMs: 120_000, lang: 'en',
			},
			kv: {
				kind: 'local', root: resolve(process.cwd(), '.dry/kv'), maxEntries: 10_000,
				maxBytes: 32 * 1024 * 1024, cleanupIntervalMs: 30_000,
				flushDebounceMs: 100, flushBatchSize: 100, durability: 'async',
				defaultTtlMs: undefined, idleTtlMs: undefined,
			},
		};
		expect(resolveOptions()).toEqual(expected);
		expect(resolveOptions({})).toEqual(expected);
		expect(resolveOptions({ kind: 'local' })).toEqual(expected);
	});

	it('resolves kind "cloudflare" to D1 content, one shared R2 bucket per prefix, and Workers KV - all with fixed binding names', () => {
		const resolved = resolveOptions({ kind: 'cloudflare' });
		expect(resolved.kind).toBe('cloudflare');
		expect(resolved.content).toEqual({ engine: 'D1', binding: 'CONTENT_DB' });
		expect(resolved.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'storage' });
		expect(resolved.icons).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'icons' });
		expect(resolved.components.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'richtext-components' });
		expect(resolved.pageComponents.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'components' });
		expect(resolved.pagesCache.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'pages-cache' });
		expect(resolved.typesCache.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'types-cache' });
		expect(resolved.kv).toMatchObject({ kind: 'KV', binding: 'KV' });
	});

	it('rejects an unrecognized top-level kind', () => {
		expect(() => resolveOptions({ kind: 'r2' as 'cloudflare' })).toThrow(/"local" or "cloudflare"/);
		expect(() => resolveOptions({ kind: 'github' as 'local' })).toThrow(/"local" or "cloudflare"/);
	});

	it('still accepts kv tuning independent of kind', () => {
		expect(resolveOptions({ kv: { maxEntries: 5, durability: 'sync' } }).kv).toMatchObject({
			kind: 'local', maxEntries: 5, durability: 'sync',
		});
		expect(resolveOptions({ kind: 'cloudflare', kv: { maxEntries: 5 } }).kv).toMatchObject({
			kind: 'KV', binding: 'KV', maxEntries: 5,
		});
	});

	it('rejects invalid kv tuning values', () => {
		expect(() => resolveOptions({ kv: { maxEntries: -1 } })).toThrow(/kv\.maxEntries/);
		expect(() => resolveOptions({ kv: { cleanupIntervalMs: 0 } })).toThrow(/kv\.cleanupIntervalMs/);
	});

	describe('overrides.localDataRoot (test/tooling-only escape hatch)', () => {
		it('is not reachable through the public DryOption `kind` field - only the second resolveOptions() argument', () => {
			const resolved = resolveOptions({}, { localDataRoot: '/tmp/drycms-test-root' });
			expect(resolved.storage).toEqual({ kind: 'local', root: resolve('/tmp/drycms-test-root', 'storage') });
			expect(resolved.content).toEqual({ engine: 'sqlite', file: resolve('/tmp/drycms-test-root', 'content.sqlite') });
			expect(resolved.kv).toMatchObject({ kind: 'local', root: resolve('/tmp/drycms-test-root', 'kv') });
		});

		it('has no effect under kind "cloudflare" (there is no local root to override)', () => {
			const resolved = resolveOptions({ kind: 'cloudflare' }, { localDataRoot: '/tmp/drycms-test-root' });
			expect(resolved.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'storage' });
		});
	});

	describe('DRYCMS_E2E redirect', () => {
		const ORIGINAL = process.env.DRYCMS_E2E;
		afterEach(() => {
			if (ORIGINAL === undefined) delete process.env.DRYCMS_E2E;
			else process.env.DRYCMS_E2E = ORIGINAL;
		});

		it('redirects local defaults under test-results/e2e-data instead of .dry when set to "1"', () => {
			process.env.DRYCMS_E2E = '1';
			expect(resolveOptions().storage).toEqual({
				kind: 'local', root: resolve(process.cwd(), 'test-results/e2e-data/storage'),
			});
		});

		it('does not apply when unset', () => {
			delete process.env.DRYCMS_E2E;
			expect(resolveOptions().storage).toEqual({ kind: 'local', root: resolve(process.cwd(), '.dry/storage') });
		});
	});

	it('derives ai.mode from kind - "local" runs a CLI, "cloudflare" calls a provider API', () => {
		expect(resolveOptions().ai).toMatchObject({ mode: 'local', provider: 'codex' });
		expect(resolveOptions({ kind: 'cloudflare' }).ai).toMatchObject({ mode: 'server', provider: 'openai' });
	});

	it('rejects an ai.provider that does not match the derived mode', () => {
		expect(() => resolveOptions({ ai: { provider: 'openai' } })).toThrow(/codex.*claude.*kind.*local/);
		expect(() => resolveOptions({ kind: 'cloudflare', ai: { provider: 'codex' as 'openai' } })).toThrow(/openai.*anthropic.*kind.*cloudflare/);
	});

	it('defaults ai.lang to "en" and accepts an override, under both kinds', () => {
		expect(resolveOptions().ai.lang).toBe('en');
		expect(resolveOptions({ ai: { lang: 'vi' } }).ai.lang).toBe('vi');
		expect(resolveOptions({ kind: 'cloudflare', ai: { lang: 'vi' } }).ai.lang).toBe('vi');
	});

	it('rejects an empty ai.lang', () => {
		expect(() => resolveOptions({ ai: { lang: '' } })).toThrow(/ai\.lang/);
		expect(() => resolveOptions({ ai: { lang: '   ' } })).toThrow(/ai\.lang/);
	});
});
