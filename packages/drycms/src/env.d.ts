// The Astro language server doesn't resolve `simplebar`'s `exports` map for
// side-effect imports inside `.astro` `<script>` blocks.
declare module "simplebar";

// Resolved at runtime by the `dry()` integration's Vite plugin (see
// `integration/virtual.ts`), and injected into consuming projects the same
// way via `astro:config:done` - declared here too so this package's own
// `tsc` build (which compiles the `.tsx` files that import it) can see it.
declare module "virtual:drycms/config" {
	export const path: string;
	const config: { path: string };
	export default config;
}

