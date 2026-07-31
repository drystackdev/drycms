import { useState, useMemo } from 'preact/hooks';
import { h, Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import CodeBlock from './CodeBlock.js';
import { toast } from './Toast.js';
import * as BabelStandalone from '@babel/standalone';

interface Props {
  id: string;
  title: string;
  description?: string;
  code: string;
  /** Context object with state variables and setters that will be available to eval'd code */
  context: Record<string, any>;
  /** Render function that takes context and returns the preview JSX */
  renderPreview: (context: Record<string, any>) => ComponentChildren;
}

/** Editable showcase for field inputs: code can be edited live, preview updates via Babel JSX transform + eval */
export default function EditableDemo({
  id,
  title,
  description,
  code: initialCode,
  context,
  renderPreview,
}: Props) {
  const [editedCode, setEditedCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    // Only in dev: attempt to transform and eval edited code
    if (!import.meta.env.DEV) {
      return renderPreview(context);
    }

    // If code hasn't been edited from initial, use renderPreview
    if (editedCode === initialCode) {
      return renderPreview(context);
    }

    try {
      setError(null);
      // Transform JSX to JS using Babel
      const transformed = BabelStandalone.transform(editedCode, {
        presets: ['react'],
        filename: 'x.jsx',
      }).code;

      // Create function that returns the result
      // Pass context variables + React/Fragment (for JSX support) as parameters
      const contextVars = Object.keys(context);
      const contextValues = Object.values(context);

      // eslint-disable-next-line no-new-func
      const renderFn = new Function(
        'React',
        ...contextVars,
        `return (${transformed})`
      );
      // Pass Preact as React so JSX transform works (React.createElement → h)
      return renderFn({ createElement: h, Fragment }, ...contextValues);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error('EditableDemo transform error:', err);
      return renderPreview(context);
    }
  }, [editedCode, initialCode, context, renderPreview]);

  return (
    <section id={id} class="demo">
      <header>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>

      <div class="demo-preview">
        {error && (
          <div class="alert destructive" style={{ marginBottom: '1rem' }}>
            <strong>Error in code:</strong> {error}
          </div>
        )}
        {preview}
      </div>

      <div class="demo-code">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <span>Code</span>
          <button
            type="button"
            class="sm outline"
            onClick={() => {
              setEditedCode(initialCode);
              setError(null);
            }}
          >
            Reset
          </button>
        </div>
        <CodeBlock
          editable
          code={editedCode}
          onChange={(code) => {
            setEditedCode(code);
          }}
        />
      </div>
    </section>
  );
}
