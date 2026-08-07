import { useId, useState } from "preact/hooks";
import FileManager, { type FileManagerProps } from "./FileManager.js";
import type { FileManagerSource } from "../../storage/entry-types.js";

export interface EntryScopedPickerProps extends Omit<FileManagerProps, "source"> {
  /** The full, unscoped source - what every picker showed before this
   * component existed. */
  fullSource: FileManagerSource;
  /** Sandboxed to the current entry's own media folder
   * (`storage/scoped-source.ts`'s `scopeFileSource`) - when present, an
   * "Entry" tab (selected by default) is shown alongside "Media". When
   * absent (no `features.slug` on the current content type, or no entry
   * context at all - see `entry-media-context.ts`), this renders exactly
   * like a bare `FileManager` always has, tab-free. */
  entrySource?: FileManagerSource;
}

/**
 * Adds the "Entry" tab (`entry/<slug>/`, first) in front of the full Media
 * browser to a `FileManager`-backed picker, reusing the same hand-rolled
 * `role="tablist"`/`role="tabpanel"` markup `ImageField.tsx`'s own File/Link
 * tabs already use. Shared by `FileField`/`ImageField`/RichText's
 * "Replace image" dialog so all three pickers gain the tab identically.
 */
export default function EntryScopedPicker({ fullSource, entrySource, ...fileManagerProps }: EntryScopedPickerProps) {
  const reactId = useId();
  const [activeTab, setActiveTab] = useState<"entry" | "media">("entry");

  if (!entrySource) return <FileManager source={fullSource} {...fileManagerProps} />;

  return (
    <>
      <div role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "entry"}
          aria-controls={`${reactId}-tab-entry`}
          onClick={() => setActiveTab("entry")}
        >
          Entry
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "media"}
          aria-controls={`${reactId}-tab-media`}
          onClick={() => setActiveTab("media")}
        >
          Media
        </button>
      </div>
      {/* Only the active tab's `FileManager` is mounted (not just hidden) -
          each mount does its own `list()`/`listAll()` fetch, and there's no
          reason to pay for both up front when a picker is opened. */}
      {activeTab === "entry" ? (
        <div role="tabpanel" id={`${reactId}-tab-entry`}>
          <FileManager source={entrySource} {...fileManagerProps} />
        </div>
      ) : (
        <div role="tabpanel" id={`${reactId}-tab-media`}>
          <FileManager source={fullSource} {...fileManagerProps} />
        </div>
      )}
    </>
  );
}
