import { Component, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
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
import RegisterSuperAdmin from "../pages/RegisterSuperAdmin.js";
import SignIn from "../pages/SignIn.js";
import { isVeiFrame, startVeiBridge } from "../pages/vei/bridge.js";
import VeiFrame from "../pages/vei/VeiFrame.js";
import { authState, loadSession } from "../store/auth.js";
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
const PageEditor = lazy(() => import("../pages/PageEditor.js"));
const Settings = lazy(() => import("../pages/Settings.js"));
const GoogleVerificationSettings = lazy(() => import("../pages/GoogleVerificationSettings.js"));
const GithubSyncSettings = lazy(() => import("../pages/GithubSyncSettings.js"));
const VeiChangesPreview = lazy(() => import("../pages/vei/ChangesPreview.js"));

/** Client-side redirect - Astro injects a single catch-all route, so the bare
 * base path and any unmatched path have to be sent to `/dashboard` here. */
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
/** The Visual Editing Interface's dialog (`plans/vei.md`) frames one entry
 * editor route inside a public page, where the sidebar/topbar would be
 * noise wrapped around a modal. `AuthGate` already establishes that
 * rendering a route without `DryLayout`'s chrome is a normal thing to do
 * here (Sign in/Register do exactly that); this is the same move for a
 * route that IS authenticated. `VeiFrame` (not a bare passthrough) replaces
 * what skipping `DryLayout` loses - a scroll container, padding, and the
 * toast stack - at dialog rather than full-page scale; see its own doc
 * comment. */
function Chrome({ children }: { children: ComponentChildren }) {
  if (isVeiFrame()) return <VeiFrame>{children}</VeiFrame>;
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
                path={`${path}/page-editor`}
                component={PageEditor}
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
              <Route path={`${path}/vei/changes`} component={VeiChangesPreview} />
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
                path={`${path}/settings/google-verification`}
                component={GoogleVerificationSettings}
              />
              <Route
                path={`${path}/settings/github-sync`}
                component={GithubSyncSettings}
              />
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
  const { url } = useLocation();
  const inScope = url === path || url.startsWith(`${path}/`);

  useEffect(() => {
    if (inScope) void loadSession();
  }, [inScope]);

  if (!inScope) return null;

  const { status } = authState.value;

  if (status === "loading") return <progress class="route-progress" />;

  const onLoginPath = url === LOGIN_PATH;
  const onRegisterPath = url === REGISTER_PATH;

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
  if (onLoginPath || onRegisterPath)
    return <Redirect to={`${path}/dashboard`} />;
  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <LocationProvider scope={path}>
      <AuthGate />
    </LocationProvider>
  );
}
