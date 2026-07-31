import { Plugin, PluginKey, type Command, type EditorState } from "prosemirror-state";

/**
 * ProseMirror only owns the on/off flag for reorder mode. The actual reorder
 * UI and all DOM movement live in `html-reorder-surface.ts`, which renders a
 * separate HTML snapshot while the editor itself is hidden and read-only.
 */
interface ReorderState {
  active: boolean;
}

const INACTIVE: ReorderState = { active: false };

export const reorderModeKey = new PluginKey<ReorderState>("reorderMode");

export function isReorderActive(state: EditorState): boolean {
  return reorderModeKey.getState(state)?.active ?? false;
}

export function toggleReorderMode(): Command {
  return (state, dispatch) => {
    if (dispatch) {
      dispatch(state.tr.setMeta(reorderModeKey, { active: !isReorderActive(state) }));
    }
    return true;
  };
}

export function reorderMode(): Plugin<ReorderState> {
  return new Plugin<ReorderState>({
    key: reorderModeKey,
    state: {
      init: () => INACTIVE,
      apply(tr, previous) {
        const meta = tr.getMeta(reorderModeKey) as { active?: boolean } | undefined;
        if (typeof meta?.active === "boolean") return { active: meta.active };
        return previous;
      },
    },
  });
}
