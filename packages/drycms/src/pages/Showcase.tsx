import { useMemo, useState } from "preact/hooks";
import { Fragment } from "preact";
import { path } from "virtual:drycms/config";
import CheckField from "../components/CheckField.js";
import Combobox from "../components/Combobox.js";
import ComponentField from "../components/ComponentField.js";
import DataTable from "../components/DataTable.js";
import DatePickerField from "../components/DatePickerField.js";
import Demo from "../components/Demo.js";
import { createHttpFileSource } from "../components/file-manager-http-source.js";
import FileManager from "../components/FileManager.js";
import Icon from "../components/Icon.js";
import ImageField from "../components/ImageField.js";
import {
  CopyIcon,
  type IconName,
  RenameIcon,
  TrashIcon,
  iconBodies,
} from "../components/icons.js";
import MultiSelect from "../components/MultiSelect.js";
import NumberField from "../components/NumberField.js";
import { useOverlayScrollbars } from "../components/overlayscrollbars.js";
import PasswordField from "../components/PasswordField.js";
import Popover from "../components/Popover.js";
import RelationField, {
  type RelationFieldSource,
} from "../components/RelationField.js";
import SecretField from "../components/SecretField.js";
import Select from "../components/Select.js";
import SelectField from "../components/SelectField.js";
import SlugField from "../components/SlugField.js";
import TextField from "../components/TextField.js";
import { toast } from "../components/Toast.js";
import {
  code,
  collectionOptions,
  greys,
  groups,
  intents,
  statusVariant,
  tableColumns,
  tableRows,
} from "../mock/showcase.js";
import { useDocumentTitle } from "./page-common.js";

const iconNames = Object.keys(iconBodies) as IconName[];
const order = groups.flatMap((group) => group.items.map((item) => item.id));
const DEFAULT_TAB = order[0]!;

function labelFor(id: string | undefined): string {
  if (!id) return "";
  for (const group of groups) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item.label;
  }
  return id;
}

function groupLabelFor(id: string): string | undefined {
  return groups.find((group) => group.items.some((item) => item.id === id))
    ?.label;
}

interface Props {
  tab?: string;
}

export default function Showcase({ tab }: Props) {
  const activeId = tab && order.includes(tab) ? tab : DEFAULT_TAB;
  const index = order.indexOf(activeId);
  const prevId = order[index - 1];
  const nextId = order[index + 1];

  const { ref: nav } = useOverlayScrollbars<HTMLElement>();

  useDocumentTitle(`${labelFor(activeId)} – Showcase`);

  return (
    <>
      <div class="page-header">
        <div>
          <h1>Showcase</h1>
          <p>Every component in drycms, with the markup that produces it.</p>
        </div>
        <span class="badge outline">v0.0.1</span>
      </div>

      <div class="showcase">
        <aside class="showcase-nav" aria-label="Showcase sections" ref={nav}>
          <nav>
            {groups.map((group) => (
              <Fragment key={group.label}>
                <span class="nav-label">{group.label}</span>
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={`${path}/showcase/${item.id}`}
                    aria-current={activeId === item.id ? "page" : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </Fragment>
            ))}
          </nav>
        </aside>

        <div class="showcase-body">
          <h2 class="showcase-group">{groupLabelFor(activeId)}</h2>

          <DemoContent id={activeId} />

          <nav class="pager" aria-label="Showcase pagination">
            {prevId ? (
              <a
                role="button"
                class="outline pager-btn"
                href={`${path}/showcase/${prevId}`}
                style={{
                  paddingBlock: `0.5rem`,
                  textAlign: "left",
                  height: "unset",
                }}
              >
                <Icon name="ArrowLeft" />
                <span class="pager-text">
                  <small>Previous</small>
                  <strong>{labelFor(prevId)}</strong>
                </span>
              </a>
            ) : (
              <button
                type="button"
                class="outline pager-btn"
                disabled
                style="text-align: left;"
              >
                <Icon name="ArrowLeft" />
                <span class="pager-text">
                  <small>Previous</small>
                  <strong></strong>
                </span>
              </button>
            )}
            {nextId ? (
              <a
                role="button"
                class="pager-btn pager-btn-next"
                href={`${path}/showcase/${nextId}`}
                style={{ paddingBlock: `0.5rem`, height: "unset" }}
              >
                <span class="pager-text">
                  <small>Next</small>
                  <strong>{labelFor(nextId)}</strong>
                </span>
                <Icon name="ArrowRight" />
              </a>
            ) : (
              <button type="button" class="pager-btn pager-btn-next" disabled>
                <span class="pager-text">
                  <small>Next</small>
                  <strong></strong>
                </span>
                <Icon name="ArrowRight" />
              </button>
            )}
          </nav>
        </div>
      </div>
    </>
  );
}

/** Switching tabs is handled by the global `[role="tablist"]` delegated
 * listener in `components/tabs.ts` (imported once, app-wide, by `App.tsx`) -
 * nothing to wire up here. */
function TabsDemoPreview() {
  const { ref: tablist } = useOverlayScrollbars<HTMLDivElement>();

  return (
    <div class="stack" style="width: 100%">
      <div role="tablist" ref={tablist}>
        <button
          type="button"
          role="tab"
          aria-selected="true"
          aria-controls="sc-panel-1"
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          aria-controls="sc-panel-2"
        >
          Settings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          aria-controls="sc-panel-3"
        >
          History
        </button>
      </div>
      <div role="tabpanel" id="sc-panel-1">
        <p>Overview panel.</p>
      </div>
      <div role="tabpanel" id="sc-panel-2" hidden>
        <p>Settings panel.</p>
      </div>
      <div role="tabpanel" id="sc-panel-3" hidden>
        <p>History panel.</p>
      </div>
    </div>
  );
}

/** Plain full demo: list/grid, move/copy/delete/rename/replace/upload -
 * against the same real `storage/` folder the Media page uses, so every
 * action here actually reads/writes real files. */
function FileManagerPreview() {
  const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);
  return <FileManager source={source} />;
}

function TextFieldPreview() {
  const [title, setTitle] = useState("Getting started");
  const [slug, setSlug] = useState("");
  const [bio, setBio] = useState("");
  return (
    <div class="grid cols-2" style="width: 100%">
      <TextField
        label="Title"
        value={title}
        onChange={setTitle}
        description="Shown as the page heading."
        helperText="Shown in listings and search results."
      />
      <TextField
        label="Slug"
        value={slug}
        onChange={setSlug}
        error
        helperText="Slug is required."
      />
      <TextField
        label="Bio"
        value={bio}
        onChange={setBio}
        multiline
        placeholder="Write something…"
      />
    </div>
  );
}

function SlugFieldPreview() {
  const [title, setTitle] = useState("Getting started");
  const [slug, setSlug] = useState("getting-started");
  return (
    <div style="width: 100%; max-width: 24rem">
      <SlugField
        value={title}
        slug={slug}
        onChange={(value, slug) => {
          setTitle(value);
          setSlug(slug);
        }}
        description="Used in the public URL."
        helperText="Auto-derived from the title until you edit the slug directly."
      />
    </div>
  );
}

function PasswordFieldPreview() {
  const [password, setPassword] = useState("hunter2");
  const [confirm, setConfirm] = useState("hunter2");
  return (
    <div class="grid cols-2" style="width: 100%">
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        placeholder="Enter a password"
        helperText="At least 8 characters."
      />
      <PasswordField
        label="Confirm password"
        value={confirm}
        onChange={setConfirm}
        placeholder="Re-enter the password"
        helperText="Shares the show/hide toggle with the field on the left."
      />
    </div>
  );
}

function SecretFieldPreview() {
  const [privateKey, setPrivateKey] = useState(
    "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAT8w...\n-----END PRIVATE KEY-----",
  );
  const [notes, setNotes] = useState("Rotate every 90 days.");
  return (
    <div class="grid cols-2" style="width: 100%">
      <SecretField
        label="Private key"
        value={privateKey}
        onChange={setPrivateKey}
        placeholder="Paste a private key"
        helperText="Its own show/hide toggle, independent of PasswordField's."
      />
      <SecretField
        label="Rotation notes"
        value={notes}
        onChange={setNotes}
        placeholder="Optional notes"
      />
    </div>
  );
}

function NumberFieldPreview() {
  const [priority, setPriority] = useState(5);
  const [wordCount, setWordCount] = useState(0);
  const [price, setPrice] = useState(9.5);
  return (
    <div class="grid cols-2" style="width: 100%">
      <NumberField
        label="Priority"
        value={priority}
        onChange={setPriority}
        min={0}
        max={10}
        description="Controls display order across listings."
        helperText="Higher numbers sort first."
      />
      <NumberField
        label="Word count"
        value={wordCount}
        onChange={setWordCount}
        error
        helperText="Must be greater than 0."
      />
      <NumberField
        label="Price"
        value={price}
        onChange={setPrice}
        min={0}
        step={0.5}
        helperText="Steps by 0.5 per click."
      />
    </div>
  );
}

function CheckFieldPreview() {
  const [visible, setVisible] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);
  return (
    <div class="row" style="gap: 1.5rem">
      <CheckField
        outline
        label="Visible in listings"
        value={visible}
        onChange={setVisible}
        helperText="Shown on the public site once enabled."
      />
      <CheckField
        label="Auto-publish"
        value={autoPublish}
        onChange={setAutoPublish}
        description="Automatically publish new posts without review."
        role="switch"
      />
    </div>
  );
}

function SelectFieldPreview() {
  const [collection, setCollection] = useState("Blog");
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div class="grid cols-2" style="width: 100%">
      <SelectField
        label="Collection"
        config={{ options: ["Blog", "Docs", "Changelog"], multiple: false }}
        value={collection}
        onChange={(value) => setCollection(value as string)}
        description="Where this entry is filed."
        helperText="Fixed options, set once on the field itself."
      />
      <SelectField
        label="Tags"
        config={{
          options: ["Design", "Engineering", "Marketing", "Product"],
          multiple: true,
        }}
        value={tags}
        onChange={(value) => setTags(value as string[])}
        error
        helperText="Pick at least one tag."
      />
    </div>
  );
}

function DatePickerFieldPreview() {
  const [publishedAt, setPublishedAt] = useState(new Date(2026, 6, 20, 9, 30));
  const [birthday, setBirthday] = useState(new Date(1995, 3, 12));
  const [noteDate, setNoteDate] = useState(new Date(2026, 6, 1));
  return (
    <div class="grid cols-2" style="width: 100%">
      <DatePickerField
        label="Published at"
        value={publishedAt}
        onChange={setPublishedAt}
        time
        description="When this post goes live."
        helperText="Pick a day, then adjust the time below."
      />
      <DatePickerField
        label="Birthday"
        value={birthday}
        onChange={setBirthday}
        mode="select"
        helperText="Day / month / year dropdowns, no time."
      />
      <DatePickerField
        label="Custom note date"
        value={noteDate}
        onChange={setNoteDate}
        mode="input"
        helperText="Native browser date input."
      />
    </div>
  );
}

function ImageFieldPreview() {
  const source = useMemo(() => createHttpFileSource(`${path}/api/storage`), []);
  const [cover, setCover] = useState("image.png");
  return (
    <div style="width: 100%; max-width: 20rem">
      <ImageField
        label="Cover image"
        source={source}
        value={cover}
        onChange={setCover}
        description="Recommended size: 1200×630."
        helperText="Shown at the top of the post."
      />
    </div>
  );
}

interface MockAuthor {
  id: string;
  name: string;
  email: string;
}

const MOCK_AUTHORS: MockAuthor[] = [
  { id: "1", name: "Ada Lovelace", email: "ada@example.com" },
  { id: "2", name: "Alan Turing", email: "alan@example.com" },
  { id: "3", name: "Grace Hopper", email: "grace@example.com" },
  { id: "4", name: "Margaret Hamilton", email: "margaret@example.com" },
];

function RelationFieldPreview() {
  const [author, setAuthor] = useState("1");
  const [contributors, setContributors] = useState<string[]>(["2", "3"]);
  const source: RelationFieldSource<MockAuthor> = useMemo(
    () => ({
      columns: [
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
      ],
      fetchRows: async ({ search }) => {
        const rows = search
          ? MOCK_AUTHORS.filter((a) =>
              a.name.toLowerCase().includes(search.toLowerCase()),
            )
          : MOCK_AUTHORS;
        return { rows, total: rows.length };
      },
      resolveLabels: async (ids) =>
        Object.fromEntries(
          ids.map((id) => [
            id,
            MOCK_AUTHORS.find((a) => a.id === id)?.name ?? id,
          ]),
        ),
    }),
    [],
  );
  return (
    <div class="grid cols-2" style="width: 100%">
      <div>
        <RelationField
          label="Author"
          value={author}
          onChange={(value) => setAuthor(value as string)}
          source={source}
          pickerTitle="Choose Author"
          description="The main author of this post."
          helperText="Click to pick one author from the list."
        />
      </div>
      <div>
        <RelationField
          label="Contributors"
          value={contributors}
          onChange={(value) => setContributors(value as string[])}
          source={source}
          multiple
          description="Other contributors to this post."
          pickerTitle="Choose Contributors"
          helperText="Click to pick multiple contributors from the list."
        />
      </div>
    </div>
  );
}

interface MockLink {
  label: string;
  url: string;
}

function ComponentFieldPreview() {
  const [links, setLinks] = useState<MockLink[]>([
    { label: "Docs", url: "https://example.com/docs" },
    { label: "GitHub", url: "https://example.com/github" },
  ]);
  return (
    <div style="width: 100%; max-width: 24rem">
      <ComponentField<MockLink>
        label="Links"
        value={links}
        onChange={setLinks}
        sortable
        itemLabel="link"
        summaryOf={(item) => item.label}
        blankItem={() => ({ label: "", url: "" })}
        renderItem={(item, onChange) => (
          <>
            <TextField
              label="Label"
              value={item.label}
              onChange={(value) => onChange({ ...item, label: value })}
              placeholder="e.g. Docs"
            />
            <TextField
              label="URL"
              value={item.url}
              onChange={(value) => onChange({ ...item, url: value })}
              placeholder="e.g. https://example.com"
            />
          </>
        )}
        helperText="Add, edit, or remove repeatable link items. Drag the handle to reorder."
      />
    </div>
  );
}

function DemoContent({ id }: { id: string }) {
  switch (id) {
    case "colors":
      return (
        <Demo
          id="colors"
          title="Colors"
          description="Minimals palette, exposed as CSS custom properties."
          code={code.colors!}
        >
          <div class="stack" style="width: 100%">
            <div class="row">
              {intents.map((intent) => (
                <div
                  class="swatch"
                  key={intent}
                  data-tooltip={`--dry-${intent === "secondary" ? "secondary-main" : intent}`}
                >
                  <span
                    style={`background: var(--dry-${intent === "secondary" ? "secondary-main" : intent})`}
                  />
                  <small class="mono">{intent}</small>
                </div>
              ))}
            </div>
            <div class="row">
              {greys.map((grey) => (
                <div class="swatch" key={grey}>
                  <span style={`background: var(--dry-grey-${grey})`} />
                  <small class="mono">{grey}</small>
                </div>
              ))}
            </div>
            <div class="row">
              <span class="badge info">Info</span>
              <span class="badge success">Success</span>
              <span class="badge warning">Warning</span>
              <span class="badge destructive">Destructive</span>
            </div>
          </div>
        </Demo>
      );

    case "typography":
      return (
        <Demo
          id="typography"
          title="Typography"
          description="Bare tags, no classes needed here."
          code={code.typography!}
        >
          <div class="stack" style="width: 100%; gap: 0.75rem">
            <h1>Heading 1</h1>
            <h2>Heading 2</h2>
            <h3>Heading 3</h3>
            <p>Body text sits at 14px with a 1.5 line height.</p>
            <small>Small text is muted by default.</small>
            <p>
              Inline <code>code</code>, a <kbd>Ctrl</kbd> key, and a{" "}
              <a href={`${path}/showcase/colors`} class="underline">
                link
              </a>
              .
            </p>
            <blockquote>
              Bare tags first, classes only when there's no real attribute.
            </blockquote>
          </div>
        </Demo>
      );

    case "icons":
      return (
        <Demo
          id="icons"
          title="Icons"
          description="Solar (Iconify), inlined at build time. Lucide is the fallback set."
          code={code.icons!}
        >
          <div class="icon-grid">
            {iconNames.map((name) => (
              <div class="icon-cell" key={name}>
                <Icon name={name} size="1.5rem" />
                <small class="mono">{name}</small>
              </div>
            ))}
          </div>
        </Demo>
      );

    case "layout":
      return (
        <Demo
          id="layout"
          title="Layout utilities"
          description="No native attribute means 'stack a column' or 'space these evenly' - .stack, .row, .grid and .cols-2/.cols-4 are classes for exactly that."
          code={code.layout!}
        >
          <div class="stack" style="width: 100%">
            <div class="grid cols-4" style="width: 100%">
              <article class="card">
                <span class="metric">128</span>
                <small>Entries</small>
              </article>
              <article class="card">
                <span class="metric">9</span>
                <small>Drafts</small>
              </article>
              <article class="card">
                <span class="metric">1,204</span>
                <small>Media</small>
              </article>
              <article class="card">
                <span class="metric">6</span>
                <small>Collections</small>
              </article>
            </div>
            <div class="row justify-between" style="width: 100%">
              <span class="muted">.row.justify-between</span>
              <span class="mono">0.0.1</span>
            </div>
          </div>
        </Demo>
      );

    case "buttons":
      return (
        <Demo
          id="buttons"
          title="Button sizes"
          description=".sm/.md/.lg/.xl set the height, one tier below the same-named input size; a bare button defaults to .md. .icon makes a square icon-only button; .block stretches to 100% width."
          code={code.buttons!}
        >
          <button type="button" class="sm">
            Small
          </button>
          <button type="button">Medium</button>
          <button type="button" class="lg">
            Large
          </button>
          <button type="button" class="xl">
            Extra large
          </button>
          <button type="button" class="icon" aria-label="Settings">
            <Icon name="Settings" />
          </button>
          <button type="button" class="block">
            Full width
          </button>
        </Demo>
      );

    case "button-variants":
      return (
        <Demo
          id="button-variants"
          title="Button variants"
          description="Colour classes, optionally softened with .soft."
          code={code.buttonVariants!}
        >
          <div class="stack" style="width: 100%">
            <div class="row">
              <button type="button">Default</button>
              <button type="button" class="secondary">
                Secondary
              </button>
              <button type="button" class="outline">
                Outline
              </button>
              <button type="button" class="ghost">
                Ghost
              </button>
              <button type="button" class="link">
                Link
              </button>
            </div>
            <div class="row">
              <button type="button" class="destructive">
                Destructive
              </button>
              <button type="button" class="info">
                Info
              </button>
              <button type="button" class="success">
                Success
              </button>
              <button type="button" class="warning">
                Warning
              </button>
            </div>
            <div class="row">
              <button type="button" class="soft">
                Soft
              </button>
              <button type="button" class="soft destructive">
                Soft destructive
              </button>
              <button type="button" class="soft info">
                Soft info
              </button>
              <button type="button" class="soft success">
                Soft success
              </button>
              <button type="button" class="soft warning">
                Soft warning
              </button>
            </div>
          </div>
        </Demo>
      );

    case "button-states":
      return (
        <Demo
          id="button-states"
          title="Button states"
          description="All real attributes, no classes: disabled and aria-busy are native/ARIA state, not variants."
          code={code.buttonStates!}
        >
          <button type="button" disabled>
            Disabled
          </button>
          <button type="button" class="outline" disabled>
            Disabled outline
          </button>
          <button type="button" aria-busy="true">
            Saving
          </button>
          <a role="button" class="outline" href="#button-states">
            Link as button
          </a>
        </Demo>
      );

    case "cards":
      return (
        <Demo
          id="cards"
          title="Cards"
          description=".card is the container; .flush removes its padding so a table or list can run edge to edge."
          code={code.cards!}
        >
          <div class="grid cols-2" style="width: 100%">
            <article class="card">
              <header>
                <h3>Standard card</h3>
                <p>Header, body and footer are plain child elements.</p>
              </header>
              <p>Padding, radius and elevation come from the stylesheet.</p>
              <footer>
                <button type="button" class="sm">
                  Save
                </button>
                <button type="button" class="sm outline">
                  Cancel
                </button>
              </footer>
            </article>
            <article class="card flush">
              <header>
                <h3>Flush card</h3>
                <p>Body runs edge to edge - good for tables.</p>
              </header>
              <footer>
                <span class="muted">.card.flush</span>
              </footer>
            </article>
          </div>
        </Demo>
      );

    case "badges":
      return (
        <Demo
          id="badges"
          title="Badges"
          description=".badge plus a colour class (soft fill by default); add .filled for a solid fill. .sm/.lg for size, unclassed is md."
          code={code.badges!}
        >
          <div class="stack" style="width: 100%">
            <div class="row">
              <span class="badge sm">Small</span>
              <span class="badge">Default</span>
              <span class="badge lg">Large</span>
            </div>
            <div class="row">
              <span class="badge">Default</span>
              <span class="badge secondary">Secondary</span>
              <span class="badge outline">Outline</span>
              <span class="badge info">Info</span>
              <span class="badge success">Success</span>
              <span class="badge warning">Warning</span>
              <span class="badge destructive">Destructive</span>
            </div>
            <div class="row">
              <span class="badge filled">Default</span>
              <span class="badge filled info">Info</span>
              <span class="badge filled success">Success</span>
              <span class="badge filled warning">Warning</span>
              <span class="badge filled destructive">Destructive</span>
            </div>
          </div>
        </Demo>
      );

    case "alerts":
      return (
        <Demo
          id="alerts"
          title="Alerts"
          description=".alert plus a colour class; no class at all defaults to the neutral/info look."
          code={code.alerts!}
        >
          <div class="stack" style="width: 100%">
            <div class="alert">
              <Icon name="InfoCircle" />
              <h4>Heads up</h4>
              <p>
                This dashboard ships with sample data until a content source is
                wired up.
              </p>
            </div>
            <div class="alert success">
              <Icon name="CheckCircle" />
              <h4>Published</h4>
              <p>Your entry is now live.</p>
            </div>
            <div class="alert warning">
              <Icon name="AlertTriangle" />
              <h4>Unsaved changes</h4>
              <p>Leaving this page will discard them.</p>
            </div>
            <div class="alert destructive">
              <Icon name="Danger" />
              <h4>Failed to save</h4>
              <p>The server returned a 500. Try again.</p>
            </div>
          </div>
        </Demo>
      );

    case "table":
      return (
        <Demo
          id="table"
          title="Table"
          description="Plain table markup; .numeric right-aligns and tabularises."
          code={code.table!}
        >
          <div class="scroll" style="width: 100%">
            <table>
              <caption>Recent entries</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Collection</th>
                  <th>Status</th>
                  <th class="numeric">Size</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(0, 4).map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.collection}</td>
                    <td>
                      <span class={`badge ${statusVariant(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td class="numeric">{row.size} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Demo>
      );

    case "avatar":
      return (
        <Demo
          id="avatar"
          title="Avatar"
          description=".avatar plus the shared .sm/.lg size classes."
          code={code.avatar!}
        >
          <span class="avatar sm">SM</span>
          <span class="avatar">KT</span>
          <span class="avatar lg">LG</span>
        </Demo>
      );

    case "progress":
      return (
        <Demo
          id="progress"
          title="Progress"
          description="Native <progress>, no classes - value/max are the real attributes that drive it."
          code={code.progress!}
        >
          <div class="stack" style="width: 100%; max-width: 24rem">
            <progress value="72" max="100"></progress>
            <progress value="28" max="100"></progress>
            <progress></progress>
          </div>
        </Demo>
      );

    case "progress-circle":
      return (
        <Demo
          id="progress-circle"
          title="Progress circle"
          description="Native <progress>, no wrapper markup - value/max drive it, class='circle' picks the ring shape."
          code={code.progressCircle!}
        >
          <div class="row" style="gap: 1.5rem">
            <progress
              value="72"
              max="100"
              class="circle"
              style="--value: 72"
            ></progress>
            <progress
              value="28"
              max="100"
              class="circle"
              style="--value: 28"
            ></progress>
            <progress class="circle"></progress>
          </div>
        </Demo>
      );

    case "skeleton":
      return (
        <Demo
          id="skeleton"
          title="Skeleton"
          description=".skeleton - width, height and border-radius are set inline per use."
          code={code.skeleton!}
        >
          <div class="row">
            <span
              class="skeleton"
              style="height: 3rem; width: 3rem; border-radius: 50%"
            ></span>
            <div class="stack" style="gap: 0.5rem">
              <span
                class="skeleton"
                style="height: 0.75rem; width: 12rem"
              ></span>
              <span
                class="skeleton"
                style="height: 0.75rem; width: 8rem"
              ></span>
            </div>
          </div>
        </Demo>
      );

    case "empty":
      return (
        <Demo
          id="empty"
          title="Empty state"
          description=".empty - a dashed placeholder for zero-state screens."
          code={code.empty!}
        >
          <div class="empty" style="width: 100%">
            <strong>No entries yet</strong>
            <small>Create your first entry to get started.</small>
            <button type="button" class="sm">
              New entry
            </button>
          </div>
        </Demo>
      );

    case "text-inputs":
      return (
        <Demo
          id="text-inputs"
          title="Text inputs"
          description=".sm/.lg size classes; readonly and disabled are real attributes."
          code={code.textInputs!}
        >
          <div class="grid cols-2" style="width: 100%">
            <input type="text" class="sm" placeholder="Small" />
            <input type="text" placeholder="Default" />
            <input type="text" class="lg" placeholder="Large" />
            <input type="search" placeholder="Search entries" />
            <input type="text" value="Read only" readonly />
            <input type="text" placeholder="Disabled" disabled />
          </div>
        </Demo>
      );

    case "select":
      return (
        <Demo
          id="select"
          title="Select & textarea"
          description="Native elements, no classes at all."
          code={code.select!}
        >
          <div class="grid cols-2" style="width: 100%">
            <select>
              <option>blog</option>
              <option>docs</option>
              <option>changelog</option>
            </select>
            <textarea placeholder="Write something…"></textarea>
          </div>
        </Demo>
      );

    case "toggles":
      return (
        <Demo
          id="toggles"
          title="Checkbox, radio & switch"
          description="Real attributes only (checked, indeterminate, role=switch); .field.inline lays out each pair horizontally."
          code={code.toggles!}
        >
          <div class="row" style="gap: 1.5rem">
            <div class="field inline">
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
            </div>
          </div>
        </Demo>
      );

    case "other-inputs":
      return (
        <Demo
          id="other-inputs"
          title="Range, color and file"
          description="Native input types, no classes."
          code={code.otherInputs!}
        >
          <div class="grid cols-2" style="width: 100%">
            <input type="range" value="60" style={{ "--value": 60 }} />
            <input type="color" value="#00a76f" />
            <input type="file" />
          </div>
        </Demo>
      );

    case "fields":
      return (
        <Demo
          id="fields"
          title="Fields & validation"
          description=".field groups a label, control and hint or error."
          code={code.fields!}
        >
          <div class="grid cols-2" style="width: 100%;">
            <div class="field">
              <label for="sc-title">Title</label>
              <input id="sc-title" type="text" value="Getting started" />
              <span class="hint">Shown in listings and search results.</span>
            </div>
            <div class="field">
              <label for="sc-slug">Slug</label>
              <input id="sc-slug" type="text" aria-invalid="true" value="" />
              <span class="error">Slug is required.</span>
            </div>
            <div>
              <fieldset>
                <legend>Publishing</legend>
                <div class="field inline">
                  <input id="sc-pub" type="checkbox" checked />
                  <label for="sc-pub">Visible in listings</label>
                </div>
              </fieldset>
            </div>
          </div>
        </Demo>
      );

    case "text-field":
      return (
        <Demo
          id="text-field"
          title="Text field"
          description="Controlled label + control + helper text component; error switches the helper text to the destructive colour, multiline swaps the input for a textarea."
          code={code.textField!}
        >
          <TextFieldPreview />
        </Demo>
      );

    case "slug-field":
      return (
        <Demo
          id="slug-field"
          title="Slug field"
          description="Pairs a TextField for the title with a derived, editable slug input below it; auto-derives via slugify() until the slug is edited directly, and the trailing button re-syncs it from the title."
          code={code.slugField!}
        >
          <SlugFieldPreview />
        </Demo>
      );

    case "password-field":
      return (
        <Demo
          id="password-field"
          title="Password field"
          description="Same label + control + helper text contract as TextField; the trailing eye button toggles type='password' to type='text'. Its show/hide state is one signal shared by every PasswordField on the page - toggle one, they all reveal - independent of SecretField's own toggle."
          code={code.passwordField!}
        >
          <PasswordFieldPreview />
        </Demo>
      );

    case "secret-field":
      return (
        <Demo
          id="secret-field"
          title="Secret field"
          description="Multiline counterpart to PasswordField, for values too long for one line. A textarea has no native masking, so hiding it toggles a .masked class (-webkit-text-security) instead - Firefox has no equivalent and always shows the value in the clear there."
          code={code.secretField!}
        >
          <SecretFieldPreview />
        </Demo>
      );

    case "number-field":
      return (
        <Demo
          id="number-field"
          title="Number field"
          description="Same label + control + helper text contract as TextField, backed by a numeric input; empty/invalid input resolves to 0."
          code={code.numberField!}
        >
          <NumberFieldPreview />
        </Demo>
      );

    case "check-field":
      return (
        <Demo
          id="check-field"
          title="Check field"
          description="Same label + control + helper text contract as TextField; ui='switch' swaps the checkbox for role='switch' (real ARIA semantics, not a class)."
          code={code.checkField!}
        >
          <CheckFieldPreview />
        </Demo>
      );

    case "select-field":
      return (
        <Demo
          id="select-field"
          title="Select field"
          description="Same label + control + helper text contract as TextField; config.multiple picks between the Select and MultiSelect controls against a fixed config.options list defined on the field itself."
          code={code.selectField!}
        >
          <SelectFieldPreview />
        </Demo>
      );

    case "date-picker-field":
      return (
        <Demo
          id="date-picker-field"
          title="Date picker field"
          description="Same label + control + helper text contract as TextField; mode='calendar' shows a month grid, mode='select' three dropdowns, mode='input' the browser's native <input type='date'>. time (off by default) adds a NumberField-driven hour/minute row and switches mode='input' to type='datetime-local'."
          code={code.datePickerField!}
        >
          <DatePickerFieldPreview />
        </Demo>
      );

    case "image-field":
      return (
        <Demo
          id="image-field"
          title="Image field"
          description="Same label + control + helper text contract as TextField; the control is a 4:3 frame that opens a FileManager-backed dialog restricted to images (accept), pre-scrolled to the current selection."
          code={code.imageField!}
        >
          <ImageFieldPreview />
        </Demo>
      );

    case "relation-field":
      return (
        <Demo
          id="relation-field"
          title="Relation field"
          description="Same label + control + helper text contract as TextField; the control is a card that opens a searchable/paginated DataTable dialog, backed by a RelationFieldSource (columns + fetchRows + resolveLabels) so it isn't tied to any particular backend. multiple swaps the picker's radio column for checkboxes and stores an array of ids instead of one."
          code={code.relationField!}
        >
          <RelationFieldPreview />
        </Demo>
      );

    case "component-field":
      return (
        <Demo
          id="component-field"
          title="Component field"
          description="An editable list of summaries, each opening an add/edit dialog for one item; renderItem lets the caller plug in that item's own fields, so the item's shape is entirely up to the consumer."
          code={code.componentField!}
        >
          <ComponentFieldPreview />
        </Demo>
      );

    case "tabs":
      return (
        <Demo
          id="tabs"
          title="Tabs"
          description="Driven by role and aria-selected."
          code={code.tabs!}
        >
          <TabsDemoPreview />
        </Demo>
      );

    case "accordion":
      return (
        <Demo
          id="accordion"
          title="Accordion"
          description="Native details/summary, no JavaScript."
          code={code.accordion!}
        >
          <div style="width: 100%">
            <details open>
              <summary>What is drycms?</summary>
              <p>
                An Astro integration that mounts an admin UI and ships a small
                stylesheet.
              </p>
            </details>
            <details>
              <summary>Does it need a database?</summary>
              <p>Not yet - the dashboard currently renders sample data.</p>
            </details>
            <details>
              <summary>Can I change the mount path?</summary>
              <p>
                Yes, pass <code>dry(&#123; path: '/admin' &#125;)</code>.
              </p>
            </details>
          </div>
        </Demo>
      );

    case "breadcrumb":
      return (
        <Demo
          id="breadcrumb"
          title="Breadcrumb"
          description=".breadcrumb on an <ol>; aria-current marks the active page."
          code={code.breadcrumb!}
        >
          <ol class="breadcrumb">
            <li>
              <a href="#">Dashboard</a>
            </li>
            <li>
              <a href="#">Content</a>
            </li>
            <li>
              <span aria-current="page">Getting started</span>
            </li>
          </ol>
        </Demo>
      );

    case "tooltip":
      return (
        <Demo
          id="tooltip"
          title="Tooltip"
          description="From the data-tooltip attribute (its value is the message, like title) - shown via a small JS helper so it floats free of any scroll-clipped ancestor."
          code={code.tooltip!}
        >
          <button
            type="button"
            class="outline"
            data-tooltip="Saved 2 minutes ago"
          >
            Hover me
          </button>
          <span class="badge outline" data-tooltip="Also works on any element">
            Badge
          </span>
        </Demo>
      );

    case "separator":
      return (
        <Demo
          id="separator"
          title="Separator"
          description=".separator; aria-orientation flips it vertical."
          code={code.separator!}
        >
          <div class="stack" style="width: 100%">
            <div class="row">
              <span>Left</span>
              <hr
                class="separator"
                aria-orientation="vertical"
                style="height: 1.5rem"
              />
              <span>Right</span>
            </div>
          </div>
        </Demo>
      );

    case "dialog":
      return (
        <Demo
          id="dialog"
          title="Dialog"
          description="Native dialog, opened and closed with command/commandfor - no JS."
          code={code.dialog!}
        >
          <button type="button" command="show-modal" commandfor="sc-dialog">
            Open dialog
          </button>
          <dialog id="sc-dialog">
            <header>
              <h3>Delete entry?</h3>
              <p>This action cannot be undone.</p>
            </header>
            <footer>
              <button
                type="button"
                class="outline"
                command="close"
                commandfor="sc-dialog"
              >
                Cancel
              </button>
              <button
                type="button"
                class="destructive"
                command="close"
                commandfor="sc-dialog"
              >
                Delete
              </button>
            </footer>
          </dialog>
        </Demo>
      );

    case "toast":
      return (
        <Demo
          id="toast"
          title="Toast"
          description="Imperative queue in the style of Base UI's Toast - stacked, swipe-to-dismiss, pauses on hover."
          code={code.toast!}
        >
          <div class="row">
            <button
              type="button"
              class="outline"
              onClick={() =>
                toast.add({
                  title: "Entry saved",
                  description: "Draft #128 was updated.",
                })
              }
            >
              Default
            </button>
            <button
              type="button"
              class="success"
              onClick={() =>
                toast.add({ title: "Entry published", type: "success" })
              }
            >
              Success
            </button>
            <button
              type="button"
              class="destructive"
              onClick={() =>
                toast.add({ title: "Something went wrong", type: "error" })
              }
            >
              Error
            </button>
            <button
              type="button"
              class="warning"
              onClick={() =>
                toast.add({ title: "Quota almost reached", type: "warning" })
              }
            >
              Warning
            </button>
            <button
              type="button"
              class="info"
              onClick={() =>
                toast.add({ title: "A new version is available", type: "info" })
              }
            >
              Info
            </button>
            <button
              type="button"
              class="outline"
              onClick={() =>
                toast.add({
                  title: "Entry deleted",
                  actionProps: { children: "Undo", onClick: () => {} },
                })
              }
            >
              With action
            </button>
            <button
              type="button"
              class="outline"
              onClick={() =>
                toast
                  .promise(
                    new Promise<void>((resolve, reject) =>
                      setTimeout(
                        () =>
                          Math.random() > 0.5
                            ? resolve()
                            : reject(new Error("Network error")),
                        1200,
                      ),
                    ),
                    {
                      loading: "Saving…",
                      success: "Saved",
                      error: (err: unknown) =>
                        `Failed: ${(err as Error).message}`,
                    },
                  )
                  .catch(() => {})
              }
            >
              Promise
            </button>
          </div>
        </Demo>
      );

    case "popover":
      return (
        <Demo
          id="popover"
          title="Popover"
          description="A trigger button that opens a floating menu, portaled to <body> so it isn't clipped by a scroll/overflow ancestor - see the file manager's row actions for it in context."
          code={code.popover!}
        >
          <Popover
            label="Row actions"
            items={[
              {
                type: "item",
                label: "Rename",
                icon: <RenameIcon />,
                onClick: () => toast.add({ title: "Renamed" }),
              },
              {
                type: "item",
                label: "Duplicate",
                icon: <CopyIcon />,
                onClick: () => toast.add({ title: "Duplicated" }),
              },
              { type: "separator" },
              {
                type: "item",
                label: "Delete",
                icon: <TrashIcon />,
                danger: true,
                onClick: () => toast.add({ title: "Deleted", type: "error" }),
              },
            ]}
          />
        </Demo>
      );

    case "datatable":
      return (
        <Demo
          id="datatable"
          title="DataTable"
          description="Sort, filter and paginate."
          code={code.datatable!}
        >
          <div style="width: 100%">
            <DataTable columns={tableColumns} rows={tableRows} pageSize={4} />
          </div>
        </Demo>
      );

    case "custom-select":
      return (
        <Demo
          id="custom-select"
          title="Select"
          description="Custom-styled single select, built from scratch - unlike the native <select> above."
          code={code.customSelect!}
        >
          <div style="width: 100%; max-width: 20rem">
            <Select
              options={collectionOptions}
              defaultValue="docs"
              name="collection"
            />
          </div>
        </Demo>
      );

    case "combobox":
      return (
        <Demo
          id="combobox"
          title="Combobox"
          description="Filterable single select - type to narrow the list."
          code={code.combobox!}
        >
          <div style="width: 100%; max-width: 20rem">
            <Combobox
              options={collectionOptions}
              defaultValue="changelog"
              name="collection"
            />
          </div>
        </Demo>
      );

    case "multi-select":
      return (
        <Demo
          id="multi-select"
          title="Multi-select"
          description="Filterable multi select - picks collect as chips, backspace removes the last one."
          code={code.multiSelect!}
        >
          <div style="width: 100%; max-width: 20rem">
            <MultiSelect
              options={collectionOptions}
              defaultValue={["blog", "docs"]}
              name="collections"
            />
          </div>
        </Demo>
      );

    case "islands":
      return (
        <Demo
          id="islands"
          title="Theme & sidebar toggles"
          description="Both live in the topbar of every drycms page."
          code={code.islands!}
        >
          <p class="muted">
            The theme toggle and the mobile sidebar toggle are in the topbar
            above. The theme toggle cycles system → light → dark and stores the
            choice in localStorage.
          </p>
        </Demo>
      );

    case "file-manager":
      return (
        <Demo
          id="file-manager"
          title="File manager"
          description="Self-contained: list/grid views, search, multi-select with move/copy/delete, rename/replace, full-screen preview, and upload - against the same real storage/ folder as the Media page, via createHttpFileSource."
          code={code.fileManager!}
        >
          <FileManagerPreview />
        </Demo>
      );

    default:
      return null;
  }
}
