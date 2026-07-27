import { useEffect } from 'preact/hooks';
import { ErrorBoundary, LocationProvider, Route, Router, lazy, useLocation } from 'preact-iso';
import { path } from 'virtual:drycms/config';
import DryLayout from '../components/DryLayout.js';
import '../components/native.js';

// Code-split per route: the whole app renders `client:only`, so nothing
// paints until its JS is downloaded. Showcase alone pulls in Prism plus every
// form-input component - keeping it out of Dashboard's chunk matters here.
const Dashboard = lazy(() => import('../pages/Dashboard.js'));
const Showcase = lazy(() => import('../pages/Showcase.js'));
const Media = lazy(() => import('../pages/Media.js'));
const ContentTypes = lazy(() => import('../pages/ContentTypes.js'));
const ContentTypeEditor = lazy(() => import('../pages/ContentTypeEditor.js'));

/** Client-side redirect - Astro injects a single catch-all route, so the bare
 * base path and any unmatched path have to be sent to `/dashboard` here. */
function Redirect({ to }: { to: string }) {
	const { route } = useLocation();
	useEffect(() => route(to, true), [to]);
	return null;
}

export default function App() {
	return (
		<LocationProvider scope={path}>
			<ErrorBoundary>
				{/* Outside `Router` so it survives route changes - swapping it in
				 * per-route remounted the sidebar (losing scroll position, replaying
				 * the collapse-state flash) on every navigation. */}
				<DryLayout>
					<Router>
						<Route path={path} component={() => <Redirect to={`${path}/dashboard`} />} />
						<Route path={`${path}/dashboard`} component={Dashboard} />
						<Route path={`${path}/showcase/:tab?`} component={Showcase} />
						<Route path={`${path}/media`} component={Media} />
						<Route path={`${path}/content-types`} component={ContentTypes} />
						<Route path={`${path}/content-types/new/:kind`} component={ContentTypeEditor} />
						<Route path={`${path}/content-types/:id/edit`} component={ContentTypeEditor} />
						<Route default component={() => <Redirect to={`${path}/dashboard`} />} />
					</Router>
				</DryLayout>
			</ErrorBoundary>
		</LocationProvider>
	);
}
