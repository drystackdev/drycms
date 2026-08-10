import Prism from "prismjs";
import "prismjs/components/prism-jsx";

/**
 * The single place `prismjs` and its language grammars are loaded, so every
 * call site shares one registry (and one place to add a language).
 *
 * Import THIS rather than `prismjs` directly: a language file only registers
 * its grammar as a side effect of being imported, and getting that side
 * effect to happen exactly once, in the right order, is not something a call
 * site can express on its own - see `vite.config.ts`'s
 * `prismjsLanguagesPlugin` for the ordering hazard.
 */
export default Prism;
