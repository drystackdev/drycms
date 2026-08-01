import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
	it('defaults to /dry and local storage under ./storage and ./icons', () => {
		const expected = {
			path: '/dry',
			storage: { kind: 'local', root: resolve(process.cwd(), 'storage') },
			icons: { kind: 'local', root: resolve(process.cwd(), 'icons') },
			content: { engine: 'sqlite', file: resolve(process.cwd(), 'content.sqlite') },
			richtext: {
				componentsDir: resolve(process.cwd(), 'src/dry-components'),
				storage: { kind: 'local', root: resolve(process.cwd(), 'richtext-components') },
			},
		};
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

	it('rejects an unimplemented storage kind, naming the roadmap (github/gitlab no longer on it)', () => {
		expect(() => resolveOptions({ storage: { kind: 'r2' as unknown as 'local' } })).toThrow(/roadmap/);
		expect(() => resolveOptions({ storage: { kind: 'r2' as unknown as 'local' } })).toThrow(
			/planned: r2, s3\)/,
		);
	});

	it('mentions all implemented kinds when rejecting an unimplemented one', () => {
		expect(() => resolveOptions({ storage: { kind: 'r2' as unknown as 'local' } })).toThrow(
			/Only "local", "github" and "gitlab" are available today/,
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

	it('resolves a relative icons.root against cwd, independently of storage.root', () => {
		expect(resolveOptions({ icons: { root: 'my-icons' } }).icons).toEqual({
			kind: 'local',
			root: resolve(process.cwd(), 'my-icons'),
		});
	});

	it('passes an absolute icons.root through unchanged', () => {
		const absolute = resolve('/tmp/drycms-icons');
		expect(resolveOptions({ icons: { root: absolute } }).icons.root).toBe(absolute);
	});

	it('rejects an unrecognized icons.kind', () => {
		expect(() => resolveOptions({ icons: { kind: 'made-up' as unknown as 'local' } })).toThrow(
			/not a recognized storage kind/,
		);
	});

	it('rejects a non-string icons.root', () => {
		expect(() => resolveOptions({ icons: { root: 42 as unknown as string } })).toThrow(TypeError);
	});

	describe('storage.kind: "github"', () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('resolves owner/repo/token from env, defaulting branch to storage', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');

			expect(resolveOptions({ storage: { kind: 'github' } }).storage).toEqual({
				kind: 'github',
				owner: 'acme',
				repo: 'media',
				branch: 'storage',
				token: 'ghp_test_token',
				root: 'storage',
			});
		});

		it('honors storage.branch and storage.root when set', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			vi.stubEnv('GITHUB_BRANCH', 'ignored-env-branch');

			expect(resolveOptions({ storage: { kind: 'github', branch: 'develop', root: '' } }).storage).toEqual({
				kind: 'github',
				owner: 'acme',
				repo: 'media',
				branch: 'develop',
				token: 'ghp_test_token',
				root: '',
			});
		});

		it('does not use GITHUB_BRANCH when branch is omitted', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			vi.stubEnv('GITHUB_BRANCH', 'from-env');

			expect(resolveOptions({ storage: { kind: 'github' } }).storage).toMatchObject({
				branch: 'storage',
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

	describe('storage.kind: "gitlab"', () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('resolves project/token from env, defaulting branch to storage and host to gitlab.com', () => {
			vi.stubEnv('GITLAB_PROJECT', 'acme/media');
			vi.stubEnv('GITLAB_PAT_KEY', 'glpat_test_token');
			vi.stubEnv('GITLAB_HOST', undefined);

			expect(resolveOptions({ storage: { kind: 'gitlab' } }).storage).toEqual({
				kind: 'gitlab',
				host: 'https://gitlab.com',
				project: 'acme/media',
				branch: 'storage',
				token: 'glpat_test_token',
				root: 'storage',
			});
		});

		it('honors storage.branch, GITLAB_HOST and storage.root when set', () => {
			vi.stubEnv('GITLAB_PROJECT', '42');
			vi.stubEnv('GITLAB_PAT_KEY', 'glpat_test_token');
			vi.stubEnv('GITLAB_BRANCH', 'develop');
			vi.stubEnv('GITLAB_HOST', 'https://gitlab.example.com/');

			expect(resolveOptions({ storage: { kind: 'gitlab', branch: 'develop', root: '' } }).storage).toEqual({
				kind: 'gitlab',
				host: 'https://gitlab.example.com',
				project: '42',
				branch: 'develop',
				token: 'glpat_test_token',
				root: '',
			});
		});

		it('does not use GITLAB_BRANCH when branch is omitted', () => {
			vi.stubEnv('GITLAB_PROJECT', 'acme/media');
			vi.stubEnv('GITLAB_PAT_KEY', 'glpat_test_token');
			vi.stubEnv('GITLAB_BRANCH', 'from-env');

			expect(resolveOptions({ storage: { kind: 'gitlab' } }).storage).toMatchObject({
				branch: 'storage',
			});
		});

		it('rejects a missing GITLAB_PROJECT', () => {
			vi.stubEnv('GITLAB_PROJECT', undefined);
			vi.stubEnv('GITLAB_PAT_KEY', 'glpat_test_token');
			expect(() => resolveOptions({ storage: { kind: 'gitlab' } })).toThrow(/GITLAB_PROJECT/);
		});

		it('rejects a missing GITLAB_PAT_KEY', () => {
			vi.stubEnv('GITLAB_PROJECT', 'acme/media');
			vi.stubEnv('GITLAB_PAT_KEY', undefined);
			expect(() => resolveOptions({ storage: { kind: 'gitlab' } })).toThrow(/GITLAB_PAT_KEY/);
		});
	});

	describe('icons.kind: "github"/"gitlab" (same env vars as storage - a different root within the same repo)', () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('resolves icons independently of storage, sharing the same GITHUB_* credentials', () => {
			vi.stubEnv('GITHUB_REPO', 'acme/media');
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');

			const resolved = resolveOptions({ storage: { kind: 'local' }, icons: { kind: 'github', root: 'icons' } });
			expect(resolved.icons).toEqual({
				kind: 'github',
				owner: 'acme',
				repo: 'media',
				branch: 'icons',
				token: 'ghp_test_token',
				root: 'icons',
			});
			expect(resolved.storage).toEqual({ kind: 'local', root: resolve(process.cwd(), 'storage') });
		});

		it('resolves icons as gitlab-backed independently of storage', () => {
			vi.stubEnv('GITLAB_PROJECT', 'acme/media');
			vi.stubEnv('GITLAB_PAT_KEY', 'glpat_test_token');

			expect(resolveOptions({ icons: { kind: 'gitlab', root: 'icons' } }).icons).toEqual({
				kind: 'gitlab',
				host: 'https://gitlab.com',
				project: 'acme/media',
				branch: 'icons',
				token: 'glpat_test_token',
				root: 'icons',
			});
		});

		it('rejects a missing GITHUB_REPO for icons.kind: "github"', () => {
			vi.stubEnv('GITHUB_REPO', undefined);
			vi.stubEnv('GITHUB_PAT_KEY', 'ghp_test_token');
			expect(() => resolveOptions({ icons: { kind: 'github' } })).toThrow(/GITHUB_REPO/);
		});
	});
});
