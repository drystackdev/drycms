/**
 * Sample data and copy-paste code snippets for the /showcase page. Pulled out
 * of showcase.astro so that file stays focused on markup/behaviour.
 */
import type { DataTableColumn } from "../components/DataTable.js";

export interface ShowcaseItem {
  id: string;
  label: string;
}

export interface ShowcaseGroup {
  label: string;
  items: ShowcaseItem[];
}

export const intents = [
  "primary",
  "secondary",
  "info",
  "success",
  "warning",
  "error",
] as const;
export const greys = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Sidebar + tab order. Flattened at runtime for Previous/Next navigation. */
export const groups: ShowcaseGroup[] = [
  {
    label: "Foundations",
    items: [
      { id: "colors", label: "Colors" },
      { id: "typography", label: "Typography" },
      { id: "icons", label: "Icons" },
      { id: "layout", label: "Layout" },
    ],
  },
  {
    label: "Actions",
    items: [
      { id: "buttons", label: "Buttons" },
      { id: "button-variants", label: "Button variants" },
      { id: "button-states", label: "Button states" },
    ],
  },
  {
    label: "Data display",
    items: [
      { id: "cards", label: "Cards" },
      { id: "badges", label: "Badges" },
      { id: "alerts", label: "Alerts" },
      { id: "table", label: "Table" },
      { id: "avatar", label: "Avatar" },
      { id: "progress", label: "Progress" },
      { id: "progress-circle", label: "Progress circle" },
      { id: "skeleton", label: "Skeleton" },
      { id: "empty", label: "Empty state" },
    ],
  },
  {
    label: "Inputs",
    items: [
      { id: "text-inputs", label: "Text inputs" },
      { id: "select", label: "Select & textarea" },
      { id: "toggles", label: "Checkbox, radio & switch" },
      { id: "other-inputs", label: "Range, color, file" },
      { id: "fields", label: "Fields & validation" },
    ],
  },
  {
    label: "Navigation",
    items: [
      { id: "tabs", label: "Tabs" },
      { id: "accordion", label: "Accordion" },
      { id: "breadcrumb", label: "Breadcrumb" },
      { id: "tooltip", label: "Tooltip" },
      { id: "separator", label: "Separator" },
    ],
  },
  {
    label: "Overlays & islands",
    items: [
      { id: "dialog", label: "Dialog" },
      { id: "toast", label: "Toast" },
      { id: "popover", label: "Popover" },
      { id: "datatable", label: "DataTable" },
      { id: "custom-select", label: "Select" },
      { id: "combobox", label: "Combobox" },
      { id: "multi-select", label: "Multi-select" },
      { id: "islands", label: "Theme & sidebar" },
    ],
  },
  {
    label: "File manager",
    items: [
      { id: "file-manager", label: "File manager" },
      { id: "file-manager-single", label: "Image picker (single)" },
      { id: "file-manager-multi", label: "Image picker (multi)" },
    ],
  },
];

export const collectionOptions = [
  { value: "blog", label: "Blog" },
  { value: "docs", label: "Docs" },
  { value: "changelog", label: "Changelog" },
  { value: "roadmap", label: "Roadmap" },
  { value: "design", label: "Design system" },
  { value: "marketing", label: "Marketing", disabled: true },
];

export const tableRows = [
  {
    name: "Getting started",
    collection: "docs",
    status: "Published",
    size: 12,
  },
  { name: "Design tokens", collection: "docs", status: "Published", size: 8 },
  { name: "Roadmap 2026", collection: "blog", status: "Draft", size: 24 },
  { name: "Release 0.0.1", collection: "blog", status: "Review", size: 4 },
  { name: "Attribute CSS", collection: "blog", status: "Published", size: 16 },
  { name: "Migrating", collection: "docs", status: "Draft", size: 6 },
];

export const tableColumns: DataTableColumn<(typeof tableRows)[number]>[] = [
  { key: "name", label: "Name" },
  { key: "collection", label: "Collection" },
  { key: "status", label: "Status" },
  { key: "size", label: "Size", numeric: true },
];

export function statusVariant(status: string) {
  if (status === "Published") return "success";
  if (status === "Draft") return "warning";
  return "info";
}

export const code: Record<string, string> = {
  colors: `<span class="badge info">Info</span>
<span class="badge success">Success</span>
<span class="badge warning">Warning</span>
<span class="badge destructive">Destructive</span>

/* Override any token */
.dry {
  --dry-primary: #00A76F;
  --dry-radius: 0.5rem;
}`,
  typography: `<h1>Heading 1</h1>
<h2>Heading 2</h2>
<h3>Heading 3</h3>
<p>Body text sits at 14px with a 1.5 line height.</p>
<small>Small text is muted by default.</small>
<p>Inline <code>code</code>, a <kbd>Ctrl</kbd> key, and a <a href="#colors" class="underline">link</a>.</p>
<blockquote>Bare tags first, classes only when there's no real attribute.</blockquote>`,
  icons: `import Icon from 'drycms/components/Icon';
import { SettingsIcon } from 'drycms/components/icons';

<Icon name="Dashboard" />
<Icon name="Settings" size="2rem" />
<SettingsIcon />`,
  layout: `<div class="grid cols-4">
  <article class="card"><span class="metric">128</span><small>Entries</small></article>
  <!-- …3 more cards -->
</div>
<div class="row justify-between">
  <span class="muted">.row.justify-between</span>
  <span class="mono">0.0.1</span>
</div>`,
  buttons: `<button type="button" class="sm">Small</button>
<button type="button">Default</button>
<button type="button" class="lg">Large</button>
<button type="button" class="icon" aria-label="Settings">
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">…</svg>
</button>
<button type="button" class="block">Full width</button>`,
  buttonVariants: `<button type="button">Default</button>
<button type="button" class="secondary">Secondary</button>
<button type="button" class="outline">Outline</button>
<button type="button" class="ghost">Ghost</button>
<button type="button" class="link">Link</button>
<button type="button" class="destructive">Destructive</button>
<button type="button" class="info">Info</button>
<button type="button" class="success">Success</button>
<button type="button" class="warning">Warning</button>

<!-- Soft fill of the same intent -->
<button type="button" class="soft">Soft</button>
<button type="button" class="soft destructive">Soft destructive</button>
<button type="button" class="soft info">Soft info</button>
<button type="button" class="soft success">Soft success</button>
<button type="button" class="soft warning">Soft warning</button>`,
  buttonStates: `<button type="button" disabled>Disabled</button>
<button type="button" class="outline" disabled>Disabled outline</button>
<button type="button" aria-busy="true">Saving</button>
<a role="button" class="outline" href="#button-states">Link as button</a>`,
  cards: `<article class="card">
  <header>
    <h3>Standard card</h3>
    <p>Header, body and footer are plain child elements.</p>
  </header>
  <p>Padding, radius and elevation come from the stylesheet.</p>
  <footer>
    <button type="button" class="sm">Save</button>
    <button type="button" class="sm outline">Cancel</button>
  </footer>
</article>

<!-- Edge-to-edge body -->
<article class="card flush">
  <header>
    <h3>Flush card</h3>
    <p>Body runs edge to edge - good for tables.</p>
  </header>
  <footer>
    <span class="muted">.card.flush</span>
  </footer>
</article>`,
  badges: `<span class="badge">Default</span>
<span class="badge secondary">Secondary</span>
<span class="badge outline">Outline</span>
<span class="badge info">Info</span>
<span class="badge success">Success</span>
<span class="badge warning">Warning</span>
<span class="badge destructive">Destructive</span>

<!-- Solid instead of soft -->
<span class="badge filled">Default</span>
<span class="badge filled info">Info</span>`,
  alerts: `<div class="alert">
  <h4>Heads up</h4>
  <p>This dashboard ships with sample data until a content source is wired up.</p>
</div>

<div class="alert success">
  <h4>Published</h4>
  <p>Your entry is now live.</p>
</div>
<div class="alert warning">…</div>
<div class="alert destructive">…</div>`,
  table: `<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Collection</th>
      <th>Status</th>
      <th class="numeric">Size</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Getting started</td>
      <td>docs</td>
      <td><span class="badge success">Published</span></td>
      <td class="numeric">12 KB</td>
    </tr>
    <!-- …3 more rows -->
  </tbody>
</table>`,
  avatar: `<span class="avatar sm">SM</span>
<span class="avatar">KT</span>
<span class="avatar lg">LG</span>`,
  progress: `<progress value="72" max="100"></progress>
<progress value="28" max="100"></progress>
<progress></progress>`,
  progressCircle: `<progress value="72" max="100" class="circle" style="--value: 72"></progress>
<progress value="28" max="100" class="circle" style="--value: 28"></progress>
<progress class="circle"></progress>`,
  skeleton: `<span class="skeleton" style="height: 3rem; width: 3rem; border-radius: 50%"></span>
<span class="skeleton" style="height: 0.75rem; width: 12rem"></span>
<span class="skeleton" style="height: 0.75rem; width: 8rem"></span>`,
  empty: `<div class="empty">
  <strong>No entries yet</strong>
  <small>Create your first entry to get started.</small>
  <button type="button" class="sm">New entry</button>
</div>`,
  textInputs: `<input type="text" class="sm" placeholder="Small" />
<input type="text" placeholder="Default" />
<input type="text" class="lg" placeholder="Large" />
<input type="search" placeholder="Search entries" />
<input type="text" value="Read only" readonly />
<input type="text" placeholder="Disabled" disabled />`,
  select: `<select>
  <option>blog</option>
  <option>docs</option>
  <option>changelog</option>
</select>

<textarea placeholder="Write something…"></textarea>`,
  toggles: `<div class="field inline">
  <input id="sc-check-1" type="checkbox" checked />
  <label for="sc-check-1">Checked</label>
</div>
<div class="field inline">
  <input id="sc-check-2" type="checkbox" />
  <label for="sc-check-2">Unchecked</label>
</div>
<div class="field inline">
  <input id="sc-radio-1" type="radio" name="sc-radio" checked />
  <label for="sc-radio-1">Option A</label>
</div>
<div class="field inline">
  <input id="sc-radio-2" type="radio" name="sc-radio" />
  <label for="sc-radio-2">Option B</label>
</div>
<div class="field inline">
  <input id="sc-switch-1" type="checkbox" role="switch" checked />
  <label for="sc-switch-1">On</label>
</div>
<div class="field inline">
  <input id="sc-switch-2" type="checkbox" role="switch" />
  <label for="sc-switch-2">Off</label>
</div>`,
  otherInputs: `<input type="range" value="60" style="--value: 60" />
<input type="color" value="#00a76f" />
<input type="file" />`,
  fields: `<div class="field">
  <label for="sc-title">Title</label>
  <input id="sc-title" type="text" value="Getting started" />
  <span class="hint">Shown in listings and search results.</span>
</div>

<div class="field">
  <label for="sc-slug">Slug</label>
  <input id="sc-slug" type="text" aria-invalid="true" value="" />
  <span class="error">Slug is required.</span>
</div>

<fieldset>
  <legend>Publishing</legend>
  <div class="field inline">
    <input id="sc-pub" type="checkbox" checked />
    <label for="sc-pub">Visible in listings</label>
  </div>
</fieldset>`,
  tabs: `<div role="tablist">
  <button type="button" role="tab" aria-selected="true" aria-controls="sc-panel-1">Overview</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="sc-panel-2">Settings</button>
  <button type="button" role="tab" aria-selected="false" aria-controls="sc-panel-3">History</button>
</div>
<div role="tabpanel" id="sc-panel-1"><p>Overview panel.</p></div>
<div role="tabpanel" id="sc-panel-2" hidden><p>Settings panel.</p></div>
<div role="tabpanel" id="sc-panel-3" hidden><p>History panel.</p></div>`,
  accordion: `<details open>
  <summary>What is drycms?</summary>
  <p>An Astro integration that mounts an admin UI and ships a small stylesheet.</p>
</details>
<details>
  <summary>Does it need a database?</summary>
  <p>Not yet - the dashboard currently renders sample data.</p>
</details>
<details>
  <summary>Can I change the mount path?</summary>
  <p>Yes, pass <code>dry({ path: '/admin' })</code>.</p>
</details>`,
  breadcrumb: `<ol class="breadcrumb">
  <li><a href="#">Dashboard</a></li>
  <li><a href="#">Content</a></li>
  <li><span aria-current="page">Getting started</span></li>
</ol>`,
  tooltip: `// <!-- data-tooltip holds the message itself, like "title" does -->
<button type="button" class="outline" data-tooltip="Saved 2 minutes ago">Hover me</button>
<span class="badge outline" data-tooltip="Also works on any element">Badge</span>`,
  separator: `<div class="row">
  <span>Left</span>
  <hr class="separator" aria-orientation="vertical" style="height: 1.5rem" />
  <span>Right</span>
</div>`,
  dialog: `<button type="button" command="show-modal" commandfor="demo-dialog">Open dialog</button>

<dialog id="demo-dialog">
  <header>
    <h3>Delete entry?</h3>
    <p>This action cannot be undone.</p>
  </header>
  <footer>
    <button type="button" class="outline" command="close" commandfor="demo-dialog">Cancel</button>
    <button type="button" class="destructive" command="close" commandfor="demo-dialog">Delete</button>
  </footer>
</dialog>`,
  toast: `import Toaster, { toast } from 'drycms/components/Toast';

// Mount once, anywhere in the tree - trigger from anywhere after that.
<Toaster />

toast.add({ title: 'Entry saved', description: 'Draft #128 was updated.' });
toast.add({ title: 'Something went wrong', type: 'error' });
toast.add({
  title: 'Entry deleted',
  actionProps: { children: 'Undo', onClick: () => restore() },
});

toast.promise(saveEntry(), {
  loading: 'Saving…',
  success: 'Saved',
  error: (err) => \`Failed: \${err.message}\`,
});`,
  popover: `import Popover from 'drycms/components/Popover';
import { RenameIcon, CopyIcon, TrashIcon } from 'drycms/components/icons';

const items = [
  { type: 'item', label: 'Rename', icon: <RenameIcon />, onClick: () => rename() },
  { type: 'item', label: 'Duplicate', icon: <CopyIcon />, onClick: () => duplicate() },
  { type: 'separator' },
  { type: 'item', label: 'Delete', icon: <TrashIcon />, danger: true, onClick: () => remove() },
];

<Popover label="Row actions" items={items} />`,
  datatable: `import DataTable from 'drycms/components/DataTable';

const columns = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'size', label: 'Size', numeric: true },
];

<DataTable columns={columns} rows={rows} pageSize={4} />`,
  customSelect: `import Select from 'drycms/components/Select';

const options = [
  { value: 'blog', label: 'Blog' },
  { value: 'docs', label: 'Docs' },
  { value: 'changelog', label: 'Changelog' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'design', label: 'Design system' },
  { value: 'marketing', label: 'Marketing', disabled: true },
];

<Select options={options} defaultValue="docs" name="collection" />`,
  combobox: `import Combobox from 'drycms/components/Combobox';

const options = [
  { value: 'blog', label: 'Blog' },
  { value: 'docs', label: 'Docs' },
  { value: 'changelog', label: 'Changelog' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'design', label: 'Design system' },
  { value: 'marketing', label: 'Marketing', disabled: true },
];

<Combobox options={options} defaultValue="changelog" name="collection" />`,
  multiSelect: `import MultiSelect from 'drycms/components/MultiSelect';

const options = [
  { value: 'blog', label: 'Blog' },
  { value: 'docs', label: 'Docs' },
  { value: 'changelog', label: 'Changelog' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'design', label: 'Design system' },
  { value: 'marketing', label: 'Marketing', disabled: true },
];

<MultiSelect options={options} defaultValue={['blog', 'docs']} name="collections" />`,
  islands: `import ThemeToggle from 'drycms/components/ThemeToggle';
import SidebarToggle from 'drycms/components/SidebarToggle';

<ThemeToggle />
<SidebarToggle />`,
  fileManager: `import FileManager from 'drycms/components/FileManager';

<FileManager data={files} />`,
  fileManagerSingle: `import { useState } from 'preact/hooks';
import FileManager from 'drycms/components/FileManager';

const [value, setValue] = useState('');

<FileManager
  data={files}
  multiple={false}
  accept={['jpg', 'jpeg', 'png']}
  value={value}
  onChange={setValue}
/>
<p class="muted">Selected: {value || 'none'}</p>`,
  fileManagerMulti: `import { useState } from 'preact/hooks';
import FileManager from 'drycms/components/FileManager';

const [value, setValue] = useState([]);

<FileManager
  data={files}
  multiple
  accept={['jpg', 'jpeg', 'png']}
  value={value}
  onChange={setValue}
/>
<p class="muted">Selected: {value.join(', ') || 'none'}</p>`,
};
