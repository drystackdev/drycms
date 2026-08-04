/// <reference types="vite/client" />

export {};

declare global {
	interface Window {
		__DRY_CONFIG__: {
			path: string;
			contentEngine: "sqlite" | "D1";
			aiMode: "local" | "server";
		};
	}
}

declare module "@babel/standalone" {
	const BabelStandalone: any;
	export = BabelStandalone;
}
