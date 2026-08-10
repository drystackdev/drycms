import { useRef, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import { readImageDimensions, renderResizedImage } from "../FileManager/file-manager-image-optimize.js";
import { CloseIcon, UsersIcon } from "../icons/index.js";

/** Longest side, in px, an avatar is downscaled to before storage - still
 * tiny since the whole point of this field (unlike `image`) is storing the
 * pixels themselves as a base64 string directly in the DB row, no separate
 * file/storage record, but large enough to cover the editor's 5rem (80px)
 * circle at 2x device pixel ratio without visibly blurring. */
const AVATAR_MAX_DIMENSION = 80;
const AVATAR_QUALITY = 1;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
}

/** Resizes `file` down to `AVATAR_MAX_DIMENSION` on its longest side
 * (aspect ratio kept, no crop), re-encodes as WebP at `AVATAR_QUALITY`, and
 * returns the result as a `data:image/webp;base64,...` string - the field's
 * stored VALUE, unlike `image`/`file` which store a storage-backed id/path
 * (see `field-registry.ts`'s `avatarFieldType` doc comment). */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const { width, height } = await readImageDimensions(file);
  const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const blob = await renderResizedImage(file, {
    width: targetWidth,
    height: targetHeight,
    format: "webp",
    quality: AVATAR_QUALITY,
  });
  return blobToDataUrl(blob);
}

export interface AvatarFieldProps extends FieldProps<string> {
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * Avatar picker: clicking goes straight to the OS file picker (no Media
 * Library dialog, unlike `ImageField`) - the chosen image is resized/
 * re-encoded client-side (see `fileToAvatarDataUrl`) and stored inline as a
 * base64 data URL, so nothing ever touches file storage.
 */
export default function AvatarField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: AvatarFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fieldId = id ?? `avatar-field-${name ?? "value"}`;

  const openPicker = () => {
    if (disabled || busy) return;
    inputRef.current?.click();
  };

  const handleFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setLocalError(null);
    try {
      onChange(await fileToAvatarDataUrl(file));
    } catch {
      setLocalError("Could not process this image.");
    } finally {
      setBusy(false);
    }
  };

  const shownHelperText = localError ?? helperText;
  const shownIsError = !!localError || error;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="avatar-field-box">
        {value ? (
          <>
            <img class="avatar-field-thumb" src={value} alt="" />
            <button
              id={fieldId}
              type="button"
              class="avatar-field-overlay"
              disabled={disabled || busy}
              aria-label="Change avatar"
              onClick={openPicker}
            />
            <button
              type="button"
              class="avatar-field-remove ghost icon sm"
              disabled={disabled || busy}
              aria-label="Remove avatar"
              onClick={(event) => {
                event.stopPropagation();
                onChange("");
              }}
            >
              <CloseIcon />
            </button>
          </>
        ) : (
          <button
            id={fieldId}
            type="button"
            class="avatar-field-empty"
            disabled={disabled || busy}
            onClick={openPicker}
          >
            <UsersIcon />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        class="avatar-field-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFile}
      />
      {name && <input type="hidden" name={name} value={value} />}
      {busy && (
        <small class="hint">Processing…</small>
      )}
      {shownHelperText && <span class={shownIsError ? "error" : "hint"}>{shownHelperText}</span>}
    </div>
  );
}
