import { useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import type { FileManagerSource } from "../../storage/entry-types.js";
import ConfirmDialog from "../ConfirmDialog.js";
import { toast } from "../Toast.js";
import { replaceImageSource, type PastedImage } from "./pasted-images.js";

interface PastedImageDialogProps {
  image: PastedImage | null;
  remaining: number;
  source?: FileManagerSource;
  viewRef: RefObject<EditorView | null>;
  onDone: (uploaded: boolean) => void;
}

export default function PastedImageDialog({ image, remaining, source, viewRef, onDone }: PastedImageDialogProps) {
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!image || !viewRef.current) return;
    setBusy(true);
    try {
      let entry;
      if (image.file) {
        try {
          [entry] = (await source?.upload?.(null, [image.file])) ?? [];
        } catch {
          const dot = image.file.name.lastIndexOf(".");
          const stem = dot > 0 ? image.file.name.slice(0, dot) : image.file.name;
          const extension = dot > 0 ? image.file.name.slice(dot) : "";
          const renamed = new File([image.file], `${stem}-${Date.now()}${extension}`, { type: image.file.type });
          [entry] = (await source?.upload?.(null, [renamed])) ?? [];
        }
      } else {
        entry = await source?.importUrl?.(null, image.src);
      }
      if (!entry?.previewUrl) throw new Error("The uploaded image has no preview URL.");
      replaceImageSource(viewRef.current, image.src, entry.previewUrl, image.occurrence);
      onDone(true);
    } catch (error) {
      toast.add({ type: "error", title: error instanceof Error ? error.message : "Could not upload image." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={!!image}
      title="Upload pasted image"
      class="pasted-image-dialog"
      message={image && (
        <p>
          Upload <code>{image.file?.name ?? image.src}</code> to this entry?
          {remaining > 0 && <small> {remaining} more pasted {remaining === 1 ? "image" : "images"} will follow.</small>}
        </p>
      )}
      confirmLabel="Upload"
      cancelLabel="Keep link"
      busy={busy}
      confirmDisabled={!source?.upload || (!image?.file && !source?.importUrl)}
      onConfirm={() => void upload()}
      onCancel={() => onDone(false)}
    />
  );
}
