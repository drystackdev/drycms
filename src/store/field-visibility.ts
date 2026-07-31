import { signal } from "@preact/signals";

/**
 * Shared "reveal" toggle for every `PasswordField` on the page - flipping
 * one instance shows them all for the rest of this session; unlike
 * `collapsed` in `store/dashboard.ts` this isn't persisted, so a reload
 * starts hidden again. `SecretField` gets its own independent signal below,
 * so revealing one kind never reveals the other.
 */
export const passwordVisible = signal(false);

/** Same idea as `passwordVisible`, for `SecretField` (multiline) instances. */
export const secretVisible = signal(false);
