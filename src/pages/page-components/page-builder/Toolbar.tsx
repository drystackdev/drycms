import { useRef } from "preact/hooks";
import { EditingDock, type EditingDockHandle, type EditorMode } from "../../../apps/vei/Dock.js";
import { MenuIcon } from "../../../components/icons/index.js";

/**
 * The floating bottom-right toolbar `plans/new-ui-page-builder.md` mục 4
 * describes - `apps/vei/Dock.tsx`'s `EditingDock` reused verbatim (same
 * component, same interaction/animation logic), extended with the 2 buttons
 * that idea needs and `EditingDock` doesn't have on its own: opening the
 * bubble menu, and toggling VEI mode. No `EditButtonDock` state here - Page
 * Builder is already "in edit mode" the moment the route is open, unlike the
 * public site's dock (which starts collapsed until an admin opts in).
 */
export interface ToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onExit: () => void;
  onOpenMenu: () => void;
  veiEnabled: boolean;
  onToggleVei: () => void;
  onSave: () => Promise<void>;
}

export default function Toolbar(props: ToolbarProps) {
  const handleRef = useRef<EditingDockHandle | null>(null);

  async function handleSave() {
    handleRef.current?.setSaving(true);
    try {
      await props.onSave();
      handleRef.current?.setStatus("Saved");
    } catch (error) {
      handleRef.current?.setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      handleRef.current?.setSaving(false);
      setTimeout(() => handleRef.current?.setStatus(""), 2000);
    }
  }

  return (
    <EditingDock
      initialMode={props.mode}
      onModeChange={props.onModeChange}
      onExit={props.onExit}
      onPreviewAll={() => {}}
      onSave={() => void handleSave()}
      onReady={(handle) => {
        handleRef.current = handle;
      }}
      extraActions={
        <>
          <button type="button" class="icon ghost round" aria-label="Open file menu" title="Page, component, style, MD files" onClick={props.onOpenMenu}>
            <MenuIcon />
          </button>
          <button
            type="button"
            class="ghost round"
            aria-pressed={props.veiEnabled}
            title="Toggle Visual Editing (click marked content to edit it)"
            onClick={props.onToggleVei}
          >
            VEI {props.veiEnabled ? "on" : "off"}
          </button>
        </>
      }
    />
  );
}
