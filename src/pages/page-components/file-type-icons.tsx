/**
 * Icons from Iconify's Material Icon Theme set
 * (https://icon-sets.iconify.design/material-icon-theme/, prefix
 * `material-icon-theme`), hand-copied as local components rather than
 * fetched at runtime - same "no runtime icon-library dependency" pattern
 * this codebase already uses for hand-drawn icons (e.g. `PageEditor.tsx`'s
 * `ReloadIcon`/`HistoryIcon`), just sourced from a real icon set instead of
 * drawn from scratch. Shared between `ComponentTreePanel.tsx` (file tree
 * rows) and `PageEditor.tsx` (source-root switcher, code-editor toggle) -
 * having two-plus call sites is what promoted these out of being file-local
 * one-offs. Colors are the set's own per-language colors, left un-themed
 * (`currentColor` would lose the whole point of a multi-color file-type
 * icon set).
 */

export function FolderBaseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#8d6e63" d="m6.922 3.768l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232" />
      <path fill="#d7ccc8" d="M7.5 11c-.277 0-.5.223-.5.5v2c0 .277.223.5.5.5h8c.277 0 .5-.223.5-.5v-2c0-.277-.223-.5-.5-.5Z" />
    </svg>
  );
}

export function FolderBaseOpenIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="#8d6e63"
        d="M14.483 6H4.721a1 1 0 0 0-.949.684L2 12V5h12a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11l2.403-5.606A1 1 0 0 0 14.483 6"
      />
      <path fill="#d7ccc8" d="M7.5 11c-.277 0-.5.223-.5.5v2c0 .277.223.5.5.5h8c.277 0 .5-.223.5-.5v-2c0-.277-.223-.5-.5-.5Z" />
    </svg>
  );
}

/** "routes" folder, for the Page source root (`PAGES_ROOT`) - its files are
 * `page.tsx`/`layout.tsx`/route folders. */
export function FolderRoutesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#43a047" d="m6.922 3.768l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232" />
      <path
        fill="#c8e6c9"
        d="M8.707 7.293L10 6H6v4l1.293-1.293l2.455 2.455a.85.85 0 0 1 .252.608V14h2v-2.23a2.84 2.84 0 0 0-.838-2.022ZM14.68 6l-2.805 2.465l.285.285a2.8 2.8 0 0 1 .78 1.445L16 7.505Z"
      />
    </svg>
  );
}

/** For the Component source root (`COMPONENT_ROOT`). */
export function FolderComponentsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#c0ca33" d="m6.922 3.768l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232" />
      <path fill="#f0f4c3" d="M6 10h4v4H6zm5 0h4v4h-4zM6 5h4v4H6zm4.172 2L13 4.172L15.829 7L13 9.829z" />
    </svg>
  );
}

/** For the Styles source root (`STYLES_ROOT`) - holds `globals.css`. */
export function FolderCssIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#7e57c2" d="m6.922 3.768l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232" />
      <path
        fill="#d1c4e9"
        d="M7 10V9H6v4h1v-1h1v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1Zm5 0V9a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1c0 .42.179 1.17 1.373 1.483c.346.092.627.323.627.517v1h-1v-1H9v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1.67 1.67 0 0 0-1.373-1.483C10 10.352 10 10.097 10 10V9h1v1Zm4 0V9a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1c0 .42.179 1.17 1.373 1.483c.346.092.627.323.627.517v1h-1v-1h-1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1a1.67 1.67 0 0 0-1.373-1.483C14 10.352 14 10.097 14 10V9h1v1Z"
      />
    </svg>
  );
}

export function ReactTsFileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#0288d1" d="M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4s-12-2.59-12-4s4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6s14-2.686 14-6s-6.268-6-14-6" />
      <path fill="#0288d1" d="M16 14a2 2 0 1 0 2 2a2 2 0 0 0-2-2" />
      <path
        fill="#0288d1"
        d="M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493c3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124c-3.284-5.69-7.72-9.493-10.74-9.493Z"
      />
      <path
        fill="#0288d1"
        d="M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393c-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369"
      />
    </svg>
  );
}

export function TypescriptFileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="#0288d1"
        d="M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"
      />
    </svg>
  );
}

export function CssFileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="#7e57c2"
        d="M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034"
      />
      <path
        fill="#7e57c2"
        d="M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"
      />
    </svg>
  );
}

export function JsonFileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 -960 960 960" aria-hidden="true">
      <path
        fill="#f9a825"
        d="M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z"
      />
    </svg>
  );
}

export function MarkdownFileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#42a5f5" d="m14 10l-4 3.5L6 10H4v12h4v-6l2 2l2-2v6h4V10zm12 6v-6h-4v6h-4l6 8l6-8z" />
    </svg>
  );
}

/** Fallback for any extension the map below doesn't recognize - the Material
 * Icon Theme set has no generic "blank file" icon of its own; `document` is
 * the icon it uses for the same fallback role. */
export function DocumentFileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#42a5f5" d="M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z" />
    </svg>
  );
}

/** Extension -> icon, shared by the tree's create-row preview, the tree
 * rows themselves, and the code-editor toggle button (which reflects
 * whatever file is currently open for editing). */
export function fileIconForName(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "tsx":
      return <ReactTsFileIcon />;
    case "ts":
      return <TypescriptFileIcon />;
    case "css":
      return <CssFileIcon />;
    case "json":
      return <JsonFileIcon />;
    case "md":
      return <MarkdownFileIcon />;
    default:
      return <DocumentFileIcon />;
  }
}
