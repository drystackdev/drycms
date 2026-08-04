import type { PageProps } from "./render-types.js";
import type { RouteMatch } from "./match.js";

/**
 * Resolves a matched route to a plain vnode tree - `await` the page first,
 * then `await` each layout wrapping outward (root-to-leaf order reversed
 * back to leaf-to-root call order) - see `plans/app-router.md`'s "Quyết
 * định kiến trúc" #1 for why this manual resolution exists at all (a bare
 * async function component's returned `Promise` isn't something
 * `preact-render-to-string` can await on its own - confirmed by spike,
 * `render.ts`'s doc comment has the details).
 *
 * Shared by both environments: `render.ts` (server) hands the result to
 * `renderToStringAsync`; `hydrate-client.ts` hands it straight to
 * `preact-iso/hydrate` - unstringified. Any NESTED, ordinary (non-`async`)
 * component in the returned tree (e.g. a small interactive island using
 * `useState`) is left untouched here as a normal lazy vnode - Preact's own
 * dispatch (inside `renderToStringAsync`/`hydrate`) invokes those, hooks
 * and all, exactly like any other Preact tree. `async` components can't use
 * hooks themselves (confirmed by spike - see `plans/app-router.md`'s Giai
 * đoạn 2) - only a plain child component can.
 */
export async function resolveMatchToVNode(match: RouteMatch): Promise<unknown> {
  const props: PageProps = { params: match.params };
  const { default: PageComponent } = await match.page();
  let vnode = await PageComponent(props as never);

  for (const layoutLoader of [...match.layouts].reverse()) {
    const { default: LayoutComponent } = await layoutLoader();
    vnode = await LayoutComponent({ children: vnode, params: match.params } as never);
  }

  return vnode;
}
