import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ErrorBoundary, LocationProvider, Route, Router, lazy, useLocation } from 'preact-iso';
import { path } from 'virtual:drycms/config';
import DryLayout from '../components/DryLayout.js';
import Icon from '../components/Icon.js';
import '../components/native.js';

// Code-split per route: the whole app renders `client:only`, so nothing
// paints until its JS is downloaded. Showcase alone pulls in Prism plus every
// form-input component - keeping it out of Dashboard's chunk matters here.
const Dashboard = lazy(() => import('../pages/Dashboard.js'));
const Showcase = lazy(() => import('../pages/Showcase.js'));
const Media = lazy(() => import('../pages/Media.js'));
const ContentTypes = lazy(() => import('../pages/ContentTypes.js'));
const ContentTypeEditor = lazy(() => import('../pages/ContentTypeEditor.js'));
const ContentEntryList = lazy(() => import('../pages/ContentEntryList.js'));
const ContentEntryEditor = lazy(() => import('../pages/ContentEntryEditor.js'));
const IconManagement = lazy(() => import('../pages/IconManagement.js'));
const IconSearchAdd = lazy(() => import('../pages/IconSearchAdd.js'));
const IconManualForm = lazy(() => import('../pages/IconManualForm.js'));

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
class Boundary extends Component<{ children?: ComponentChildren }, { error: Error | null }> {
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

export default function App() {
	// Router's onLoadStart/onLoadEnd fire whenever it's waiting on a lazy
	// chunk - both the very first paint (nothing else has committed yet) and
	// later in-app navigations - so this bar is the one loading indicator for
	// both cases described in the comment above.
	const [routeLoading, setRouteLoading] = useState(false);

	return (
		<LocationProvider scope={path}>
			{/* preact-iso's own `<ErrorBoundary>` - required for lazy()'s
			 * suspense-style loading, unrelated to the `Boundary` below. */}
			<ErrorBoundary>
				{routeLoading && <progress class="route-progress" />}
				{/* Outside `Router` so it survives route changes - swapping it in
				 * per-route remounted the sidebar (losing scroll position, replaying
				 * the collapse-state flash) on every navigation. */}
				<DryLayout>
					<Boundary>
						<Router
							onLoadStart={() => setRouteLoading(true)}
							onLoadEnd={() => setRouteLoading(false)}
						>
							<Route path={path} component={() => <Redirect to={`${path}/dashboard`} />} />
							<Route path={`${path}/dashboard`} component={Dashboard} />
							<Route path={`${path}/showcase/:tab?`} component={Showcase} />
							<Route path={`${path}/media`} component={Media} />
							<Route path={`${path}/icon-management`} component={IconManagement} />
							<Route path={`${path}/icon-management/add`} component={IconSearchAdd} />
							<Route path={`${path}/icon-management/manual`} component={IconManualForm} />
							<Route path={`${path}/icon-management/manual/:name`} component={IconManualForm} />
							<Route path={`${path}/content-types`} component={ContentTypes} />
							<Route path={`${path}/content-types/new/:kind`} component={ContentTypeEditor} />
							<Route path={`${path}/content-types/:id/edit`} component={ContentTypeEditor} />
							{/* `/new` registered before `/:id` so it isn't swallowed by the id param. */}
							<Route path={`${path}/content/:typeSlug/new`} component={ContentEntryEditor} />
							<Route path={`${path}/content/:typeSlug/:id`} component={ContentEntryEditor} />
							<Route path={`${path}/content/:typeSlug`} component={ContentEntryList} />
							<Route default component={() => <Redirect to={`${path}/dashboard`} />} />
						</Router>
					</Boundary>
				</DryLayout>
			</ErrorBoundary>
		</LocationProvider>
	);
}
