import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOptions } from './options.js';

describe('resolveOptions', () => {
	it('defaults to /dry and local storage under ./storage', () => {
		const expected = { path: '/dry', storage: { kind: 'local', root: resolve(process.cwd(), 'storage') } };
		expect(resolveOptions()).toEqual(expected);
		expect(resolveOptions({})).toEqual(expected);
	});

	it('adds a leading slash', () => {
		expect(resolveOptions({ path: 'admin' }).path).toBe('/admin');
	});

	it('strips trailing slashes', () => {
		expect(resolveOptions({ path: '/admin/' }).path).toBe('/admin');
		expect(resolveOptions({ path: '/admin///' }).path).toBe('/admin');
	});

	it('collapses repeated slashes', () => {
		expect(resolveOptions({ path: '//cms//panel' }).path).toBe('/cms/panel');
	});

	it('supports nested paths', () => {
		expect(resolveOptions({ path: '/studio/cms' }).path).toBe('/studio/cms');
	});

	it('trims surrounding whitespace', () => {
		expect(resolveOptions({ path: '  /admin  ' }).path).toBe('/admin');
	});

	it('rejects the site root', () => {
		expect(() => resolveOptions({ path: '/' })).toThrow(/cannot be the site root/);
		expect(() => resolveOptions({ path: '' })).toThrow(/cannot be the site root/);
	});

	it('rejects route parameters', () => {
		expect(() => resolveOptions({ path: '/admin/[id]' })).toThrow(/route parameters/);
	});

	it('rejects query strings, hashes and whitespace', () => {
		expect(() => resolveOptions({ path: '/admin?tab=1' })).toThrow(/"\?", "#" or whitespace/);
		expect(() => resolveOptions({ path: '/admin#top' })).toThrow(/"\?", "#" or whitespace/);
		expect(() => resolveOptions({ path: '/my admin' })).toThrow(/"\?", "#" or whitespace/);
	});

	it('rejects non-string paths', () => {
		expect(() => resolveOptions({ path: 42 as unknown as string })).toThrow(TypeError);
	});

	it('resolves a relative storage.root against cwd', () => {
		expect(resolveOptions({ storage: { root: 'assets' } }).storage).toEqual({
			kind: 'local',
			root: resolve(process.cwd(), 'assets'),
		});
	});

	it('passes an absolute storage.root through unchanged', () => {
		const absolute = resolve('/tmp/drycms-storage');
		expect(resolveOptions({ storage: { root: absolute } }).storage.root).toBe(absolute);
	});

	it('rejects an unimplemented storage kind, naming the roadmap (github no longer on it)', () => {
		expect(() => resolveOptions({ storage: { kind: 'r2' as unknown as 'local' } })).toThrow(/roadmap/);
		expect(() => resolveOptions({ storage: { kind: 'r2' as unknown as 'local' } })).toThrow(
			/planned: r2, gitlab, s3\)/,
		);
	});

	it('mentions both implemented kinds when rejecting an unimplemented one', () => {
		expect(() => resolveOptions({ storage: { kind: 'r2' as unknown as 'local' } })).toThrow(
			/Only "local" and "github" are available today/,
		);
	});

	it('rejects an unrecognized storage kind', () => {
		expect(() => resolveOptions({ storage: { kind: 'made-up' as unknown as 'local' } })).toThrow(
			/not a recognized storage kind/,
		);
	});

	it('rejects a non-string storage.kind', () => {
		expect(() => resolveOptions({ storage: { kind: 42 as unknown as 'local' } })).toThrow(TypeError);
	});

	it('rejects a non-string storage.root', () => {
		expect(() => resolveOptions({ storage: { root: 42 as unknown as string } })).toThrow(TypeError);
	});

	describe('storage.kind: "github"', () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('resolves owner/repo/token from env, defaulting branch to main', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			vi.stubEnv('GITHUB_BRANCH', undefined);

			expect(resolveOptions({ storage: { kind: 'github' } }).storage).toEqual({
				kind: 'github',
				owner: 'acme',
				repo: 'media',
				branch: 'main',
				token: 'ghp_test_token',
				root: 'storage',
			});
		});

		it('honors GITHUB_BRANCH and storage.root when set', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			vi.stubEnv('GITHUB_BRANCH', 'develop');

			expect(resolveOptions({ storage: { kind: 'github', root: '' } }).storage).toEqual({
				kind: 'github',
				owner: 'acme',
				repo: 'media',
				branch: 'develop',
				token: 'ghp_test_token',
				root: '',
			});
		});

		it('rejects a missing GITHUB_REPO', () => {
			vi.stubEnv('GITHUB_REPO', undefined);
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			expect(() => resolveOptions({ storage: { kind: 'github' } })).toThrow(/GITHUB_REPO/);
		});

		it('rejects a GITHUB_REPO not shaped "owner/repo"', () => {
			vi.stubEnv('GITHUB_REPO', 'not-a-valid-repo');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			expect(() => resolveOptions({ storage: { kind: 'github' } })).toThrow(/owner\/repo/);
		});

		it('rejects a missing GITHUB_PAT_KEY', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', undefined);
			expect(() => resolveOptions({ storage: { kind: 'github' } })).toThrow(/GITHUB_PAT_KEY/);
		});
	});
});
