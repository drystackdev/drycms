/// <reference types="vite/client" />

// `vite.config.ts` provides this virtual module at build/dev config time.
// Declaring it here keeps TypeScript aware of the public client-safe shape.
declare module "virtual:drycms/config" {
	export const path: string;
	export const contentEngine: "sqlite" | "D1" | "file";
	const config: { path: string; contentEngine: "sqlite" | "D1" | "file" };
	export default config;
}

declare module "@babel/standalone" {
	const BabelStandalone: any;
	export = BabelStandalone;
}
