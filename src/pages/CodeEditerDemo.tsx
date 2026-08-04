import { useMemo, useState } from "preact/hooks";
import Editer from "../components/Editer.js";
import type { EditerResult } from "../components/Editer/types.js";
import { useDocumentTitle } from "./page-common.js";

const DEMO_FILE = "Demo.tsx";
const BUTTON_FILE = "Button.tsx";

const INITIAL_FILES: Record<string, string> = {
  [DEMO_FILE]: `import { useState } from "preact/hooks";
import Button from "./Button.tsx";

export default function Demo() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex items-center gap-2 p-4">
      <span>Count: {count}</span>
      <Button label="Increment" onClick={() => setCount(count + 1)} />
    </div>
  );
}
`,
  [BUTTON_FILE]:
    'export default function Button(props: { label: string; onClick?: () => void }) {\n  return <button onClick={props.onClick}>{props.label}</button>;\n}\n',
};

/**
 * Standalone sandbox for `Editer` (`plans/code-editer.md`) - not linked from
 * Showcase or anywhere else in the app (unlike `RichTextDemo`), reached only
 * at `${path}/code-editer-demo` directly.
 */
export default function CodeEditerDemo() {
  useDocumentTitle("Code editer demo");
  const [files, setFiles] = useState(INITIAL_FILES);
  const [activeFile, setActiveFile] = useState(DEMO_FILE);
  const [readOnly, setReadOnly] = useState(false);
  const [result, setResult] = useState<EditerResult>({
    code: INITIAL_FILES[DEMO_FILE]!,
    success: true,
    errors: [],
  });

  // The other open tabs' content, passed as `Editer`'s read-only cross-file
  // resolution context - the currently active tab is `Editer`'s own
  // `value`/`onChange`, not part of this. Note this means a tab can't be
  // imported by its own name *while* it's the active one (it only exists at
  // its real path again once you switch away) - a real limitation of
  // `ts-worker.ts` always compiling the active buffer as one fixed
  // `/main.tsx`, acceptable for a sandbox with two files that only import
  // in one direction.
  const extraFiles = useMemo(() => {
    const rest = { ...files };
    delete rest[activeFile];
    return rest;
  }, [files, activeFile]);

  function switchTab(file: string) {
    if (file === activeFile) return;
    setActiveFile(file);
    // Optimistic - the real diagnostics for the newly active file land ~300ms
    // later via `Editer`'s own debounce once its `extraFiles` prop change
    // triggers a resync (see `Editer.tsx`'s `extraFiles`-change effect).
    setResult((prev) => ({ ...prev, code: files[file] ?? "" }));
  }

  function handleChange(next: EditerResult) {
    setResult(next);
    setFiles((prev) => (prev[activeFile] === next.code ? prev : { ...prev, [activeFile]: next.code }));
  }

  return (
    <div class="card">
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Code editer demo</h1>
          <p>
            Sandbox for building/testing <code>Editer</code> - type TSX/Preact
            code below, watch type/syntax diagnostics and the raw{" "}
            <code>EditerResult</code> update live. Hover an identifier (or
            press <code>Mod+I</code> at the cursor) for Quick Info, type
            inside a call's parens for signature help, click a red/orange
            underline for quick fixes, and press <code>Shift+Alt+F</code> to
            format. <code>Ctrl/Cmd+F</code> opens find &amp; replace.
          </p>
        </div>
      </div>

      <div class="stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div role="tablist">
            {Object.keys(files).map((file) => (
              <button
                key={file}
                type="button"
                role="tab"
                aria-selected={activeFile === file}
                onClick={() => switchTab(file)}
              >
                {file}
              </button>
            ))}
          </div>
          <div class="field inline">
            <input
              id="code-editer-readonly"
              type="checkbox"
              role="switch"
              checked={readOnly}
              onChange={(event) => setReadOnly((event.target as HTMLInputElement).checked)}
            />
            <label for="code-editer-readonly">Read-only</label>
          </div>
        </div>

        <div style={{ height: "60vh" }}>
          {/* `readOnly` is set once at mount (see `Editer.tsx`) - remount on toggle via `key`. */}
          <Editer key={String(readOnly)} value={result.code} onChange={handleChange} extraFiles={extraFiles} readOnly={readOnly} />
        </div>

        <div class="field">
          <label>
            Diagnostics ({result.errors.length}) -{" "}
            {result.success ? "success" : "syntax error"}
          </label>
          <pre class="language-json">
            <code>{JSON.stringify(result, null, 2)}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
