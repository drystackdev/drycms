import type { ComponentType, JSX } from "preact";

/**
 * Minimal Zod-like schema builder for a registered richtext component's
 * props - hand-rolled (no `zod` dependency, see `status/register-compoennt.md`)
 * since the only things needed are: a handful of leaf kinds, `.required()`/
 * `.default()` chaining, and a TS type that falls straight out of it via
 * `InferField`/`InferShape` below. `FieldDef` objects are immutable - each
 * chain method returns a *new* one rather than mutating in place, since
 * `.required()` needs to change the type parameter (`Req`), which nothing
 * can do to an already-created value.
 */
export type FieldKind = "string" | "int" | "image" | "array" | "object" | "boolean";

export interface FieldDef<T, Req extends boolean = boolean> {
  readonly kind: FieldKind;
  readonly req: Req;
  readonly defaultValue: T | undefined;
  /** Only set when `kind === "array"` - the element type's own `FieldDef`. */
  readonly inner?: FieldDef<unknown>;
  /** Only set when `kind === "object"` - the nested shape. */
  readonly shape?: Record<string, FieldDef<unknown>>;
  /** Item-count bounds - only ever set on an `array` field (`array(item, {min,
   * max})`, or `images({min, max})`'s own sugar for it). Same `min`/`max`
   * naming the main content-types system uses for item-count bounds on a
   * multi Relation/repeatable Component/multi Select field
   * (`field-registry.ts`'s `ITEM_COUNT_VALIDATION`) - stored under
   * `minCount`/`maxCount` here only to avoid colliding with a same-named
   * chain *method* (same reason `req`/`defaultValue` back `required()`/
   * `default()` instead of reusing those names directly). */
  readonly minCount?: number;
  readonly maxCount?: number;
  /** Character-length bounds - only ever set on a `string` field. Same
   * `minLength`/`maxLength` naming the main content-types system uses for a
   * text field's own length validation (`field-registry.ts`'s
   * `textFieldType.validationFields`). */
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Shown under the field's label in the props-edit dialog
   * (`dry-component-props-form.tsx`) - same `label` + `<small>{description}</small>`
   * shape `ComponentField.tsx`'s own field wrapper uses. */
  readonly description?: string;
  required(): FieldDef<T, true>;
  default(value: T): FieldDef<T, Req>;
}

function makeField<T, Req extends boolean>(
  kind: FieldKind,
  req: Req,
  defaultValue: T | undefined,
  extra?: Pick<FieldDef<T>, "inner" | "shape" | "minCount" | "maxCount" | "minLength" | "maxLength" | "description">,
): FieldDef<T, Req> {
  return {
    kind,
    req,
    defaultValue,
    inner: extra?.inner,
    shape: extra?.shape,
    minCount: extra?.minCount,
    maxCount: extra?.maxCount,
    minLength: extra?.minLength,
    maxLength: extra?.maxLength,
    description: extra?.description,
    required: () => makeField<T, true>(kind, true, defaultValue, extra),
    default: (value: T) => makeField<T, Req>(kind, req, value, extra),
  };
}

export type InferField<F> = F extends FieldDef<infer T, infer Req>
  ? Req extends true
    ? T
    : T | undefined
  : never;

export type InferShape<S extends Record<string, FieldDef<unknown>>> = {
  [K in keyof S]: InferField<S[K]>;
};

function string(opts?: { minLength?: number; maxLength?: number; description?: string }): FieldDef<string, false> {
  return makeField<string, false>("string", false, undefined, {
    minLength: opts?.minLength,
    maxLength: opts?.maxLength,
    description: opts?.description,
  });
}

function int(opts?: { description?: string }): FieldDef<number, false> {
  return makeField<number, false>("int", false, undefined, { description: opts?.description });
}

function image(opts?: { description?: string }): FieldDef<string, false> {
  return makeField<string, false>("image", false, undefined, { description: opts?.description });
}

function boolean(opts?: { description?: string }): FieldDef<boolean, false> {
  return makeField<boolean, false>("boolean", false, false, { description: opts?.description });
}

function array<F extends FieldDef<unknown>>(
  item: F,
  opts?: { min?: number; max?: number; description?: string },
): FieldDef<InferField<F>[], false> {
  return makeField<InferField<F>[], false>("array", false, undefined, {
    inner: item as FieldDef<unknown>,
    minCount: opts?.min,
    maxCount: opts?.max,
    description: opts?.description,
  });
}

/** Sugar for `array(image(), opts)` - a multi-image picker with the same
 * item-count bounds any other `array` field can take. */
function images(opts?: { min?: number; max?: number; description?: string }) {
  return array(image(), opts);
}

function object<Shape extends Record<string, FieldDef<unknown>>>(
  shape: Shape,
  opts?: { description?: string },
): FieldDef<InferShape<Shape>, false> {
  return makeField<InferShape<Shape>, false>("object", false, undefined, { shape, description: opts?.description });
}

export interface PropsBuilder {
  <S extends Record<string, FieldDef<unknown>>>(shape: S): S;
  string: typeof string;
  int: typeof int;
  image: typeof image;
  images: typeof images;
  boolean: typeof boolean;
  array: typeof array;
  object: typeof object;
}

const p = ((shape) => shape) as PropsBuilder;
p.string = string;
p.int = int;
p.image = image;
p.images = images;
p.boolean = boolean;
p.array = array;
p.object = object;

/** `.default()` per field, but optional - a field left without one falls
 * back to an empty/zero value for its own `kind` (recursing into `object`)
 * so a component doesn't have to declare defaults for every single field
 * just to be previewable (mục 1/3, `status/register-compoennt.md`). */
function fallbackDefault(field: FieldDef<unknown>): unknown {
  switch (field.kind) {
    case "string":
    case "image":
      return "";
    case "int":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return resolveDefaults(field.shape!);
  }
}

function resolveDefaults(shape: Record<string, FieldDef<unknown>>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const field = shape[key]!;
    defaults[key] = field.defaultValue !== undefined ? field.defaultValue : fallbackDefault(field);
  }
  return defaults;
}

export interface DryComponentConfig<S extends Record<string, FieldDef<unknown>> = Record<string, never>> {
  label: string;
  /** Shown alongside the label wherever this component is listed (the
   * component management admin page, mục 3, and the richtext editor's own
   * insert dialog, mục 4) - a short blurb helping whoever's authoring
   * content tell components apart without opening each one. */
  description?: string;
  /** Free-form version string shown as a badge on the component management
   * admin page's card (`RichtextComponents.tsx`), below the label - purely
   * informational, no semver parsing/enforcement. @default "0.0.0" */
  version?: string;
  /** Free-form auth/permission requirement shown as its own badge next to
   * `version` above - purely informational, not enforced anywhere. Shown as
   * an italic "None" when left unset. */
  auth?: string;
  /** @default "inline" */
  type?: "inline" | "block";
  /** Mount this component's render into its own shadow root. @default true */
  shadow?: boolean;
  /** CSS text injected into this component's own shadow root as a `<style>`
   * element (`dry-component-runtime.ts`, alongside its own Preact render) -
   * sugar for what a component would otherwise have to embed itself via
   * `<style>{css}</style>` somewhere in its own JSX tree. Requires
   * `shadow: true` (there's no shadow root to scope it to otherwise) -
   * ignored with a console warning otherwise, same as `children` below. */
  style?: string;
  /** Accept nested rich-text content, projected wherever the component's own
   * render places a native `<slot />` element - ordinary browser slot
   * projection, not a prop: the editor's own real editable content lives as
   * this instance's light-DOM children (untouched by this component's own
   * render), and the browser projects them into the `<slot />` inside the
   * shadow tree Preact renders. Requires `shadow: true` (slot projection
   * only happens inside a shadow tree) and `type: "block"` (an inline
   * component has no outer block context to hold nested block content) -
   * ignored with a console warning otherwise. @default false
   *
   * A string instead of `true` enables the same thing AND doubles as default
   * light-DOM HTML - used *only* by `ComponentPreview` (the admin grid/insert
   * dialog's "no real editor content yet" preview, `dry-component-runtime.ts`
   * `#render` never touches the host element's own light DOM), set as its raw
   * `innerHTML` so the browser's own `<slot>` projection shows *something*
   * there. Not parsed into ProseMirror content - a freshly-inserted instance
   * still starts from a single empty paragraph (`dry-component-insert-button.tsx`). */
  children?: boolean | string;
  /** Other DryComponents used by this component's markup. References are
   * registered before this component, so `<dry-child>` also works in a
   * preview string and in nested light-DOM content. */
  refs?: readonly DryComponentDefinition<any>[];
  /** Optional - a component with nothing to configure (a static block, say)
   * doesn't need a schema at all; omitting this is the same as
   * `props: (p) => p({})`. */
  props?: (p: PropsBuilder) => S;
  component: (props: InferShape<S>) => JSX.Element | null;
}

export interface DryComponentDefinition<S extends Record<string, FieldDef<unknown>> = Record<string, FieldDef<unknown>>> {
  readonly __dryComponent: true;
  name: string;
  label: string;
  description: string;
  version: string;
  auth: string;
  type: "inline" | "block";
  shadow: boolean;
  /** Only set when `config.style` survived the `shadow: true` requirement -
   * see its own doc comment on `DryComponentConfig`. */
  style?: string;
  children: boolean;
  /** Only set when `config.children` was a string - see its own doc comment
   * on `DryComponentConfig`. */
  childrenDefaultHtml?: string;
  refs: readonly DryComponentDefinition<any>[];
  schema: S;
  defaults: InferShape<S>;
  component: ComponentType<InferShape<S>>;
  /** Updates the definition in place and returns the same definition. This is
   * useful when a component is declared first and its refs/metadata are added
   * after declaration. */
  update(patch: Partial<DryComponentConfig<S>>): DryComponentDefinition<S>;
}

/**
 * Wraps a Preact component + its props schema into the shape the richtext
 * editor's discover step recognizes (`__dryComponent` marker - see mục 1/2
 * of `status/register-compoennt.md`). Resolves `props(p)` and the defaults
 * eagerly here, so what gets persisted to storage later is always a plain,
 * already-resolved object - never the builder function itself.
 */
export function DryComponent<S extends Record<string, FieldDef<unknown>> = Record<string, never>>(
  config: DryComponentConfig<S>,
): DryComponentDefinition<S> {
  const inferredName = kebabCase(config.component.name);
  const schema = (config.props?.(p) ?? {}) as S;
  const type = config.type ?? "inline";
  const shadow = config.shadow ?? true;
  let style = config.style;
  if (style !== undefined && !shadow) {
    console.warn(`[drycms] Richtext component "${inferredName || "(unnamed)"}": "style" requires "shadow: true" - ignoring.`);
    style = undefined;
  }
  let children = config.children !== undefined && config.children !== false;
  let childrenDefaultHtml = typeof config.children === "string" ? config.children : undefined;
  let refs = config.refs ?? [];
  if (refs.length > 0 && !children) {
    console.warn(`[drycms] Richtext component "${inferredName || "(unnamed)"}": "refs" requires "children" - ignoring.`);
    refs = [];
  }
  if (children && (!shadow || type !== "block")) {
    console.warn(
      `[drycms] Richtext component "${inferredName || "(unnamed)"}": "children" requires "shadow: true" and "type: \\"block\\"" - ignoring.`,
    );
    children = false;
    childrenDefaultHtml = undefined;
  }
  if (!children) refs = [];
  const definition = {
    __dryComponent: true,
    name: inferredName,
    label: config.label,
    description: config.description ?? "",
    version: config.version ?? "0.0.0",
    auth: config.auth ?? "",
    type,
    shadow,
    style,
    children,
    childrenDefaultHtml,
    refs,
    schema,
    defaults: resolveDefaults(schema) as InferShape<S>,
    component: config.component,
  } as DryComponentDefinition<S>;

  definition.update = (patch) => {
    if (patch.label !== undefined) definition.label = patch.label;
    if (patch.description !== undefined) definition.description = patch.description;
    if (patch.version !== undefined) definition.version = patch.version;
    if (patch.auth !== undefined) definition.auth = patch.auth;
    if (patch.component !== undefined) definition.component = patch.component;
    if (patch.props !== undefined) {
      definition.schema = patch.props(p) as S;
      definition.defaults = resolveDefaults(definition.schema) as InferShape<S>;
    }

    const nextType = patch.type ?? definition.type;
    const nextShadow = patch.shadow ?? definition.shadow;
    let nextChildren = patch.children === undefined ? definition.children : patch.children !== false;
    let nextChildrenDefaultHtml =
      typeof patch.children === "string" ? patch.children : definition.childrenDefaultHtml;
    let nextStyle = patch.style === undefined ? definition.style : patch.style;
    let nextRefs = patch.refs === undefined ? definition.refs : patch.refs;

    if (nextStyle !== undefined && !nextShadow) nextStyle = undefined;
    if (nextChildren && (!nextShadow || nextType !== "block")) {
      nextChildren = false;
      nextChildrenDefaultHtml = undefined;
    }
    if (!nextChildren) {
      nextRefs = [];
      nextChildrenDefaultHtml = undefined;
    }

    definition.type = nextType;
    definition.shadow = nextShadow;
    definition.style = nextStyle;
    definition.children = nextChildren;
    definition.childrenDefaultHtml = nextChildrenDefaultHtml;
    definition.refs = nextRefs;
    return definition;
  };

  return definition;
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Derives `color-text` from `/src/widgets/dry.color-text.tsx`. */
export function dryComponentNameFromSourcePath(sourcePath: string): string | undefined {
  const file = sourcePath.split("/").pop() ?? "";
  const match = file.match(/^dry[.-](.+)\.(?:tsx?|jsx?)$/i);
  return match?.[1] ? kebabCase(match[1]) : undefined;
}

/** Discriminates a file's default export (whatever `import.meta.glob`'s
 * lazy loader resolves to) as a genuine `DryComponent(...)` result -
 * shared by `RichtextComponents.tsx` (mục 3, filtering scanned files down
 * to valid ones) and `ComponentPreview.tsx` (unwrapping `mod.default` to
 * find the real Preact component at `.component`, since the module's
 * default export is this whole wrapper object, not the component itself). */
export function isDryComponentDefinition(value: unknown): value is DryComponentDefinition {
  return !!value && typeof value === "object" && (value as { __dryComponent?: unknown }).__dryComponent === true;
}
