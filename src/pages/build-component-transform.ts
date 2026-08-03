import type { ComponentChild, ComponentType, Fragment, h } from "preact";
import { transform } from "sucrase";

/**
 * Compiles TSX entirely in the browser and evaluates it into a Preact vnode.
 * Both a bare JSX expression and a small module-style
 * `export default function Component() { return <div />; }` are supported.
 * Only the `"jsx"` transform is enabled - `jsxPragma`/`jsxFragmentPragma`
 * point sucrase's classic-runtime output straight at the caller's own `h`/
 * `Fragment` (no React shim needed). Real imports remain unsupported because
 * this preview deliberately has no module loader.
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
  const defaultExport = /^\s*export\s+default\s+/m.test(transformed);
  if (defaultExport) {
    const componentCode = transformed.replace(
      /(^\s*)export\s+default\s+/m,
      "$1const __defaultComponent = ",
    );
    // eslint-disable-next-line no-new-func
    const loadComponent = new Function(
      "h",
      "Fragment",
      `${componentCode}\nreturn __defaultComponent;`,
    );
    const Component = loadComponent(hFn, FragmentValue) as ComponentType<{}>;
    return hFn(Component, {}) as ComponentChild;
  }

  const cleanCode = transformed.replace(/;\s*$/, "");
  // eslint-disable-next-line no-new-func
  const renderFn = new Function("h", "Fragment", `return (${cleanCode})`);
  return renderFn(hFn, FragmentValue) as ComponentChild;
}
