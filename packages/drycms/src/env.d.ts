// Resolved at runtime by the `dry()` integration's Vite plugin (see
// `integration/virtual.ts`), and injected into consuming projects the same
// way via `astro:config:done` - declared here too so this package's own
// `tsc` build (which compiles the `.tsx` files that import it) can see it.
declare module "virtual:drycms/config" {
	export const path: string;
	export const contentEngine: "sqlite" | "D1" | "file";
	const config: { path: string; contentEngine: "sqlite" | "D1" | "file" };
	export default config;
}

declare module "virtual:drycms/storage-config" {
	type StorageConfig =
		| { kind: "local"; root: string }
		| { kind: "github"; owner: string; repo: string; branch: string; token: string; root: string }
		| { kind: "gitlab"; host: string; project: string; branch: string; token: string; root: string };
	export const storage: StorageConfig;
	const config: { storage: StorageConfig };
	export default config;
}

declare module "virtual:drycms/icons-config" {
	type IconsConfig =
		| { kind: "local"; root: string }
		| { kind: "github"; owner: string; repo: string; branch: string; token: string; root: string }
		| { kind: "gitlab"; host: string; project: string; branch: string; token: string; root: string };
	export const icons: IconsConfig;
	const config: { icons: IconsConfig };
	export default config;
}

declare module "virtual:drycms/content-config" {
	type StorageBackend =
		| { kind: "local"; root: string }
		| { kind: "github"; owner: string; repo: string; branch: string; token: string; root: string }
		| { kind: "gitlab"; host: string; project: string; branch: string; token: string; root: string };
	type ContentConfig = { engine: "sqlite"; file: string } | { engine: "D1"; binding: string } | ({ engine: "file" } & StorageBackend);
	export const content: ContentConfig;
	const config: { content: ContentConfig };
	export default config;
}

