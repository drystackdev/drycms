/// <reference types="vite/client" />

export {};

declare global {
	interface Window {
		__DRY_CONFIG__: {
			path: string;
			contentEngine: "sqlite" | "D1" | "file";
		};
	}
}

declare module "@babel/standalone" {
	const BabelStandalone: any;
	export = BabelStandalone;
}
