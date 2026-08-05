import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

/**
 * Lets the currently-mounted page hand its own title/actions (Save,
 * Preview, ...) to `DryLayout`'s shared topbar instead of rendering a local
 * `.page-header` - see `page-common.ts`'s `usePageHeaderActions`. `null`
 * means the topbar shows nothing beyond its own sidebar/sync controls.
 */
export const pageHeaderActions = signal<ComponentChildren | null>(null);
