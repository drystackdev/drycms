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
  /** Components to make available in eval scope (e.g., TextField, Button, etc.) */
  components?: Record<string, any>;
}

/** Editable showcase for field inputs: code can be edited live, preview updates via Babel JSX transform + eval */
export default function EditableDemo({
  id,
  title,
  description,
  code: initialCode,
  context,
  renderPreview,
  components = {},
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

      // Remove trailing semicolons and "use strict" from Babel output
      let cleanCode = transformed
        .replace(/^"use strict";\n/, '')
        .replace(/;$/, '');

      // Create function that returns the transformed code result
      // Pass context variables + components as parameters
      const contextVars = Object.keys(context);
      const componentNames = Object.keys(components);
      const allParams = ['React', ...componentNames, ...contextVars];
      const contextValues = Object.values(context);
      const componentValues = Object.values(components);

      // Babel transforms to React.createElement, we inject React=Preact
      // eslint-disable-next-line no-new-func
      const renderFn = new Function(
        ...allParams,
        `return (${cleanCode})`
      );

      // Pass Preact as React, plus all components and context
      return renderFn({ createElement: h, Fragment }, ...componentValues, ...contextValues);
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
