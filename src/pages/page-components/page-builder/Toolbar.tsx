import { EditingDock } from "../../../apps/vei/Dock.js";
import { CodeFieldTypeIcon, EditIcon, MenuIcon, SaveIcon } from "../../../components/icons/index.js";

export type BuilderPanelMode = "vei" | "code" | null;

/**
 * The floating bottom-left toolbar `plans/new-ui-page-builder.md` mục 4
 * describes - `apps/vei/Dock.tsx`'s `EditingDock` reused verbatim (same
 * component, same interaction/animation logic), extended with the 2 buttons
 * that idea needs and `EditingDock` doesn't have on its own: opening the
 * bubble menu, and toggling VEI mode. No `EditButtonDock` state here - Page
 * Builder is already "in edit mode" the moment the route is open, unlike the
 * public site's dock (which starts collapsed until an admin opts in).
 */
export interface ToolbarProps {
  onExit: () => void;
  onOpenMenu: () => void;
  panelMode: BuilderPanelMode;
  onTogglePanel: (mode: Exclude<BuilderPanelMode, null>) => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveCount: number;
}

export default function Toolbar(props: ToolbarProps) {
  return (
    <EditingDock
      initialMode="panel"
      showModeToggle={false}
      showExit={false}
      onExit={props.onExit}
      onPreviewAll={() => {}}
      onSave={props.onSave}
      saveDisabled={props.saveDisabled}
      saveIcon={<SaveIcon />}
      saveCount={props.saveCount}
      onReady={() => {}}
      extraActions={
        <>
          <button type="button" class="icon ghost round" aria-label="Open file menu" title="Page, component, style, MD files" onClick={props.onOpenMenu}>
            <MenuIcon />
          </button>
          <button type="button" class="icon ghost round panel-mode" aria-label="Visual editing" aria-pressed={props.panelMode === "vei"} title="Visual editing" onClick={() => props.onTogglePanel("vei")}>
            <EditIcon />
          </button>
          <button type="button" class="icon ghost round panel-mode" aria-label="Code editor" aria-pressed={props.panelMode === "code"} title="Code editor" onClick={() => props.onTogglePanel("code")}>
            <CodeFieldTypeIcon />
          </button>
        </>
      }
    />
  );
}
