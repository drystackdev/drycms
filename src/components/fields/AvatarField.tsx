import { useRef, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import { readImageDimensions, renderResizedImage } from "../FileManager/file-manager-image-optimize.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import type { FileEntry, FileManagerSource } from "../../storage/entry-types.js";
import { randomUUID } from "../../lib/uuid.js";
import { CloseIcon, UsersIcon } from "../icons/index.js";

/** Longest side, in px, an avatar is downscaled to before upload - large
 * enough to cover the editor's 5rem (80px) circle at 2x device pixel ratio
 * without visibly blurring, small enough to keep the uploaded file tiny. */
const AVATAR_MAX_DIMENSION = 80;
const AVATAR_QUALITY = 1;

/** Fixed upload target - hidden from the Media browser (`isHiddenName` in
 * `storage/local.ts`/`storage/r2.ts`), see `field-registry.ts`'s
 * `avatarFieldType` doc comment. */
const AVATAR_FOLDER = ".avatar";

/** Resizes `file` down to `AVATAR_MAX_DIMENSION` on its longest side (aspect
 * ratio kept, no crop) and re-encodes as WebP at `AVATAR_QUALITY` - the
 * bytes actually uploaded to storage. */
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

/** `.avatar` may not exist yet (the very first avatar ever uploaded on this
 * instance) - `routes/storage.ts`'s upload handler 404s on a missing target
 * folder, so this creates it on that one failure and retries once, instead
 * of requiring every caller to pre-create it. Every later upload succeeds on
 * the first try. */
async function uploadToAvatarFolder(source: FileManagerSource, file: File): Promise<FileEntry[]> {
  const upload = source.upload;
  if (!upload) throw new Error("This source can't upload files.");
  try {
    return await upload(AVATAR_FOLDER, [file]);
  } catch {
    await source.createFolder?.(null, AVATAR_FOLDER).catch(() => undefined);
    return upload(AVATAR_FOLDER, [file]);
  }
}

export interface AvatarFieldProps extends FieldProps<string> {
  /** Where the resized image gets uploaded to (`.avatar/` folder) - same
   * storage backend `image`/`file` use. */
  source: FileManagerSource;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * Avatar picker: clicking goes straight to the OS file picker (no Media
 * Library dialog, unlike `ImageField`) - the chosen image is resized/
 * re-encoded client-side (see `resizeAvatarImage`) and uploaded straight to
 * the `.avatar` storage folder; the field's stored VALUE is the resulting
 * storage id, resolved to a URL for display via `resolveImageSrc` (see
 * `field-registry.ts`'s `avatarFieldType` doc comment).
 */
export default function AvatarField({
  value,
  onChange,
  source,
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
      const uploaded = new File([blob], `${randomUUID()}.webp`, { type: blob.type });
      const [entry] = await uploadToAvatarFolder(source, uploaded);
      if (!entry) throw new Error("Upload failed.");
      onChange(entry.id);
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
            <img class="avatar-field-thumb" src={resolveImageSrc(value)} alt="" />
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
