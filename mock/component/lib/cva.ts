import { cn, type ClassValue } from "@component/lib/utils";

/**
 * Hand-rolled stand-in for shadcn/ui's own `class-variance-authority`
 * package - same `variants`/`defaultVariants`/`compoundVariants` shape and
 * the same two exports (`cva`, `VariantProps`), so a real shadcn
 * component's code only needs its `class-variance-authority`/`@/lib/utils`
 * imports repointed at `@component/lib/cva`/`@component/lib/utils` to work.
 * Not the real package - it isn't importable from page/component source at
 * all (this project's browser build pipeline only resolves `preact`/
 * `preact/hooks` as bare npm specifiers, see `page-build.ts`'s
 * `NPM_ALLOWLIST`) - just enough of its surface to declare a variant's
 * class map ONCE and pick the right classes from a props object, instead of
 * hand-combining several `Record<Variant, string>` maps per component.
 */

type VariantOptions = Record<string, ClassValue>;
type VariantsConfig = Record<string, VariantOptions>;

/** The chosen value for each variant axis - `undefined`/`null` (or simply
 * omitted) falls back to `defaultVariants`. */
type VariantSelection<V extends VariantsConfig> = { [K in keyof V]?: keyof V[K] | null };

type CompoundVariant<V extends VariantsConfig> = { [K in keyof V]?: keyof V[K] } & { class: ClassValue };

export interface CvaConfig<V extends VariantsConfig> {
  variants?: V;
  defaultVariants?: { [K in keyof V]?: keyof V[K] };
  /** Extra classes applied only when EVERY listed axis matches its given
   * value at once (e.g. `{ variant: "outline", size: "icon", class: "..." }`)
   * - for a combination that needs something neither axis's own class
   * covers alone. */
  compoundVariants?: CompoundVariant<V>[];
}

export type CvaProps<V extends VariantsConfig> = VariantSelection<V> & { class?: ClassValue };

/** `VariantProps<typeof buttonVariants>` - the prop bag a `cva()` result
 * accepts, extracted from the function itself so a component's own props
 * interface can `extends VariantProps<typeof buttonVariants>` instead of
 * redeclaring every variant axis by hand - the same role shadcn's own
 * `VariantProps` type plays. */
export type VariantProps<T extends (props?: any) => string> = NonNullable<Parameters<T>[0]>;

export function cva<V extends VariantsConfig>(base: ClassValue, config?: CvaConfig<V>) {
  const variants = config?.variants;
  const defaultVariants = config?.defaultVariants;
  const compoundVariants = config?.compoundVariants;

  return function resolveVariants(props?: CvaProps<V>): string {
    const picked: ClassValue[] = [];
    if (variants) {
      for (const axis of Object.keys(variants) as (keyof V)[]) {
        const chosen = (props?.[axis] ?? defaultVariants?.[axis]) as keyof VariantOptions | undefined;
        if (chosen !== undefined && chosen !== null) picked.push(variants[axis]![chosen]);
      }
    }
    if (compoundVariants && variants) {
      for (const rule of compoundVariants) {
        // Every axis a rule mentions must match; an axis it leaves out is
        // unconstrained (matches regardless of what's chosen for it).
        const matches = (Object.keys(variants) as (keyof V)[]).every((axis) => {
          const required = rule[axis];
          return required === undefined || (props?.[axis] ?? defaultVariants?.[axis]) === required;
        });
        if (matches) picked.push(rule.class);
      }
    }
    return cn(base, ...picked, props?.class);
  };
}
