import { useEffect, useRef } from "preact/hooks";
import { Fragment } from "preact";
import { path } from "virtual:drycms/config";
import Combobox from "../components/Combobox.js";
import DataTable from "../components/DataTable.js";
import Demo from "../components/Demo.js";
import Icon from "../components/Icon.js";
import { type IconName, iconBodies } from "../components/icons.js";
import MultiSelect from "../components/MultiSelect.js";
import Select from "../components/Select.js";
import { useSimpleBar } from "../components/simplebar.js";
import ThemeToggle from "../components/ThemeToggle.js";
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

  const nav = useSimpleBar<HTMLElement>();
  const main = useSimpleBar<HTMLDivElement>();

  useEffect(() => {
    document.title = `${labelFor(activeId)} – Showcase`;
    main.scrollToTop();
  }, [activeId]);

  return (
    <div class="main" ref={main.ref} style="padding: 1rem; padding-top: 0;">
      <header class="topbar" style="position: sticky; top: 0rem">
        <div class="row" style="width: 100%">
          <a role="button" class="icon" href={`${path}/dashboard`}>
            <Icon name="Home" />
          </a>
          <div>
            <h1>Showcase</h1>
            <p>Every component in drycms, with the markup that produces it.</p>
          </div>
          <span class="badge outline" style="margin-left: auto;">
            v0.0.1
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div class="showcase">
        <aside
          class="showcase-nav"
          aria-label="Showcase sections"
          ref={nav.ref}
        >
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
                style="text-align: left;"
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
    </div>
  );
}

/** Native ARIA tabs need a little glue JS - re-wired on every mount since only
 * the active showcase demo stays in the tree. */
function TabsDemoPreview() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const group = ref.current;
    if (!group) return;
    const onClick = (event: MouseEvent) => {
      const tab = (event.target as HTMLElement).closest('[role="tab"]');
      if (!tab || !group.contains(tab)) return;
      for (const other of group.querySelectorAll('[role="tab"]')) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        const panelId = other.getAttribute("aria-controls");
        const panel = panelId && document.getElementById(panelId);
        if (panel) panel.toggleAttribute("hidden", !selected);
      }
    };
    group.addEventListener("click", onClick);
    return () => group.removeEventListener("click", onClick);
  }, []);

  return (
    <div class="stack" style="width: 100%" data-tabs ref={ref}>
      <div role="tablist">
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
                <div class="swatch" key={intent} data-tooltip={`--dry-${intent === "secondary" ? "secondary-main" : intent}`}>
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
          description=".sm/.lg set the height; .icon makes a square icon-only button; .block stretches to 100% width."
          code={code.buttons!}
        >
          <button type="button" class="sm">
            Small
          </button>
          <button type="button">Default</button>
          <button type="button" class="lg">
            Large
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
          description=".badge plus a colour class (soft fill by default); add .filled for a solid fill."
          code={code.badges!}
        >
          <div class="stack" style="width: 100%">
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
              <h4>Heads up</h4>
              <p>
                This dashboard ships with sample data until a content source is
                wired up.
              </p>
            </div>
            <div class="alert success">
              <h4>Published</h4>
              <p>Your entry is now live.</p>
            </div>
            <div class="alert warning">
              <h4>Unsaved changes</h4>
              <p>Leaving this page will discard them.</p>
            </div>
            <div class="alert destructive">
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
          description=".progress-circle - --value (0-100) drives the ring via an SVG stroke-dasharray."
          code={code.progressCircle!}
        >
          <div class="row" style="gap: 1.5rem">
            <div class="progress-circle" style="--value: 72">
              <svg viewBox="0 0 36 36">
                <circle
                  class="track"
                  cx="18"
                  cy="18"
                  r="16"
                  pathLength="100"
                ></circle>
                <circle
                  class="value"
                  cx="18"
                  cy="18"
                  r="16"
                  pathLength="100"
                ></circle>
              </svg>
              <span>72%</span>
            </div>
            <div class="progress-circle indeterminate">
              <svg viewBox="0 0 36 36">
                <circle
                  class="track"
                  cx="18"
                  cy="18"
                  r="16"
                  pathLength="100"
                ></circle>
                <circle
                  class="value"
                  cx="18"
                  cy="18"
                  r="16"
                  pathLength="100"
                ></circle>
              </svg>
            </div>
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
            <input type="range" value="60" />
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
          description="Pure CSS, from the data-tooltip attribute (its value is the message, like title)."
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

    default:
      return null;
  }
}
