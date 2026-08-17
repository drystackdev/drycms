import type { ComponentType } from "preact";
import { CORE_STYLE_FILE_NAMES } from "../../../server/app-router/source-roots.js";
import BaseCssFile, { DEFAULT_CONTENT as BASE_CSS_DEFAULT_CONTENT } from "./BaseCssFile.js";
import GlobalsCssFile, { DEFAULT_CONTENT as GLOBALS_CSS_DEFAULT_CONTENT } from "./GlobalsCssFile.js";
import ThemeCssFile, { DEFAULT_CONTENT as THEME_CSS_DEFAULT_CONTENT } from "./ThemeCssFile.js";

export interface CoreStyleFile {
  name: string;
  defaultContent: string;
  Card: ComponentType;
}

const BY_NAME: Record<string, { defaultContent: string; Card: ComponentType }> = {
  "globals.css": { defaultContent: GLOBALS_CSS_DEFAULT_CONTENT, Card: GlobalsCssFile },
  "theme.css": { defaultContent: THEME_CSS_DEFAULT_CONTENT, Card: ThemeCssFile },
  "base.css": { defaultContent: BASE_CSS_DEFAULT_CONTENT, Card: BaseCssFile },
};

/** `source-roots.ts`'s `CORE_STYLE_FILE_NAMES`, paired with each file's
 * default content and its display card (`PageBuilder.tsx`'s recovery check,
 * `SystemFilesPanel.tsx`'s cards) - one array built off that single name
 * list so the 2 stay impossible to drift apart. */
export const CORE_STYLE_FILES: CoreStyleFile[] = CORE_STYLE_FILE_NAMES.map((name) => ({ name, ...BY_NAME[name]! }));
