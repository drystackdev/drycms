import DataTable from '../components/DataTable.js';
import Icon from '../components/Icon.js';
import { useDocumentTitle } from './page-common.js';

const stats = [
	{ label: 'Entries', value: '128', delta: '+12 this week', tone: 'success' },
	{ label: 'Drafts', value: '9', delta: '3 awaiting review', tone: 'warning' },
	{ label: 'Media', value: '1,204', delta: '2.1 GB used', tone: 'secondary' },
	{ label: 'Collections', value: '6', delta: 'no change', tone: 'outline' },
];

const columns = [
	{ key: 'title' as const, label: 'Title' },
	{ key: 'collection' as const, label: 'Collection' },
	{ key: 'status' as const, label: 'Status' },
	{ key: 'updated' as const, label: 'Updated' },
];

const rows = [
	{ title: 'Getting started', collection: 'docs', status: 'Published', updated: '2026-07-22' },
	{ title: 'Design tokens', collection: 'docs', status: 'Published', updated: '2026-07-21' },
	{ title: 'Roadmap 2026', collection: 'blog', status: 'Draft', updated: '2026-07-20' },
	{ title: 'Release 0.0.1', collection: 'blog', status: 'Published', updated: '2026-07-18' },
	{ title: 'Attribute-driven CSS', collection: 'blog', status: 'Draft', updated: '2026-07-17' },
	{ title: 'Migrating from v0', collection: 'docs', status: 'Review', updated: '2026-07-15' },
];

export default function Dashboard() {
	useDocumentTitle('Dashboard');

	return (
		<>
			<div class="page-header">
				<div>
					<h1>Dashboard</h1>
					<p>An overview of everything drycms is managing.</p>
				</div>
				<div class="row">
					<button type="button" class="outline">
						<Icon name="Export" />
						Export
					</button>
					<button type="button">
						<Icon name="Add" />
						New entry
					</button>
				</div>
			</div>

			<div class="grid cols-4">
				{stats.map((stat) => (
					<article class="card" key={stat.label}>
						<header>
							<p>{stat.label}</p>
							<span class="metric">{stat.value}</span>
						</header>
						<div class="row">
							<span class={`badge ${stat.tone}`}>{stat.delta}</span>
						</div>
					</article>
				))}
			</div>

			<section class="card flush">
				<header>
					<h2>Recent content</h2>
					<p>Sort, filter and page through entries without leaving the dashboard.</p>
				</header>
				<div style="padding: 0 1.25rem 1.25rem">
					<DataTable columns={columns} rows={rows} pageSize={5} />
				</div>
			</section>

			<div class="grid cols-2">
				<section class="card">
					<header>
						<h2>Component preview</h2>
						<p>Every element below is styled from its tag alone.</p>
					</header>

					<div class="row">
						<button type="button">Default</button>
						<button type="button" class="secondary">Secondary</button>
						<button type="button" class="outline">Outline</button>
						<button type="button" class="ghost">Ghost</button>
						<button type="button" class="destructive">Destructive</button>
						<button type="button" disabled>Disabled</button>
					</div>

					<div class="field">
						<label for="dry-demo-title">Title</label>
						<input id="dry-demo-title" type="text" placeholder="Post title" />
						<span class="hint">Shown in listings and search results.</span>
					</div>

					<div class="field">
						<label for="dry-demo-collection">Collection</label>
						<select id="dry-demo-collection">
							<option>blog</option>
							<option>docs</option>
						</select>
					</div>

					<div class="field inline">
						<input id="dry-demo-featured" type="checkbox" checked />
						<label for="dry-demo-featured">Featured</label>
					</div>

					<div class="alert">
						<h3>Heads up</h3>
						<p>This dashboard ships with sample data until a content source is wired up.</p>
					</div>
				</section>

				<section class="card">
					<header>
						<h2>Activity</h2>
						<p>Latest changes across your collections.</p>
					</header>

					<details open>
						<summary>Today</summary>
						<p>4 entries updated, 1 published.</p>
					</details>
					<details>
						<summary>Yesterday</summary>
						<p>2 media files uploaded.</p>
					</details>
					<details>
						<summary>This week</summary>
						<p>12 entries created across 3 collections.</p>
					</details>

					<div class="row">
						<span class="avatar">KT</span>
						<div>
							<strong>Khan Trần</strong>
							<br />
							<small>Last signed in 2 hours ago</small>
						</div>
					</div>
				</section>
			</div>
		</>
	);
}
