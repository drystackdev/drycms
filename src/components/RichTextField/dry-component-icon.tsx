import type { ComponentType, JSX } from "preact";
import { ComponentIcon } from "../icons.js";

type DryIcon = ComponentType<JSX.SVGAttributes<SVGSVGElement>>;

interface DryComponentIconProps {
  /** Pre-rendered SVG metadata, or a source definition's Preact icon. */
  icon?: string | DryIcon | JSX.Element;
}

/** Component records contain pre-rendered SVG markup. Render it through
 * `dangerouslySetInnerHTML`; source definitions may still pass a Preact icon
 * function in the admin discovery view. Missing/legacy icons keep fallback. */
export default function DryComponentIcon({ icon }: DryComponentIconProps) {
  if (typeof icon === "string" && icon) {
    return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />;
  }
  if (typeof icon === "function") {
    const Icon = icon;
    return <Icon aria-hidden="true" />;
  }
  if (icon) return icon;
  return <ComponentIcon />;
}
