import type { IconProps } from "../icons.js";
import type { CellHAlign, CellVAlign } from "./schema.js";

const H_INDEX: Record<CellHAlign, number> = { left: 0, center: 1, right: 2 };
const V_INDEX: Record<CellVAlign, number> = { top: 0, middle: 1, bottom: 2 };

/** 16px grid: 3 squares (`CELL`) + 2 gaps (`GAP`) exactly fill the viewBox. */
const CELL = 4;
const GAP = 2;
const POS = [0, CELL + GAP, (CELL + GAP) * 2];

export interface CellAlignIconProps extends IconProps {
  /** Which of the 9 dots reads as "current" - defaults match
   * `getCellAlignState`'s own no-selection fallback (`table.ts`). */
  hAlign?: CellHAlign;
  vAlign?: CellVAlign;
  /** Selection spans cells with different alignments - no single dot can
   * speak for all of them, so every dot dims equally (same "no answer"
   * idiom as the grid picker's own `!mixed &&` active check). */
  mixed?: boolean;
}

/**
 * Hand-added exception to the generated `icons.tsx` (`scripts/build-icons.mjs`
 * only embeds icons looked up by Solar/Lucide id from `icons.config.json`) -
 * the requested 3x3 cell-position glyph has no equivalent in either icon set.
 * Built from 9 plain `<rect>`s (rather than a fixed hand-drawn path) so the
 * highlighted dot can track the cell's actual `hAlign`/`vAlign` instead of
 * always sitting top-left.
 */
export function CellAlignIcon({ hAlign = "left", vAlign = "middle", mixed = false, ...props }: CellAlignIconProps) {
  const activeCol = H_INDEX[hAlign];
  const activeRow = V_INDEX[vAlign];
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" {...props}>
      {POS.map((y, row) =>
        POS.map((x, col) => (
          <rect
            key={`${row}-${col}`}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            rx="1.2"
            fill="currentColor"
            opacity={!mixed && row === activeRow && col === activeCol ? 1 : 0.3}
          />
        )),
      )}
    </svg>
  );
}
