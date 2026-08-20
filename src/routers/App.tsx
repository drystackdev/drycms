import { Component, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ErrorBoundary,
  LocationProvider,
  Route,
  Router,
  lazy,
  useLocation,
} from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import DryLayout from "../components/DryLayout.js";
import Icon from "../components/Icon.js";
import Toaster, { toast } from "../components/Toast.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import { publishAllPages } from "../page-components/initial-publish.js";
import { ensureRepoReady, fetchGitConfig } from "../page-components/git/git-state.js";
import OAuthConsent from "../pages/OAuthConsent.js";
import RegisterSuperAdmin from "../pages/RegisterSuperAdmin.js";
import SignIn from "../pages/SignIn.js";
import GithubSetup from "../pages/GithubSetup.js";
import { isVeiFrame, startVeiBridge } from "../pages/content-entry-editor/builder-bridge.js";
import BuilderBridgeFrame from "../pages/content-entry-editor/BuilderBridgeFrame.js";
import { authState, canAccess, loadSession } from "../store/auth.js";
import "../lib/native/native.js";

// Code-split per route: the whole app renders `client:only`, so nothing
// paints until its JS is downloaded, so a heavy route (the entry editor's
// RichText/code editors, Page Components) stays out of Dashboard's chunk.
const Dashboard = lazy(() => import("../pages/Dashboard.js"));
const Media = lazy(() => import("../pages/Media.js"));
const BuilderContentType = lazy(() => import("../pages/BuilderContentType.js"));
const ContentEntryList = lazy(() => import("../pages/ContentEntryList.js"));
const ContentEntryEditor = lazy(() => import("../pages/ContentEntryEditor.js"));
const AiKeyEditor = lazy(() => import("../pages/AiKeyEditor.js"));
const Profile = lazy(() => import("../pages/Profile.js"));
const McpConnect = lazy(() => import("../pages/McpConnect.js"));
const Roles = lazy(() => import("../pages/Roles.js"));
const RoleEditor = lazy(() => import("../pages/RoleEditor.js"));
const IconSearchAdd = lazy(() => import("../pages/IconSearchAdd.js"));
const RichtextComponents = lazy(() => import("../pages/RichtextComponents.js"));
const PageBuild = lazy(() => import("../pages/PageBuild.js"));
const PageBuilder = lazy(() => import("../pages/PageBuilder.js"));
const Settings = lazy(() => import("../pages/Settings.js"));
const GithubSyncSettings = lazy(() => import("../pages/GithubSyncSettings.js"));
const Versions = lazy(() => import("../pages/settings/Versions.js"));
const Backup = lazy(() => import("../pages/Backup.js"));

/** Client-side redirect - the bare base path and any unmatched path are sent
 * to `/dashboard` here. */
function Redirect({ to }: { to: string }) {
  const { route } = useLocation();
  useEffect(() => route(to, true), [to]);
  return null;
}

/** Shown in place of a crashed route once `Boundary` below catches a render
 * error. */
function CrashFallback({ onReset }: { onReset: () => void }) {
  const { route } = useLocation();
  return (
    <div class="empty" style="min-height: 60vh">
      <Icon name="AlertTriangle" size="2rem" />
      <strong>Something went wrong</strong>
      <small>This page ran into an unexpected error.</small>
      <button
        type="button"
        class="sm"
        onClick={() => {
          onReset();
          route(`${path}/dashboard`, true);
        }}
      >
        Back to dashboard
      </button>
    </div>
  );
}

/** A real Preact error boundary around the routed content, so a crash on one
 * page doesn't take out the sidebar/topbar chrome with it. Has to be a class
 * with its own `getDerivedStateFromError` - Preact only treats a thrown error
 * as "handled" (rather than rethrowing past every boundary) if the ancestor
 * whose `componentDidCatch`/`getDerivedStateFromError` ran is the one that
 * ends up marked dirty, so setting state on some *other* component (e.g. via
 * preact-iso's `<ErrorBoundary onError>`, which is only a notification hook)
 * doesn't satisfy that check. */
class Boundary extends Component<
  { children?: ComponentChildren },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <CrashFallback onReset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

/** Everything the app renders once someone is actually signed in - the exact
 * markup `App()` rendered unconditionally before the auth gate existed,
 * untouched. Split out so `AuthGate` below can render Sign in/Register
 * SuperAdmin instead, without `DryLayout`'s sidebar/topbar chrome or any of
 * these lazy route chunks ever loading for a visitor who isn't authenticated
 * yet. */
/** Page Builder's visual-editing panel frames one entry editor route inside
 * itself (`page-builder/VeiEntryFrame.tsx`), where the sidebar/topbar would
 * be noise wrapped around a compact form. `AuthGate` already establishes that
 * rendering a route without `DryLayout`'s chrome is a normal thing to do
 * here (Sign in/Register do exactly that); this is the same move for a
 * route that IS authenticated. `BuilderBridgeFrame` (not a bare passthrough)
 * replaces what skipping `DryLayout` loses - a scroll container, padding, and
 * the toast stack - at panel rather than full-page scale; see its own doc
 * comment. */
function Chrome({ children }: { children: ComponentChildren }) {
  const { path: locationPath } = useLocation();
  if (isVeiFrame()) return <BuilderBridgeFrame>{children}</BuilderBridgeFrame>;
  if (locationPath === `${path}/page-builder`) {
    return (
      <>
        {children}
        <Toaster />
      </>
    );
  }
  return <DryLayout>{children}</DryLayout>;
}

function AuthenticatedApp() {
  // Router's onLoadStart/onLoadEnd fire whenever it's waiting on a lazy
  // chunk - both the very first paint (nothing else has committed yet) and
  // later in-app navigations - so this bar is the one loading indicator for
  // both cases described in the comment above.
  const [routeLoading, setRouteLoading] = useState(false);
  const { route } = useLocation();

  // `route` is intentionally left out of the deps: it's a fresh closure every
  // render, but always dispatches through the same stable `useReducer`
  // handle underneath (`preact-iso`'s `LocationProvider`), so the one
  // captured at mount still navigates correctly later - re-running this
  // effect on every route change would tear down and re-register the whole
  // bridge (including its `vei:ready` announcement) for no reason.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => (isVeiFrame() ? startVeiBridge(route) : undefined), []);

  // Fresh-tenant "first publish" (`routes/auth.ts`'s `needsInitialPublish`,
  // `initial-publish.ts`'s own doc comment for why this can't run
  // server-side): fires once, silently, the first time this component mounts
  // with the flag set - i.e. the first authenticated admin session after a
  // deploy whose pages-source was just auto-seeded but never built. Guarded
  // by a ref (same pattern `PageBuild.tsx`'s own `ranAutoBuild` uses) so a
  // later, unrelated re-render never replays it; gated on the SAME
  // permission `PageBuild.tsx`/`PageBuilder.tsx` require for a manual build,
  // so a signed-in user without it doesn't fire a request that would just
  // 403.
  const ranInitialPublish = useRef(false);
  useEffect(() => {
    if (ranInitialPublish.current) return;
    if (!authState.value.needsInitialPublish) return;
    if (!canAccess(PAGE_BUILDER_RESOURCE_ID, "setting")) return;
    ranInitialPublish.current = true;
    void (async () => {
      const typesApi = createContentTypesApi(`${path}/api/content-types`);
      const allTypes = await listCached(typesApi);
      await publishAllPages(path, allTypes, (message) => toast.add({ type: "default", title: message }));
      authState.value = { ...authState.value, needsInitialPublish: false };
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The browser git working copy (`status/git-page-source.md`): clone on the
  // first authenticated load, fast-forward on every later one, so Page
  // Builder and the build/publish pipeline have real source to work from the
  // moment they are opened rather than starting a clone then. Fire-and-
  // forget by design - it never blocks a paint, reports through `gitState`,
  // and swallows its own failures (`ensureRepoReady`'s own doc comment).
  // Gated on the same permission Page Builder itself needs, so a
  // content-only session never pulls a megabyte of git into a tab that has
  // no use for it.
  const ranRepoReady = useRef(false);
  useEffect(() => {
    if (ranRepoReady.current) return;
    if (!canAccess(PAGE_BUILDER_RESOURCE_ID, "setting")) return;
    ranRepoReady.current = true;
    void ensureRepoReady(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* preact-iso's own `<ErrorBoundary>` - required for lazy()'s
       * suspense-style loading, unrelated to the `Boundary` below. */}
      <ErrorBoundary>
        {routeLoading && <progress class="route-progress" />}
        {/* Outside `Router` so it survives route changes - swapping it in
         * per-route remounted the sidebar (losing scroll position, replaying
         * the collapse-state flash) on every navigation. */}
        <Chrome>
          <Boundary>
            <Router
              onLoadStart={() => setRouteLoading(true)}
              onLoadEnd={() => setRouteLoading(false)}
            >
              <Route
                path={path}
                component={() => <Redirect to={`${path}/dashboard`} />}
              />
              <Route path={`${path}/dashboard`} component={Dashboard} />
              <Route path={`${path}/media`} component={Media} />
              <Route
                path={`${path}/icon-management`}
                component={IconSearchAdd}
              />
              <Route
                path={`${path}/richtext-components`}
                component={RichtextComponents}
              />
              <Route
                path={`${path}/page-build`}
                component={PageBuild}
              />
              <Route
                path={`${path}/page-builder`}
                component={PageBuilder}
              />
              <Route
                path={`${path}/content-types`}
                component={BuilderContentType}
              />
              <Route
                path={`${path}/content/aiKey/new`}
                component={() => <AiKeyEditor id="new" />}
              />
              <Route
                path={`${path}/content/aiKey/:id`}
                component={AiKeyEditor}
              />
              {/* `/new` registered before `/:id` so it isn't swallowed by the id param. */}
              <Route
                path={`${path}/content/:typeSlug/new`}
                component={ContentEntryEditor}
              />
              <Route
                path={`${path}/content/:typeSlug/:id`}
                component={ContentEntryEditor}
              />
              <Route
                path={`${path}/content/:typeSlug`}
                component={ContentEntryList}
              />
              <Route path={`${path}/profile`} component={Profile} />
              <Route path={`${path}/mcp`} component={McpConnect} />
              <Route path={`${path}/roles`} component={Roles} />
              {/* Bare `/settings` -> the default sub-page, so an old
                  bookmark/link to the flat pre-sub-nav URL still lands
                  somewhere real instead of 404ing. */}
              <Route
                path={`${path}/settings`}
                component={() => <Redirect to={`${path}/settings/color-schema`} />}
              />
              <Route
                path={`${path}/settings/color-schema`}
                component={Settings}
              />
              <Route
                path={`${path}/settings/github-sync`}
                component={GithubSyncSettings}
              />
              <Route
                path={`${path}/settings/versions`}
                component={Versions}
              />
              <Route path={`${path}/backup`} component={Backup} />
              {/* `/new` registered before `/:id` so it isn't swallowed by the id param. */}
              <Route
                path={`${path}/roles/new`}
                component={() => <RoleEditor id="new" />}
              />
              <Route path={`${path}/roles/:id`} component={RoleEditor} />
              <Route
                default
                component={() => <Redirect to={`${path}/dashboard`} />}
              />
            </Router>
          </Boundary>
        </Chrome>
      </ErrorBoundary>
    </>
  );
}

const LOGIN_PATH = `${path}/login`;
const REGISTER_PATH = `${path}/register`;
const OAUTH_CONSENT_PATH = `${path}/oauth/consent`;
const GITHUB_SETUP_PATH = `${path}/setup/github`;

/**
 * Sits above `DryLayout`/`<Router>`. `/login`/`/register` are real, always-
 * routable paths (not just gate states) - only every OTHER path (the actual
 * dashboard: `/dashboard`, `/content/*`, `/content-types`, ...) requires a
 * session, redirecting to `/login` (or `/register`, first-run) instead of
 * replacing the whole app's content in place. `store/auth.ts`'s `authState`
 * drives which of the 4 states below applies.
 *
 * Outside `path` (e.g. the bare site root `/`) is not this app's concern at
 * all - the dev server/adapters serve the same `index.html` for any
 * unmatched path (see `scripts/dev-server.mjs`), so without this check every
 * such visit would still mount this SPA and fall through to the `default`
 * route's dashboard redirect below. Renders nothing (a blank page) instead,
 * and skips even fetching the session - there's nothing here to gate.
 */
function AuthGate() {
  // `path` below shadows the module-scoped admin `path` constant on
  // purpose - renamed to `locationPath` so both stay usable. `url` is
  // `location.pathname + location.search` (`preact-iso`'s own source);
  // `onLoginPath`/`onRegisterPath` must compare against the pathname-only
  // `locationPath` instead, or a `/login?return_to=...` URL (see the
  // `status/mcp-oauth.md` OAuth consent flow, which sends an unauthenticated
  // visitor here) would fail this equality, fall through to the
  // `<Redirect to={LOGIN_PATH}/>` below, and get redirected to itself with
  // the query string silently stripped.
  const { url, path: locationPath, query } = useLocation();
  const inScope = url === path || url.startsWith(`${path}/`);
  const [githubConfigured, setGithubConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (inScope) void loadSession();
  }, [inScope]);

  useEffect(() => {
    if (authState.value.status !== "authenticated" || !canAccess(PAGE_BUILDER_RESOURCE_ID, "setting")) return;
    void fetchGitConfig(path).then((config) => setGithubConfigured(config.configured)).catch(() => setGithubConfigured(true));
  }, [authState.value.status]);

  if (!inScope) return null;

  const { status } = authState.value;

  if (status === "loading") return <progress class="route-progress" />;

  const onLoginPath = locationPath === LOGIN_PATH;
  const onRegisterPath = locationPath === REGISTER_PATH;

  if (status === "needs-setup") {
    return onRegisterPath ? (
      <RegisterSuperAdmin />
    ) : (
      <Redirect to={REGISTER_PATH} />
    );
  }
  if (status === "anonymous") {
    // `/register` only makes sense before any account exists - once one
    // does, send a visitor still on that URL to `/login` instead.
    if (onRegisterPath) return <Redirect to={LOGIN_PATH} />;
    return onLoginPath ? <SignIn /> : <Redirect to={LOGIN_PATH} />;
  }
  // authenticated
  if (onLoginPath || onRegisterPath) {
    // `?return_to=` (set by e.g. `routes/oauth.ts`'s `/authorize` when it
    // sends an unauthenticated visitor here mid-flow) wins over the default
    // dashboard landing - but only a same-origin admin path, never an
    // arbitrary external URL a crafted link could plant here.
    const returnTo = query.return_to;
    const target = typeof returnTo === "string" && (returnTo === path || returnTo.startsWith(`${path}/`))
      ? returnTo
      : `${path}/dashboard`;
    return <Redirect to={target} />;
  }
  if (canAccess(PAGE_BUILDER_RESOURCE_ID, "setting")) {
    if (githubConfigured === null) return <progress class="route-progress" />;
    if (!githubConfigured) {
      return locationPath === GITHUB_SETUP_PATH
        ? <GithubSetup onSaved={() => setGithubConfigured(true)} />
        : <Redirect to={GITHUB_SETUP_PATH} />;
    }
    if (locationPath === GITHUB_SETUP_PATH) return <Redirect to={`${path}/dashboard`} />;
  }
  // Rendered standalone, same as `SignIn`/`RegisterSuperAdmin` above - a
  // one-off "approve this connection" prompt has no business inside
  // `AuthenticatedApp`'s `DryLayout` sidebar/topbar chrome.
  if (locationPath === OAUTH_CONSENT_PATH) return <OAuthConsent />;
  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <LocationProvider scope={path}>
      <AuthGate />
    </LocationProvider>
  );
}
