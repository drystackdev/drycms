import { useId, useState } from "preact/hooks";
import FileManager, { type FileManagerProps } from "./FileManager.js";
import type { FileManagerSource } from "../../storage/entry-types.js";
import TextField from "../fields/TextField.js";

export interface EntryScopedPickerLink {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface EntryScopedPickerProps extends Omit<FileManagerProps, "source"> {
  /** The full, unscoped source - what every picker showed before this
   * component existed. */
  fullSource: FileManagerSource;
  /** Sandboxed to the current entry's own media folder
   * (`storage/scoped-source.ts`'s `scopeFileSource`) - when present, an
   * "Entry" tab (selected by default) is shown alongside "File". When
   * absent (no `features.slug` on the current content type, or no entry
   * context at all - see `entry-media-context.ts`), this renders exactly
   * like a bare `FileManager` always has, tab-free. */
  entrySource?: FileManagerSource;
  /** Adds a third "Link" tab for typing/pasting a raw external image URL -
   * mirrors `ImageField.tsx`'s own Link tab, simplified to a single URL
   * (every current caller here is a single-image picker, unlike
   * `ImageField`'s multi-value list). Omitted entirely (no tab, `FileField`'s
   * picker) unless the caller opts in. */
  link?: EntryScopedPickerLink;
}

/**
 * Adds the "Entry" tab (`entry/<slug>/`, first) in front of the full Media
 * browser - and optionally a "Link" tab - to a `FileManager`-backed picker,
 * reusing the same hand-rolled `role="tablist"`/`role="tabpanel"` markup
 * `ImageField.tsx`'s own File/Link tabs already use (tab labels/order now
 * match that field's exactly: Entry/File/Link). Shared by `FileField`/
 * RichText's image insert+replace dialogs so they all gain the tab
 * identically; `ImageField` itself still hand-rolls its own (it needs a
 * multi-value Link list, not a single URL).
 */
export default function EntryScopedPicker({ fullSource, entrySource, link, ...fileManagerProps }: EntryScopedPickerProps) {
  const reactId = useId();
  // A pre-filled `value` (a caller reopening the picker onto its current
  // selection, e.g. `image-menu.tsx`'s `openReplace`) is always in
  // `fullSource`'s own id-space, never `entrySource`'s scoped one - so it
  // only ever resolves under "File", regardless of whether "Entry" would
  // otherwise be the default. Only the truly-empty case (a fresh insert)
  // falls back to preferring "Entry" when it's available.
  const hasFileValue = Array.isArray(fileManagerProps.value)
    ? fileManagerProps.value.length > 0
    : !!fileManagerProps.value;
  const [activeTab, setActiveTab] = useState<"entry" | "file" | "link">(
    link?.value ? "link" : hasFileValue ? "file" : entrySource ? "entry" : "file",
  );

  if (!entrySource && !link) return <FileManager source={fullSource} {...fileManagerProps} />;

  return (
    <>
      <div role="tablist">
        {entrySource && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "entry"}
            aria-controls={`${reactId}-tab-entry`}
            onClick={() => setActiveTab("entry")}
          >
            Entry
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "file"}
          aria-controls={`${reactId}-tab-file`}
          onClick={() => setActiveTab("file")}
        >
          File
        </button>
        {link && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "link"}
            aria-controls={`${reactId}-tab-link`}
            onClick={() => setActiveTab("link")}
          >
            Link
          </button>
        )}
      </div>
      {/* Only the active tab's `FileManager` is mounted (not just hidden) -
          each mount does its own `list()`/`listAll()` fetch, and there's no
          reason to pay for both up front when a picker is opened. */}
      {activeTab === "entry" && entrySource ? (
        <div role="tabpanel" id={`${reactId}-tab-entry`}>
          <FileManager source={entrySource} {...fileManagerProps} />
        </div>
      ) : activeTab === "file" ? (
        <div role="tabpanel" id={`${reactId}-tab-file`}>
          <FileManager source={fullSource} {...fileManagerProps} />
        </div>
      ) : link ? (
        <div role="tabpanel" id={`${reactId}-tab-link`}>
          <TextField
            label="Image URL"
            type="url"
            value={link.value}
            onChange={link.onChange}
            placeholder={link.placeholder ?? "https://example.com/image.jpg"}
          />
        </div>
      ) : null}
    </>
  );
}
