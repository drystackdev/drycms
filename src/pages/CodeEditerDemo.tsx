import { useState } from "preact/hooks";
import Editer from "../components/Editer.js";
import type { EditerResult } from "../components/Editer/types.js";
import { useDocumentTitle } from "./page-common.js";

const INITIAL_CODE = `export default function Demo() {
  return <div className="flex items-center gap-2 p-4">Hello</div>;
}
`;

/**
 * Standalone sandbox for `Editer` (`plans/code-editer.md`) - not linked from
 * Showcase or anywhere else in the app (unlike `RichTextDemo`), reached only
 * at `${path}/code-editer-demo` directly.
 */
export default function CodeEditerDemo() {
  useDocumentTitle("Code editer demo");
  const [result, setResult] = useState<EditerResult>({
    code: INITIAL_CODE,
    success: true,
    errors: [],
  });

  return (
    <div class="card">
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Code editer demo</h1>
          <p>
            Sandbox for building/testing <code>Editer</code> - type TSX/Preact
            code below, watch type/syntax diagnostics and the raw{" "}
            <code>EditerResult</code> update live.
          </p>
        </div>
      </div>

      <div class="stack">
        <div style={{ height: "60vh" }}>
          <Editer
            value={result.code}
            onChange={setResult}
            extraFiles={{
              "./Button.tsx":
                'export default function Button(props: { label: string }) {\n  return <button>{props.label}</button>;\n}\n',
            }}
          />
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
