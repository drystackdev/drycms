/**
 * Joins class names, skipping any falsy value - e.g. `cn("p-2", active && "font-bold")`.
 * The same helper shadcn/ui components import from "@/lib/utils" everywhere;
 * this project's own path for it is "@component/lib/utils", so a pasted
 * shadcn component only needs that one import path changed. Hand-rolled
 * instead of the real `clsx` + `tailwind-merge` packages shadcn itself uses
 * (neither is installed here) - conflicting Tailwind classes aren't
 * de-duped by specificity the way `tailwind-merge` would, just left in
 * source order for the browser's own cascade to resolve.
 */
export type ClassValue = string | number | boolean | null | undefined | ClassValue[];

function flatten(value: ClassValue, into: string[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, into);
    return;
  }
  into.push(String(value));
}

export function cn(...values: ClassValue[]): string {
  const classes: string[] = [];
  for (const value of values) flatten(value, classes);
  return classes.join(" ");
}
