import type { ComponentChild, Fragment, h } from "preact";
import { transform } from "sucrase";

/**
 * Compiles a bare TSX expression (e.g. `<div style={{...}}>...</div>`)
 * entirely in the browser and evaluates it into a Preact vnode. Only the
 * `"jsx"` transform is enabled - `jsxPragma`/`jsxFragmentPragma` point
 * sucrase's classic-runtime output straight at the caller's own `h`/
 * `Fragment` (no React shim needed). Any `import`/`export` statement in
 * `code` passes through untouched (the `"imports"` transform is off) and
 * surfaces as a `SyntaxError` from `new Function` below - a real ES module
 * import isn't supported by this demo, but the failure is a clear build
 * error rather than a silent no-op.
 */
export function transformTsxToElement(
  code: string,
  hFn: typeof h,
  FragmentValue: typeof Fragment,
): ComponentChild {
  const { code: transformed } = transform(code, {
    transforms: ["jsx"],
    jsxPragma: "h",
    jsxFragmentPragma: "Fragment",
    production: true,
  });
  const cleanCode = transformed.replace(/;\s*$/, "");
  // eslint-disable-next-line no-new-func
  const renderFn = new Function("h", "Fragment", `return (${cleanCode})`);
  return renderFn(hFn, FragmentValue) as ComponentChild;
}
