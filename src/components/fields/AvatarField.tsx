import { useRef, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import {
  readImageDimensions,
  renderResizedImage,
} from "../FileManager/file-manager-image-optimize.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { CloseIcon, UsersIcon } from "../icons/index.js";

/** Longest side, in px, an avatar is downscaled to before upload - large
 * enough to cover the editor's 5rem (80px) circle at 2x device pixel ratio
 * without visibly blurring, small enough to keep the uploaded file tiny. */
const AVATAR_MAX_DIMENSION = 120;
const AVATAR_QUALITY = 1;

/** Fixed upload target - hidden from the Media browser (`isHiddenName` in
 * `storage/local.ts`/`storage/r2.ts`), see `field-registry.ts`'s
 * `avatarFieldType` doc comment. */
const AVATAR_FOLDER = ".avatar";

/** Resizes `file` down to `AVATAR_MAX_DIMENSION` on its longest side (aspect
 * ratio kept, no crop) and re-encodes as WebP at `AVATAR_QUALITY` - the
 * bytes that eventually get uploaded to storage. */
async function resizeAvatarImage(file: File): Promise<Blob> {
  const { width, height } = await readImageDimensions(file);
  const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  return renderResizedImage(file, {
    width: targetWidth,
    height: targetHeight,
    format: "webp",
    quality: AVATAR_QUALITY,
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Not a data URL.");
  const [, mime, base64] = match;
  const binary = atob(base64!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** One fixed path per user (`.avatar/<userId>.webp`), not a fresh random
 * name per upload - so picking a new avatar overwrites the same file
 * instead of leaving the previous pick behind under a different name. */
function avatarPathFor(userId: number | string): string {
  return `${AVATAR_FOLDER}/${userId}.webp`;
}

/** `.avatar` may not exist yet (the very first avatar ever uploaded on this
 * instance) - `routes/storage.ts`'s PUT handler 404s on a missing target
 * folder, so this creates it on that one failure and retries once, instead
 * of requiring every caller to pre-create it. Every later write succeeds on
 * the first try. PUT (not POST) on purpose: it overwrites in place, where
 * `upload()` would 409 on the second avatar for the same user. */
async function replaceInAvatarFolder(
  source: FileManagerSource,
  path: string,
  file: File,
) {
  const replace = source.replace;
  if (!replace) throw new Error("This source can't replace files.");
  try {
    return await replace(path, file);
  } catch {
    await source.createFolder?.(null, AVATAR_FOLDER).catch(() => undefined);
    return replace(path, file);
  }
}

/** `true` for a freshly-picked, not-yet-saved avatar (a local `data:` preview
 * - see `AvatarField`'s own doc comment) as opposed to an already-uploaded
 * storage id. Exported so callers can tell without re-implementing the
 * check. */
export function isPendingAvatarValue(value: string): boolean {
  return value.startsWith("data:");
}

/**
 * Uploads a pending avatar (see `isPendingAvatarValue`) to
 * `.avatar/<userId>.webp` and returns the resulting storage id; an already-
 * uploaded value (or `""`) passes through unchanged. Call this right before
 * actually saving the form that holds the field's value (`Profile.tsx`'s
 * `handleSubmit`, `ContentEntryEditor.tsx`'s `handleSave`) - picking a new
 * avatar only touches storage once, at that point, not on every pick.
 * `userId` should identify the SAME user consistently across call sites
 * (`Profile.tsx` uses its own numeric `AuthUser.id`; `ContentEntryEditor.tsx`
 * uses the row's hashed `entryId` - both stable per row, just not the same
 * string as each other for the same user).
 */
export async function commitPendingAvatar(
  source: FileManagerSource,
  value: string,
  userId: number | string,
): Promise<string> {
  if (!isPendingAvatarValue(value)) return value;
  const blob = dataUrlToBlob(value);
  const uploaded = new File([blob], `${userId}.webp`, { type: blob.type });
  const entry = await replaceInAvatarFolder(
    source,
    avatarPathFor(userId),
    uploaded,
  );
  return entry.id;
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
 * re-encoded client-side (see `resizeAvatarImage`) and held as a local
 * `data:` preview only; nothing is uploaded yet at this point. The field's
 * VALUE is either that pending `data:` URL (rendered directly) or an
 * already-uploaded storage id (resolved to a URL via `resolveImageSrc`) -
 * the surrounding form is responsible for calling `commitPendingAvatar` on
 * save to turn the former into the latter before it reaches the server (see
 * `field-registry.ts`'s `avatarFieldType` doc comment).
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
      const blob = await resizeAvatarImage(file);
      onChange(await blobToDataUrl(blob));
    } catch {
      setLocalError("Could not process this image.");
    } finally {
      setBusy(false);
    }
  };

  const shownHelperText = localError ?? helperText;
  const shownIsError = !!localError || error;
  const previewSrc = value
    ? isPendingAvatarValue(value)
      ? value
      : resolveImageSrc(value)
    : undefined;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="avatar-field-box">
        {previewSrc ? (
          <>
            <img class="avatar-field-thumb" src={previewSrc} alt="" />
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
      {busy && <small class="hint">Processing…</small>}
      {shownHelperText && (
        <span class={shownIsError ? "error" : "hint"}>{shownHelperText}</span>
      )}
    </div>
  );
}
