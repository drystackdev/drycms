/// <reference types="vite/client" />

// Injected by `vite.config.ts`'s `define` (computed from `dry.config.ts` via
// `resolveOptions()`) - see `src/dry-config.client.ts`, the real module the
// `virtual:drycms/config` alias below points at.
declare const __DRY_PATH__: string;
declare const __DRY_CONTENT_ENGINE__: "sqlite" | "D1" | "file";

// `vite.config.ts` aliases this exact specifier to the real
// `src/dry-config.client.ts` module - declared here too so every client file
// importing it (there are many) keeps working unchanged, and so `tsc`
// (which doesn't know about Vite aliases) can still typecheck them.
declare module "virtual:drycms/config" {
	export const path: string;
	export const contentEngine: "sqlite" | "D1" | "file";
	const config: { path: string; contentEngine: "sqlite" | "D1" | "file" };
	export default config;
}
