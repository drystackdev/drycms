import { effect, signal } from "@preact/signals";
import { readStoreValue, writeStoreValue } from "../hooks/useStore.js";

const COLLAPSED_KEY = "sidebarCollapsed";

/** Shared across `DryLayout` and `SidebarToggle`, so it's a signal rather
 * than a per-component `useStore` - persisted into the same `drycms:store` entry
 * a `useStore("sidebarCollapsed", ...)` would use. */
export const collapsed = signal(
  readStoreValue<boolean>(COLLAPSED_KEY) ?? false,
);

effect(() => {
  writeStoreValue(COLLAPSED_KEY, collapsed.value);
});
