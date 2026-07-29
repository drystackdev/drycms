import { useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import CheckField from "../components/CheckField.js";
import CodeBlock from "../components/CodeBlock.js";
import { createHttpFileSource } from "../components/file-manager-http-source.js";
import { ArrowLeftIcon } from "../components/icons.js";
import RichTextField from "../components/RichTextField.js";
import type { RichTextJSON } from "../components/RichTextField/useRichTextEditor.js";
import TextField from "../components/TextField.js";
import { useDocumentTitle } from "./page-common.js";

interface Preset {
  key: string;
  label: string;
  html: string;
}

/** Seed HTML for each "Load" button below - covers every mark/block
 * `RichTextField` round-trips (see `html.ts`) so a regression in any one of
 * them shows up immediately after a click, without hand-typing it first. */
const PRESETS: Preset[] = [
  { key: "empty", label: "Empty", html: "" },
  {
    key: "plain",
    label: "Plain paragraph",
    html: "<p>Just a plain paragraph of text, for testing basic typing and wrapping.</p>",
  },
  {
    key: "inline-mixed",
    label: "Mixed inline formats",
    html:
      "<p>This is <strong>bold</strong>, <em>italic</em>, <u>underline</u>, and " +
      "<strong><em><u>all three nested</u></em></strong> together, right next to plain text.</p>",
  },
  {
    key: "blocks",
    label: "Headings + quote",
    html:
      "<h2>Heading two</h2><h3>Heading three</h3><h4>Heading four</h4>" +
      "<blockquote>A quoted excerpt, to check blockquote styling.</blockquote>" +
      "<p>A regular paragraph after the quote.</p>",
  },
  {
    key: "color",
    label: "Colored text",
    html: '<p>Some <span style="color: #e11d48">red</span>, <span style="color: #2563eb">blue</span>, and unstyled text.</p>',
  },
  {
    key: "align",
    label: "Alignment",
    html:
      '<p style="text-align: center">Centered text.</p>' +
      '<p style="text-align: right">Right-aligned text.</p>' +
      '<p style="text-align: justify">Justified text runs long enough to actually wrap onto a second line, so the justification is visible.</p>',
  },
  {
    key: "image",
    label: "Image",
    html: "<p>An inline image, for testing insertion and drag-to-resize: <img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%232563eb'/%3E%3C/svg%3E\" alt=\"Placeholder rectangle\"></p>",
  },
  {
    key: "image-caption",
    label: "Captioned image",
    html:
      "<p><figure style=\"margin:0\"><img src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%232563eb'/%3E%3C/svg%3E\" alt=\"Placeholder rectangle\" style=\"object-fit:cover\">" +
      "<figcaption>A placeholder rectangle, for testing the figure/figcaption round trip.</figcaption></figure></p>",
  },
  {
    key: "long",
    label: "Long content",
    html:
      "<h2>A longer document</h2>" +
      "<p>Paragraph text to test scrolling and overflow behavior inside the editor surface.</p>".repeat(
        6,
      ),
  },
];

/**
 * A dedicated sandbox for `RichTextField`, split out of `Showcase.tsx` (which
 * still keeps its own smaller demo, for the general component catalog) - the
 * preset seeds and prop toggles below make it faster to poke at a specific
 * editor/toolbar state while building a new feature, without re-typing
 * content by hand every reload. Not linked from the sidebar; reach it at
 * `${path}/richtext-demo` or via the link on Showcase's "Rich text field" tab.
 */
export default function RichTextDemo() {
  useDocumentTitle("Rich text field demo");
  const { route } = useLocation();
  const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);

  const [seedHtml, setSeedHtml] = useState("");
  const [seedKey, setSeedKey] = useState(0);
  const loadPreset = (html: string) => {
    setSeedHtml(html);
    setSeedKey((key) => key + 1);
  };

  const [body, setBody] = useState("");
  const [json, setJson] = useState<RichTextJSON>();
  const jsonCode = useMemo(
    () => (json ? JSON.stringify(json, null, 2) : ""),
    [json],
  );

  const [label, setLabel] = useState("Body");
  const [placeholder, setPlaceholder] = useState("Write something…");
  const [helperText, setHelperText] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [required, setRequired] = useState(false);
  const [error, setError] = useState(false);
  const [inline, setInline] = useState(false);
  const [iconSize, setIconSize] = useState<"sm" | "md" | "lg" | "xl">("md");

  return (
    <div class="card">
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <button
            type="button"
            class="ghost sm"
            onClick={() => route(`${path}/showcase/richtext-field`)}
          >
            <ArrowLeftIcon /> Back to Showcase
          </button>
          <h1>Rich text field demo</h1>
          <p>
            Sandbox for building/testing RichTextField - load a preset, toggle
            props, watch both outputs live.
          </p>
        </div>
      </div>

      <div class="stack">
        <div class="stack">
          <div class="field">
            <label>Presets</label>
            <div class="row" style={{ flexWrap: "wrap" }}>
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.key}
                  class="outline sm"
                  onClick={() => loadPreset(preset.html)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div class="row" style={{ flexWrap: "wrap" }}>
            <TextField
              label="Label"
              value={label}
              onChange={setLabel}
              placeholder="Body"
            />
            <TextField
              label="Placeholder"
              value={placeholder}
              onChange={setPlaceholder}
              placeholder="Write something…"
            />
            <TextField
              label="Helper text"
              value={helperText}
              onChange={setHelperText}
              placeholder="Shown under the field"
            />
          </div>
          <div class="row" style={{ flexWrap: "wrap" }}>
            <CheckField
              label="Disabled"
              value={disabled}
              onChange={setDisabled}
              role="switch"
            />
            <CheckField
              label="Required"
              value={required}
              onChange={setRequired}
              role="switch"
            />
            <CheckField
              label="Error"
              value={error}
              onChange={setError}
              role="switch"
            />
            <CheckField
              label="Inline"
              description="Inline-only toolbar (Bold/Italic/Underline + undo/redo), no block/align/color menus."
              value={inline}
              onChange={setInline}
              role="switch"
            />
          </div>
          <div class="field">
            <label>Icon size</label>
            <div class="row" style={{ flexWrap: "wrap" }}>
              {(["sm", "md", "lg", "xl"] as const).map((size) => (
                <button
                  type="button"
                  key={size}
                  class={iconSize === size ? "sm" : "outline sm"}
                  aria-pressed={iconSize === size}
                  onClick={() => setIconSize(size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
        <RichTextField
          key={seedKey}
          label={label}
          value={seedHtml}
          onChange={setBody}
          json={undefined}
          onJsonChange={setJson}
          placeholder={placeholder}
          helperText={helperText || undefined}
          error={error}
          disabled={disabled}
          required={required}
          inline={inline}
          source={source}
          iconSize={iconSize}
        />

        <div class="grid cols-2" style={{ width: "100%" }}>
          <div>
            <div class="field">
              <label>Output (JSON)</label>
              <CodeBlock maxHeight="24rem" code={jsonCode} wrap copyable />
            </div>
          </div>
          <div>
            <div class="field">
              <label>Output (HTML)</label>
              <CodeBlock
                maxHeight="24rem"
                code={body}
                formatHtml
                wrap
                copyable
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
