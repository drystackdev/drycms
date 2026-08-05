import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { config, resolveOptions } from './options.js';

describe('config', () => {
	it('returns the raw options for startup resolution', () => {
		const options = { path: '/admin', content: { engine: 'file' as const } };
		expect(config(options)).toBe(options);
	});

	it('accepts an omitted options object', () => {
		expect(config()).toEqual({});
	});
});

describe('resolveOptions', () => {
	it('defaults all file-backed subsystems to local storage', () => {
		const expected = {
			path: '/dry',
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
	});

	it('resolves local roots relative to cwd', () => {
		expect(resolveOptions({ storage: { root: 'assets' } }).storage).toEqual({
			kind: 'local', root: resolve(process.cwd(), 'assets'),
		});
	});

	it('uses .dry defaults for sqlite content and SQLite KV', () => {
		expect(resolveOptions({ kv: { kind: 'sqlite' } })).toMatchObject({
			content: { engine: 'sqlite', file: resolve(process.cwd(), '.dry/content.sqlite') },
			kv: { kind: 'sqlite', file: resolve(process.cwd(), '.dry/kv.sqlite') },
		});
	});

	it('rejects the removed "file" content engine', () => {
		expect(() => resolveOptions({ content: { engine: 'file' as 'sqlite' } })).toThrow(
			/Only "sqlite" and "D1" are available today/,
		);
	});

	it('rejects GitHub and GitLab storage kinds', () => {
		expect(() => resolveOptions({ storage: { kind: 'github' as 'local' } })).toThrow(/not a recognized storage kind/);
		expect(() => resolveOptions({ storage: { kind: 'gitlab' as 'local' } })).toThrow(/not a recognized storage kind/);
	});

	it('rejects remote branches after GitHub/GitLab removal', () => {
		expect(() => resolveOptions({ storage: { branch: 'main' } })).toThrow(/branch.*no longer supported/);
	});

	it('rejects an unimplemented storage kind and names the roadmap', () => {
		expect(() => resolveOptions({ storage: { kind: 's3' as 'local' } })).toThrow(/planned: s3/);
		expect(() => resolveOptions({ storage: { kind: 's3' as 'local' } })).toThrow(/Only "local" and "r2" are available today/);
	});

	it('resolves an r2 storage kind given a binding, defaulting the prefix from the root default', () => {
		expect(resolveOptions({ storage: { kind: 'r2', binding: 'MEDIA_BUCKET' } }).storage).toEqual({
			kind: 'r2',
			binding: 'MEDIA_BUCKET',
			prefix: 'dry/storage',
		});
	});

	it('rejects r2 storage without a binding, and a binding without r2', () => {
		expect(() => resolveOptions({ storage: { kind: 'r2' } })).toThrow(/requires a `storage.binding`/);
		expect(() => resolveOptions({ storage: { binding: 'MEDIA_BUCKET' } })).toThrow(/binding.*only used with.*kind: "r2"/);
	});

	it('rejects an unrecognized storage kind and invalid values', () => {
		expect(() => resolveOptions({ storage: { kind: 'made-up' as 'local' } })).toThrow(/not a recognized storage kind/);
		expect(() => resolveOptions({ storage: { kind: 42 as unknown as 'local' } })).toThrow(TypeError);
		expect(() => resolveOptions({ storage: { root: 42 as unknown as string } })).toThrow(TypeError);
	});

	it('rejects GitHub and GitLab KV kinds', () => {
		expect(() => resolveOptions({ kv: { kind: 'github' as 'local' } })).toThrow(/kv.kind/);
		expect(() => resolveOptions({ kv: { kind: 'gitlab' as 'local' } })).toThrow(/kv.kind/);
	});

	it('defaults ai.lang to "en" and accepts an override, in both local and server mode', () => {
		expect(resolveOptions().ai.lang).toBe('en');
		expect(resolveOptions({ ai: { lang: 'vi' } }).ai.lang).toBe('vi');
		expect(resolveOptions({ ai: { mode: 'server', lang: 'vi' } }).ai.lang).toBe('vi');
	});

	it('rejects an empty ai.lang', () => {
		expect(() => resolveOptions({ ai: { lang: '' } })).toThrow(/ai\.lang/);
		expect(() => resolveOptions({ ai: { lang: '   ' } })).toThrow(/ai\.lang/);
	});
});
