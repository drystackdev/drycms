import { describe, expect, it } from 'vitest';
import { resolveOptions } from './options.js';

describe('resolveOptions', () => {
	it('defaults to /dry', () => {
		const expected = { path: '/dry' };
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
		expect(resolveOptions({ path: '/studio/cms' })).toEqual({ path: '/studio/cms' });
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
});
