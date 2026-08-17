/**
 * The right-docked builder panel's shared width constraints. `CodePanel` and
 * `VeiEntryFrame` occupy the SAME footprint (only ever one at a time -
 * `panelMode` is `"code"` or `"vei"`, never both) and drive the ONE
 * `panelWidth` number `PageBuilder.tsx` persists and the preview's own
 * `right` offset tracks, so a drag in either mode has to land in the same
 * range - otherwise switching modes would silently jump the panel's width.
 */
export const BUILDER_PANEL_WIDTH = { initial: 480, min: 320, max: 900 };

export function clampBuilderPanelWidth(width: number): number {
  return Math.min(BUILDER_PANEL_WIDTH.max, Math.max(BUILDER_PANEL_WIDTH.min, width));
}
