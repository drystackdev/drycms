import type { ComponentChildren } from "preact";
import { useDialogSync } from "./list-nav.js";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  /** Disables the confirm action until a dialog-specific condition is met. */
  confirmDisabled?: boolean;
  /** Styles the confirm button as destructive (red) - for actions like delete. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small, reusable confirm dialog - used both for the destructive-migration
 * warning (Content-Type Builder) and delete-content-type confirmation.
 * Native `<dialog>` + `useDialogSync`, same pattern `FileManager.tsx`'s own
 * dialogs and `ImageField.tsx` already use.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  confirmDisabled = false,
  destructive = false,
  onConfirm,
  onCancel,
  size = "md",
}: ConfirmDialogProps) {
  const ref = useDialogSync(open, onCancel);

  return (
    <dialog ref={ref} class={`${size}`} aria-label={title}>
      {open && (
        <>
          <header>
            <h3>{title}</h3>
          </header>
          <div class="confirm-dialog-body">{message}</div>
          <footer>
            <button type="button" class="outline" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              type="button"
              class={destructive ? "destructive" : undefined}
              disabled={busy || confirmDisabled}
              aria-busy={busy}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
