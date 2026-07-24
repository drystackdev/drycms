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
  groups,
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
          html={code.colors!}
        />
      );

    case "typography":
      return (
        <Demo
          id="typography"
          title="Typography"
          description="Bare tags, no classes needed here."
          html={code.typography!}
        />
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
          html={code.layout!}
        />
      );

    case "buttons":
      return (
        <Demo
          id="buttons"
          title="Button sizes"
          description=".sm/.lg set the height; .icon makes a square icon-only button; .block stretches to 100% width."
          html={code.buttons!}
        />
      );

    case "button-variants":
      return (
        <Demo
          id="button-variants"
          title="Button variants"
          description="Colour classes, optionally softened with .soft."
          html={code.buttonVariants!}
        />
      );

    case "button-states":
      return (
        <Demo
          id="button-states"
          title="Button states"
          description="All real attributes, no classes: disabled and aria-busy are native/ARIA state, not variants."
          html={code.buttonStates!}
        />
      );

    case "cards":
      return (
        <Demo
          id="cards"
          title="Cards"
          description=".card is the container; .flush removes its padding so a table or list can run edge to edge."
          html={code.cards!}
        />
      );

    case "badges":
      return (
        <Demo
          id="badges"
          title="Badges"
          description=".badge plus a colour class (soft fill by default); add .filled for a solid fill."
          html={code.badges!}
        />
      );

    case "alerts":
      return (
        <Demo
          id="alerts"
          title="Alerts"
          description=".alert plus a colour class; no class at all defaults to the neutral/info look."
          html={code.alerts!}
        />
      );

    case "table":
      return (
        <Demo
          id="table"
          title="Table"
          description="Plain table markup; .numeric right-aligns and tabularises."
          html={code.table!}
        />
      );

    case "avatar":
      return (
        <Demo
          id="avatar"
          title="Avatar"
          description=".avatar plus the shared .sm/.lg size classes."
          html={code.avatar!}
        />
      );

    case "progress":
      return (
        <Demo
          id="progress"
          title="Progress"
          description="Native <progress>, no classes - value/max are the real attributes that drive it."
          html={code.progress!}
        />
      );

    case "skeleton":
      return (
        <Demo
          id="skeleton"
          title="Skeleton"
          description=".skeleton - width, height and border-radius are set inline per use."
          html={code.skeleton!}
        />
      );

    case "empty":
      return (
        <Demo
          id="empty"
          title="Empty state"
          description=".empty - a dashed placeholder for zero-state screens."
          html={code.empty!}
        />
      );

    case "text-inputs":
      return (
        <Demo
          id="text-inputs"
          title="Text inputs"
          description=".sm/.lg size classes; readonly and disabled are real attributes."
          html={code.textInputs!}
        />
      );

    case "select":
      return (
        <Demo
          id="select"
          title="Select & textarea"
          description="Native elements, no classes at all."
          html={code.select!}
        />
      );

    case "toggles":
      return (
        <Demo
          id="toggles"
          title="Checkbox & radio"
          description="Real attributes only (checked, indeterminate); .field.inline lays out the pair horizontally."
          html={code.toggles!}
        />
      );

    case "other-inputs":
      return (
        <Demo
          id="other-inputs"
          title="Range, color and file"
          description="Native input types, no classes."
          html={code.otherInputs!}
        />
      );

    case "fields":
      return (
        <Demo
          id="fields"
          title="Fields & validation"
          description=".field groups a label, control and hint or error."
          html={code.fields!}
        />
      );

    /* `tabs` stays read-only: its live behaviour is wired by TabsDemoPreview's
     * own effect, which a raw innerHTML render of edited text can't drive. */
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
          html={code.accordion!}
        />
      );

    case "breadcrumb":
      return (
        <Demo
          id="breadcrumb"
          title="Breadcrumb"
          description=".breadcrumb on an <ol>; aria-current marks the active page."
          html={code.breadcrumb!}
        />
      );

    case "tooltip":
      return (
        <Demo
          id="tooltip"
          title="Tooltip"
          description="Pure CSS, from the data-tooltip attribute (its value is the message, like title)."
          html={code.tooltip!}
        />
      );

    case "separator":
      return (
        <Demo
          id="separator"
          title="Separator"
          description=".separator; aria-orientation flips it vertical."
          html={code.separator!}
        />
      );

    case "dialog":
      return (
        <Demo
          id="dialog"
          title="Dialog"
          description="Native dialog, opened and closed with command/commandfor - no JS."
          html={code.dialog!}
        />
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
