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
			storage: { kind: 'local', root: resolve(process.cwd(), 'public') },
			icons: { kind: 'local', root: resolve(process.cwd(), 'public/dry-icons') },
			content: { engine: 'sqlite', file: resolve(process.cwd(), '.dry/content.sqlite') },
			components: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/richtext-components') },
			},
			pagesCache: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/pages-cache') },
				edgeTtl: 60,
			},
			typesCache: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/types-cache') },
			},
			pagesSource: {
				storage: { kind: 'local', root: resolve(process.cwd(), '.dry/pages-source') },
			},
			ai: {
				provider: 'openai', model: 'gpt-5', baseUrl: 'https://api.openai.com',
				timeoutMs: 120_000, lang: 'en',
			},
			kv: {
				kind: 'local', root: resolve(process.cwd(), '.dry/kv'), maxEntries: 10_000,
				maxBytes: 32 * 1024 * 1024, cleanupIntervalMs: 30_000,
				flushDebounceMs: 100, flushBatchSize: 100, durability: 'async',
				defaultTtlMs: undefined, idleTtlMs: undefined,
			},
			lang: 'en',
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
		expect(resolved.icons).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'storage/dry-icons' });
		expect(resolved.components.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'richtext-components' });
		expect(resolved.pagesCache.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'pages-cache' });
		expect(resolved.typesCache.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'types-cache' });
		expect(resolved.pagesSource.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'pages-source' });
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

	it('takes pagesCache.edgeTtl as given, including 0 to disable the edge cache', () => {
		expect(resolveOptions({ pagesCache: { edgeTtl: 300 } }).pagesCache.edgeTtl).toBe(300);
		expect(resolveOptions({ pagesCache: { edgeTtl: 0 } }).pagesCache.edgeTtl).toBe(0);
	});

	it('rejects an invalid pagesCache.edgeTtl', () => {
		expect(() => resolveOptions({ pagesCache: { edgeTtl: -1 } })).toThrow(/pagesCache\.edgeTtl/);
		expect(() => resolveOptions({ pagesCache: { edgeTtl: 1.5 } })).toThrow(/pagesCache\.edgeTtl/);
		expect(() => resolveOptions({ pagesCache: { edgeTtl: '60' as unknown as number } })).toThrow(/pagesCache\.edgeTtl/);
	});

	it('rejects invalid kv tuning values', () => {
		expect(() => resolveOptions({ kv: { maxEntries: -1 } })).toThrow(/kv\.maxEntries/);
		expect(() => resolveOptions({ kv: { cleanupIntervalMs: 0 } })).toThrow(/kv\.cleanupIntervalMs/);
	});

	describe('overrides.localDataRoot (test/tooling-only escape hatch)', () => {
		it('is not reachable through the public DryOption `kind` field - only the second resolveOptions() argument', () => {
			const resolved = resolveOptions({}, { localDataRoot: '/tmp/drycms-test-root' });
			expect(resolved.storage).toEqual({ kind: 'local', root: resolve('/tmp/drycms-test-root', 'storage') });
			expect(resolved.icons).toEqual({ kind: 'local', root: resolve('/tmp/drycms-test-root', 'storage', 'dry-icons') });
			expect(resolved.content).toEqual({ engine: 'sqlite', file: resolve('/tmp/drycms-test-root', 'content.sqlite') });
			expect(resolved.kv).toMatchObject({ kind: 'local', root: resolve('/tmp/drycms-test-root', 'kv') });
		});

		it('has no effect under kind "cloudflare" (there is no local root to override)', () => {
			const resolved = resolveOptions({ kind: 'cloudflare' }, { localDataRoot: '/tmp/drycms-test-root' });
			expect(resolved.storage).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'storage' });
			expect(resolved.icons).toEqual({ kind: 'r2', binding: 'MEDIA_BUCKET', prefix: 'storage/dry-icons' });
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
			expect(resolveOptions().icons).toEqual({
				kind: 'local', root: resolve(process.cwd(), 'test-results/e2e-data/storage/dry-icons'),
			});
		});

		it('does not apply when unset', () => {
			delete process.env.DRYCMS_E2E;
			expect(resolveOptions().storage).toEqual({ kind: 'local', root: resolve(process.cwd(), 'public') });
			expect(resolveOptions().icons).toEqual({ kind: 'local', root: resolve(process.cwd(), 'public/dry-icons') });
		});
	});

	it('defaults ai.provider to "openai", independent of kind', () => {
		expect(resolveOptions().ai).toMatchObject({ provider: 'openai', model: 'gpt-5' });
		expect(resolveOptions({ kind: 'cloudflare' }).ai).toMatchObject({ provider: 'openai', model: 'gpt-5' });
	});

	it('accepts an explicit ai.provider', () => {
		expect(resolveOptions({ ai: { provider: 'anthropic' } }).ai).toMatchObject({
			provider: 'anthropic', model: 'claude-sonnet-4-20250514',
		});
	});

	it('rejects an unrecognized ai.provider', () => {
		expect(() => resolveOptions({ ai: { provider: 'codex' as 'openai' } })).toThrow(/openai.*anthropic/);
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

	it('defaults the top-level lang (<html lang>) to "en" and accepts an override, independent of ai.lang', () => {
		expect(resolveOptions().lang).toBe('en');
		expect(resolveOptions({ lang: 'vi' }).lang).toBe('vi');
		expect(resolveOptions({ lang: 'vi', ai: { lang: 'en' } })).toMatchObject({ lang: 'vi', ai: { lang: 'en' } });
	});

	it('rejects an empty top-level lang', () => {
		expect(() => resolveOptions({ lang: '' })).toThrow(/`lang`/);
		expect(() => resolveOptions({ lang: '   ' })).toThrow(/`lang`/);
	});
});
