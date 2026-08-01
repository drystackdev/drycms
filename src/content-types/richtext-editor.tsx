import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";
import type { RichTextFieldProps } from "../components/RichTextField.js";

/** Keeps the schema registry usable from server/engine code and tests. The
 * real editor imports the client-only virtual config module, so it must not
 * be part of the registry's eager dependency graph. */
export default function RichTextEditor(props: RichTextFieldProps) {
  const [Editor, setEditor] = useState<ComponentType<RichTextFieldProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("../components/RichTextField.js").then(({ default: editor }) => {
      if (!cancelled) setEditor(() => editor);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Editor ? <Editor {...props} /> : null;
}
