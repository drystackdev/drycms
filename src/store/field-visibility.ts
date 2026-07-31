import { signal } from "@preact/signals";

/**
 * Shared "reveal" toggle for every `PasswordField` on the page - flipping
 * one instance shows them all for the rest of this session; unlike
 * `collapsed` in `store/dashboard.ts` this isn't persisted, so a reload
 * starts hidden again.
 */
export const passwordVisible = signal(false);
