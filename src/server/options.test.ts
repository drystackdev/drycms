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
			storage: { kind: 'local', root: resolve(process.cwd(), 'storage') },
			icons: { kind: 'local', root: resolve(process.cwd(), 'icons') },
			content: { engine: 'sqlite', file: resolve(process.cwd(), 'content.sqlite') },
			components: {
				storage: { kind: 'local', root: resolve(process.cwd(), 'components') },
			},
			ai: {
				mode: 'local', provider: 'codex', command: 'codex',
				args: ['exec', '--ephemeral', '--skip-git-repo-check'],
				cwd: undefined, timeoutMs: 120_000,
			},
			kv: {
				kind: 'local', root: resolve(process.cwd(), 'kv'), maxEntries: 10_000,
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

	it('rejects GitHub and GitLab storage kinds', () => {
		expect(() => resolveOptions({ storage: { kind: 'github' as 'local' } })).toThrow(/not a recognized storage kind/);
		expect(() => resolveOptions({ storage: { kind: 'gitlab' as 'local' } })).toThrow(/not a recognized storage kind/);
	});

	it('rejects remote branches after GitHub/GitLab removal', () => {
		expect(() => resolveOptions({ storage: { branch: 'main' } })).toThrow(/branch.*no longer supported/);
	});

	it('rejects an unimplemented storage kind and names the roadmap', () => {
		expect(() => resolveOptions({ storage: { kind: 'r2' as 'local' } })).toThrow(/planned: r2, s3/);
		expect(() => resolveOptions({ storage: { kind: 'r2' as 'local' } })).toThrow(/Only "local" is available today/);
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
});
