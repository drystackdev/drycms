import Dock from "./Dock.js";
import { CodeFieldTypeIcon, EditIcon, HistoryIcon, MenuIcon, SaveIcon } from "../../../components/icons/index.js";

export type BuilderPanelMode = "vei" | "code" | null;

/**
 * The floating bottom-left toolbar `plans/new-ui-page-builder.md` mục 4
 * describes - `Dock.tsx` plus the buttons only Page Builder has: the bubble
 * file menu, and the VEI/code panel toggles. No collapsed "Edit" state here -
 * Page Builder is already in edit mode the moment the route is open, unlike
 * the public site's old dock (which started collapsed until an admin opted
 * in).
 */
export interface ToolbarProps {
  /** Leaves for the public page currently open in the preview. */
  onExit: () => void;
  onDashboard: () => void;
  onOpenMenu: () => void;
  panelMode: BuilderPanelMode;
  onTogglePanel: (mode: Exclude<BuilderPanelMode, null>) => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveCount: number;
  onOpenHistory?: () => void;
}

export default function Toolbar(props: ToolbarProps) {
  return (
    <Dock
      onExit={props.onExit}
      onDashboard={props.onDashboard}
      onSave={props.onSave}
      saveDisabled={props.saveDisabled}
      saveIcon={<SaveIcon />}
      saveCount={props.saveCount}
      extraActions={
        <>
          {props.onOpenHistory && <button type="button" class="icon ghost round" aria-label="Page source history" title="History" onClick={props.onOpenHistory}><HistoryIcon /></button>}
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
