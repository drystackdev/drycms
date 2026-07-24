// The Astro language server doesn't resolve `simplebar`'s `exports` map for
// side-effect imports inside `.astro` `<script>` blocks.
declare module "simplebar";

// Resolved at runtime by the `dry()` integration's Vite plugin (see
// `integration/virtual.ts`), and injected into consuming projects the same
// way via `astro:config:done` - declared here too so this package's own
// `tsc` build (which compiles the `.tsx` files that import it) can see it.
declare module "virtual:drycms/config" {
	export const path: string;
	export const dashboardPath: string;
	const config: { path: string; dashboardPath: string };
	export default config;
}

// `@victr/prism-live` ships no types (plain JS). Only the surface Demo.tsx
// actually uses is declared here.
declare module "@victr/prism-live" {
	export default class PrismLive {
		constructor(source: HTMLElement);
		value: string;
		update(force?: boolean): void;
		static create(source: HTMLElement): PrismLive;
		static addPrism(prism: unknown): void;
	}
}
declare module "@victr/prism-live/prism" {
	export default class LivePrismCore {
		addLanguage(language: unknown): void;
	}
}
declare module "@victr/prism-live/language/markup" {
	const language: unknown;
	export default language;
}
declare module "@victr/prism-live/style.css";

