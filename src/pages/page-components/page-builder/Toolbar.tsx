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
  /** Gates the file menu, the Code editor toggle, and (via `onOpenHistory`
   * already being `undefined` when this is false - see `PageBuilder.tsx`)
   * History: all raw-source actions, backed by the single `system-build`
   * permission. */
  canEditCode: boolean;
  /** Gates the Visual editing toggle - true once the role has `view`+
   * `update`/`setting` on at least one content type, same rule the VEI panel
   * itself filters entries by. */
  canUseVei: boolean;
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
          {props.onOpenHistory && <span class="dock-action" data-tooltip="History"><button type="button" class="icon ghost round" aria-label="Page source history" onClick={props.onOpenHistory}><HistoryIcon /></button></span>}
          {props.canEditCode && <span class="dock-action" data-tooltip="Src Code"><button type="button" class="icon ghost round" aria-label="Open file menu" onClick={props.onOpenMenu}><MenuIcon /></button></span>}
          {props.canUseVei && <span class="dock-action" data-tooltip="Visual editing"><button type="button" class="icon ghost round panel-mode" aria-label="Visual editing" aria-pressed={props.panelMode === "vei"} onClick={() => props.onTogglePanel("vei")}><EditIcon /></button></span>}
          {props.canEditCode && <span class="dock-action" data-tooltip="Code editor"><button type="button" class="icon ghost round panel-mode" aria-label="Code editor" aria-pressed={props.panelMode === "code"} onClick={() => props.onTogglePanel("code")}><CodeFieldTypeIcon /></button></span>}
        </>
      }
    />
  );
}
