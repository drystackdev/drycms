import type { ContentTypeDefinition } from "./types.js";

/**
 * A complete, self-contained demo project - every content type, entry and
 * page source `bun run dev:worker` needs to come up with something real to
 * click through, instead of the bare system types a freshly registered
 * super admin gets.
 *
 * Pure data on purpose (no fetch, no storage, no `window`): `scripts/
 * seed-demo.ts` is the only thing that knows how to PUSH any of it, over the
 * ordinary admin HTTP API, so the same definitions can be unit-tested
 * (`demo-seed.test.ts`) without a server and pushed at a Node dev server or
 * a `wrangler dev` Worker without caring which.
 *
 * Ids are fixed, human-readable strings (`demo-...`) rather than generated
 * UUIDs so re-running the seed is idempotent: the pusher looks a type up by
 * id and updates it in place instead of creating a second copy. That's also
 * why nothing here is randomized - two runs must produce the same project.
 */

/** Every id this module owns, so the pusher can tell "already seeded" apart
 * from "the admin made this themselves" without guessing from labels. */
export const DEMO_TYPE_IDS = {
  category: "demo-category",
  author: "demo-author",
  article: "demo-article",
  feature: "demo-feature",
  landing: "demo-landing",
} as const;

/** One reusable component - a `component-repeat` field on the landing
 * singleton below, so the demo covers nested/child-table storage too and not
 * only flat columns. */
function featureComponent(): ContentTypeDefinition {
  return {
    id: DEMO_TYPE_IDS.feature,
    kind: "component",
    name: "demoFeature",
    label: "Demo Feature",
    description: "One bullet in the landing page's feature list.",
    version: 0,
    fields: [
      // `title` is reserved (`naming.ts`'s RESERVED_NAMES - it collides with
      // the synthetic system column `features.title` adds), hence `label`.
      { id: "demo-feature-label", name: "label", label: "Label", type: "text", config: {}, validation: { required: true }, order: 0 },
      { id: "demo-feature-body", name: "body", label: "Body", type: "text", config: { multiline: true }, validation: {}, order: 1 },
      { id: "demo-feature-icon", name: "icon", label: "Icon", type: "icon", config: {}, validation: {}, order: 2 },
    ],
  };
}

function categoryCollection(): ContentTypeDefinition {
  return {
    id: DEMO_TYPE_IDS.category,
    kind: "collection",
    name: "demoCategory",
    label: "Demo Category",
    description: "Grouping for demo articles - the target of a manyToOne relation.",
    features: { slug: true },
    version: 0,
    fields: [
      { id: "demo-category-name", name: "name", label: "Name", type: "text", config: {}, validation: { required: true }, order: 0 },
      { id: "demo-category-color", name: "color", label: "Color", type: "select", config: { options: ["red", "green", "blue"], multiple: false }, validation: {}, order: 1 },
    ],
  };
}

function authorCollection(): ContentTypeDefinition {
  return {
    id: DEMO_TYPE_IDS.author,
    kind: "collection",
    name: "demoAuthor",
    label: "Demo Author",
    description: "Article bylines - the target of a manyToMany relation.",
    features: { slug: true },
    version: 0,
    fields: [
      { id: "demo-author-name", name: "name", label: "Name", type: "text", config: {}, validation: { required: true }, order: 0 },
      { id: "demo-author-bio", name: "bio", label: "Bio", type: "text", config: { multiline: true }, validation: {}, order: 1 },
      { id: "demo-author-photo", name: "photo", label: "Photo", type: "image", config: {}, validation: {}, order: 2 },
    ],
  };
}

/** The main event: one collection touching every field SHAPE the app has -
 * plain columns, a rich text body, both relation cardinalities, an image, a
 * number/boolean/date, and a multi-select. That's what makes it a useful
 * place to reproduce a field-level bug against `dev:worker`. */
function articleCollection(): ContentTypeDefinition {
  return {
    id: DEMO_TYPE_IDS.article,
    kind: "collection",
    name: "demoArticle",
    label: "Demo Article",
    description: "Every field type in one collection - the demo page reads from this.",
    features: { slug: true, draft: true },
    version: 0,
    fields: [
      { id: "demo-article-heading", name: "heading", label: "Heading", type: "text", config: {}, validation: { required: true }, order: 0 },
      { id: "demo-article-summary", name: "summary", label: "Summary", type: "text", config: { multiline: true }, validation: {}, order: 1 },
      { id: "demo-article-cover", name: "cover", label: "Cover", type: "image", config: {}, validation: {}, order: 2 },
      { id: "demo-article-body", name: "body", label: "Body", type: "richtext", config: {}, validation: {}, order: 3 },
      { id: "demo-article-readingMinutes", name: "readingMinutes", label: "Reading minutes", type: "number", config: {}, validation: {}, order: 4 },
      { id: "demo-article-featured", name: "featured", label: "Featured", type: "boolean", config: {}, validation: {}, order: 5 },
      { id: "demo-article-publishedAt", name: "publishedAt", label: "Published at", type: "date", config: {}, validation: {}, order: 6 },
      { id: "demo-article-tags", name: "tags", label: "Tags", type: "select", config: { options: ["news", "guide", "release"], multiple: true }, validation: {}, order: 7 },
      { id: "demo-article-category", name: "category", label: "Category", type: "relation", config: { target: DEMO_TYPE_IDS.category, cardinality: "manyToOne" }, validation: {}, order: 8 },
      { id: "demo-article-authors", name: "authors", label: "Authors", type: "relation", config: { target: DEMO_TYPE_IDS.author, cardinality: "manyToMany" }, validation: {}, order: 9 },
    ],
  };
}

function landingSingleton(): ContentTypeDefinition {
  return {
    id: DEMO_TYPE_IDS.landing,
    kind: "singleton",
    name: "demoLanding",
    label: "Demo Landing",
    description: "Copy for the /demo page's hero and feature list.",
    version: 0,
    fields: [
      { id: "demo-landing-headline", name: "headline", label: "Headline", type: "text", config: {}, validation: { required: true }, order: 0 },
      { id: "demo-landing-subheadline", name: "subheadline", label: "Sub-headline", type: "text", config: { multiline: true }, validation: {}, order: 1 },
      { id: "demo-landing-features", name: "features", label: "Features", type: "component", config: { componentId: DEMO_TYPE_IDS.feature, repeatable: true }, validation: {}, order: 2 },
    ],
  };
}

/**
 * In dependency order - a relation field can only be saved once its target
 * type exists, and a `component` field once its component does, so the
 * pusher can walk this array front to back with no extra sorting.
 */
export function demoContentTypes(): ContentTypeDefinition[] {
  return [featureComponent(), categoryCollection(), authorCollection(), articleCollection(), landingSingleton()];
}

export interface DemoEntrySeed {
  /** Which `demoContentTypes()` entry this row belongs to. */
  typeId: string;
  /** Unique within its type - the `slug` of a slugged collection, and the
   * key the pusher uses to decide "already seeded" (see `demoEntries`'s own
   * doc comment). Absent for the singleton, which has exactly one row. */
  slug?: string;
  value: Record<string, unknown>;
  /** Field name -> the `slug` of the row it points at, resolved to real
   * (hashed) ids by the pusher once those rows exist. Relations can't be
   * literal values here: an id is only known after its row is created. */
  relations?: Record<string, string[]>;
}

/**
 * Demo rows, in the order they have to be created (targets before the rows
 * that point at them). `relations` is kept separate from `value` on purpose -
 * see `DemoEntrySeed.relations`.
 */
export function demoEntries(): DemoEntrySeed[] {
  return [
    { typeId: DEMO_TYPE_IDS.category, slug: "product", value: { name: "Product", color: "blue", title: "Product", slug: "product" } },
    { typeId: DEMO_TYPE_IDS.category, slug: "engineering", value: { name: "Engineering", color: "green", title: "Engineering", slug: "engineering" } },
    {
      typeId: DEMO_TYPE_IDS.author,
      slug: "ada-lovelace",
      value: { name: "Ada Lovelace", bio: "Wrote the first algorithm intended for a machine.", title: "Ada Lovelace", slug: "ada-lovelace" },
    },
    {
      typeId: DEMO_TYPE_IDS.author,
      slug: "grace-hopper",
      value: { name: "Grace Hopper", bio: "Built the first compiler and popularised machine-independent languages.", title: "Grace Hopper", slug: "grace-hopper" },
    },
    {
      typeId: DEMO_TYPE_IDS.article,
      slug: "welcome-to-the-demo",
      value: {
        heading: "Welcome to the demo",
        summary: "A seeded article covering every field type the editor supports.",
        body: "<p>This article was created by <strong>bun run seed:demo</strong>. Edit it, paste an image into it, or delete it - nothing here is precious.</p>",
        readingMinutes: 4,
        featured: true,
        publishedAt: "2026-01-15T09:00:00.000Z",
        tags: ["news", "guide"],
        title: "Welcome to the demo",
        slug: "welcome-to-the-demo",
        draft: false,
      },
      relations: { category: ["product"], authors: ["ada-lovelace", "grace-hopper"] },
    },
    {
      typeId: DEMO_TYPE_IDS.article,
      slug: "relations-and-caching",
      value: {
        heading: "Relations and caching",
        summary: "Two categories, two authors, one many-to-many - enough to exercise the ref picker.",
        body: "<p>Open the <em>Authors</em> field to see the relation picker read through the same cache the list page uses.</p>",
        readingMinutes: 7,
        featured: false,
        publishedAt: "2026-02-02T09:00:00.000Z",
        tags: ["release"],
        title: "Relations and caching",
        slug: "relations-and-caching",
        draft: false,
      },
      relations: { category: ["engineering"], authors: ["grace-hopper"] },
    },
    {
      typeId: DEMO_TYPE_IDS.landing,
      value: {
        headline: "drycms demo project",
        subheadline: "Seeded content types, entries and pages - ready to click through.",
        features: [
          { label: "Every field type", body: "Text, rich text, image, number, boolean, date, select and both relation cardinalities." },
          { label: "Real relations", body: "Articles point at a category and at several authors." },
          { label: "A public page", body: "/demo renders all of it through dry()." },
        ],
      },
    },
  ];
}

export interface DemoPageSource {
  /** Path under the page-source store, root folder included (see
   * `server/app-router/source-roots.ts`). */
  path: string;
  source: string;
}

/**
 * The public `/demo` route, plus the `@component/DemoCard` it imports - real
 * page source, written into `pagesSourceStorage` exactly as the Page Editor
 * would write it, so `dev:worker` serves a working page rather than a 404.
 * Reads its data through the ambient `dry()` reader, so it also proves the
 * generated types/reader path works end to end.
 */
export function demoPageSources(): DemoPageSource[] {
  return [
    {
      path: "component/DemoCard.tsx",
      source: `interface DemoCardProps {
  heading: string;
  summary?: string;
  href: string;
}

export default function DemoCard({ heading, summary, href }: DemoCardProps) {
  return (
    <a href={href} class="block rounded-lg border border-slate-200 p-4 hover:border-slate-400">
      <h3 class="text-base font-semibold text-slate-900">{heading}</h3>
      {summary && <p class="mt-1 text-sm text-slate-600">{summary}</p>}
    </a>
  );
}
`,
    },
    {
      path: "pages/demo/page.tsx",
      source: `import DemoCard from "@component/DemoCard";

export default async function DemoPage() {
  setTitle("drycms demo");

  const landing = await dry().singleton("demoLanding").get();
  const articles = await dry().collection("demoArticle").list({ pageSize: 20 });

  return (
    <main class="mx-auto max-w-3xl px-6 py-12">
      <h1 class="text-3xl font-bold text-slate-900">{landing?.headline ?? "drycms demo"}</h1>
      {landing?.subheadline && <p class="mt-2 text-slate-600">{landing.subheadline}</p>}

      <ul class="mt-8 grid gap-3 sm:grid-cols-3">
        {(landing?.features ?? []).map((feature) => (
          <li key={feature.label} class="rounded-lg bg-slate-50 p-4">
            <h2 class="text-sm font-semibold text-slate-900">{feature.label}</h2>
            <p class="mt-1 text-sm text-slate-600">{feature.body}</p>
          </li>
        ))}
      </ul>

      <h2 class="mt-12 text-xl font-semibold text-slate-900">Articles</h2>
      <div class="mt-4 grid gap-3">
        {articles.rows.map((article) => (
          <DemoCard
            key={article.slug}
            heading={article.heading}
            summary={article.summary}
            href={"/demo/" + article.slug}
          />
        ))}
      </div>
    </main>
  );
}
`,
    },
    {
      path: "pages/demo/[slug]/page.tsx",
      source: `export default async function DemoArticlePage() {
  const { slug } = params();
  const article = await dry().collection("demoArticle").get(String(slug));
  if (!article) return <main class="mx-auto max-w-3xl px-6 py-12">Not found.</main>;

  setTitle(article.heading);

  return (
    <main class="mx-auto max-w-3xl px-6 py-12">
      <a href="/demo" class="text-sm text-slate-500">&larr; All articles</a>
      <h1 class="mt-4 text-3xl font-bold text-slate-900">{article.heading}</h1>
      {article.summary && <p class="mt-2 text-slate-600">{article.summary}</p>}
      <div
        class="mt-8 space-y-4 text-slate-700 [&_img]:max-w-full!"
        dangerouslySetInnerHTML={{ __html: article.body ?? "" }}
      />
    </main>
  );
}
`,
    },
  ];
}
