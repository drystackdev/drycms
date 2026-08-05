/**
 * Every drycms global UI behaviour that's plain DOM/TS with no framework
 * involved - tooltip, range-fill, tabs, theme toggle - in one place.
 * Importing this module (instead of each one individually) is enough to
 * activate all of them; each wires itself up once on import, so this is
 * safe to import from a Preact app (see `App.tsx`) or, compiled, drop
 * straight into a plain HTML page that never touches Preact at all.
 *
 * Add new framework-free behaviours here as they're written.
 */

import './tooltip.js';
import './range.js';
import './tabs.js';
import './theme.js';
import { installCsrfFetch } from "./csrf-fetch.js";

installCsrfFetch();
