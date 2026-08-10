/// <reference types="vite/client" />

export {};

declare global {
	interface ImportMetaEnv {
		/** Baked in per-build by `vite.config.ts`'s `define` (`isWorkerBuild`) -
		 * `"cloudflare"` only for the Workers SSR build/dev
		 * (`build:worker`/`deploy`/`dev:worker`), `"local"` for `bun run dev`
		 * and the Node SSR build alike. `src/server/config.ts` reads this to
		 * resolve `DryOption.kind` without a project-level `dry.config.ts`. */
		readonly DRYCMS_KIND?: "local" | "cloudflare";
		/** Baked in per-build/dev-server-start from `package.json`'s `version`
		 * field (see `vite.config.ts`'s `define`) - shown in the sidebar
		 * footer (`DryLayout.tsx`). Same "baked in, not read at runtime"
		 * treatment as `DRYCMS_KIND` above. */
		readonly DRYCMS_VERSION?: string;
	}

	interface Window {
		__DRY_CONFIG__: {
			path: string;
			contentEngine: "sqlite" | "D1";
		};
	}
}

