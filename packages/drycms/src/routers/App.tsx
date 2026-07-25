import { useEffect } from 'preact/hooks';
import { ErrorBoundary, LocationProvider, Route, Router, lazy, useLocation } from 'preact-iso';
import { path } from 'virtual:drycms/config';
import DryLayout from '../components/DryLayout.js';
import '../components/tooltip.js';

// Code-split per route: the whole app renders `client:only`, so nothing
// paints until its JS is downloaded. Showcase alone pulls in Prism plus every
// form-input component - keeping it out of Dashboard's chunk matters here.
const Dashboard = lazy(() => import('../pages/Dashboard.js'));
const Showcase = lazy(() => import('../pages/Showcase.js'));
const Media = lazy(() => import('../pages/Media.js'));

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
	return (
		<DryLayout title="Showcase">
			<Showcase tab={tab} />
		</DryLayout>
	);
}

function MediaRoute() {
	return (
		<DryLayout title="Media">
			<Media />
		</DryLayout>
	);
}

/** Keeps every `input[type="range"]`'s `--value` (0-100, drives the WebKit
 * track fill in forms.css) synced to the value the user is dragging to -
 * WebKit has no `::-webkit-range-progress` pseudo-element to fill natively,
 * unlike Firefox's `::-moz-range-progress`. One delegated listener covers
 * every range on every route, present now or added later. */
function useRangeFill() {
	useEffect(() => {
		const onInput = (event: Event) => {
			const target = event.target;
			if (!(target instanceof HTMLInputElement) || target.type !== "range") return;
			const min = target.min === "" ? 0 : Number(target.min);
			const max = target.max === "" ? 100 : Number(target.max);
			const percent = max === min ? 0 : ((Number(target.value) - min) / (max - min)) * 100;
			target.style.setProperty("--value", String(percent));
		};
		document.addEventListener("input", onInput);
		return () => document.removeEventListener("input", onInput);
	}, []);
}

export default function App() {
	useRangeFill();

	return (
		<LocationProvider scope={path}>
			<ErrorBoundary>
				<Router>
					<Route path={path} component={() => <Redirect to={`${path}/dashboard`} />} />
					<Route path={`${path}/dashboard`} component={DashboardRoute} />
					<Route path={`${path}/showcase/:tab?`} component={ShowcaseRoute} />
					<Route path={`${path}/media`} component={MediaRoute} />
					<Route default component={() => <Redirect to={`${path}/dashboard`} />} />
				</Router>
			</ErrorBoundary>
		</LocationProvider>
	);
}
