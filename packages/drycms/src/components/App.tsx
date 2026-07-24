import { useEffect } from 'preact/hooks';
import { ErrorBoundary, LocationProvider, Route, Router, lazy, useLocation } from 'preact-iso';
import { path } from 'virtual:drycms/config';
import DryLayout from './DryLayout.js';

// Code-split per route: the whole app renders `client:only`, so nothing
// paints until its JS is downloaded. Showcase alone pulls in Prism plus every
// form-input component - keeping it out of Dashboard's chunk matters here.
const Dashboard = lazy(() => import('../pages/Dashboard.js'));
const Showcase = lazy(() => import('../pages/Showcase.js'));

/** Client-side redirect - Astro injects a single catch-all route, so the bare
 * base path and any unmatched path have to be sent to `/dashboard` here. */
function Redirect({ to }: { to: string }) {
	const { route } = useLocation();
	useEffect(() => route(to, true), [to]);
	return null;
}

function DashboardRoute() {
	return (
		<DryLayout title="Dashboard">
			<Dashboard />
		</DryLayout>
	);
}

function ShowcaseRoute({ tab }: { tab?: string }) {
	return <Showcase tab={tab} />;
}

export default function App() {
	return (
		<LocationProvider scope={path}>
			<ErrorBoundary>
				<Router>
					<Route path={path} component={() => <Redirect to={`${path}/dashboard`} />} />
					<Route path={`${path}/dashboard`} component={DashboardRoute} />
					<Route path={`${path}/showcase/:tab?`} component={ShowcaseRoute} />
					<Route default component={() => <Redirect to={`${path}/dashboard`} />} />
				</Router>
			</ErrorBoundary>
		</LocationProvider>
	);
}
