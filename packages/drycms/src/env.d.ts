// Resolved at runtime by the `dry()` integration's Vite plugin (see
// `integration/virtual.ts`), and injected into consuming projects the same
// way via `astro:config:done` - declared here too so this package's own
// `tsc` build (which compiles the `.tsx` files that import it) can see it.
declare module "virtual:drycms/config" {
	export const path: string;
	const config: { path: string };
	export default config;
}

declare module "virtual:drycms/storage-config" {
	type StorageConfig =
		| { kind: "local"; root: string }
		| { kind: "github"; owner: string; repo: string; branch: string; token: string; root: string };
	export const storage: StorageConfig;
	const config: { storage: StorageConfig };
	export default config;
}

declare module "virtual:drycms/content-config" {
	type ContentConfig = { engine: "sqlite"; file: string } | { engine: "D1"; binding: string };
	export const content: ContentConfig;
	const config: { content: ContentConfig };
	export default config;
}

