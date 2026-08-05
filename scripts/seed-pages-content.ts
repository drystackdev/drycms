/**
 * One-time (re-runnable) seed: creates the content types the public
 * homepage (`src/apps/pages/page.tsx`) and blog (`src/apps/pages/blogs/**`)
 * read via `dry()`, and populates them with the same copy those pages used
 * to have hardcoded - see `status/homepage-content-seed.md`.
 *
 * Run with: bun run seed:pages
 *
 * Schema is idempotent (`upsertContentType` reconciles by name on every
 * run); the `blog` collection is cleared and reinserted each run so re-
 * running doesn't pile up duplicate posts.
 */
import { clearCollection, insertCollectionEntry, upsertContentType, writeSingletonEntry } from "./lib/content-seed.js";

function field(
  id: string,
  name: string,
  label: string,
  type: string,
  config: unknown = {},
  validation: { required?: boolean; unique?: boolean; format?: "none" | "email" | "url" | "slug" } = {},
) {
  return { id, name, label, type, config, validation, order: 0 };
}

function withOrder<T extends { order: number }>(fields: T[]): T[] {
  return fields.map((f, order) => ({ ...f, order }));
}

// --- Homepage component types (embedded into the `homepage` singleton) ---

const heroSection = await upsertContentType({
  id: "app-hero-section",
  kind: "component",
  name: "heroSection",
  label: "Hero Section",
  fields: withOrder([
    field("app-hero-eyebrow", "eyebrow", "Eyebrow", "text", {}, { required: true }),
    field("app-hero-headline", "headline", "Title", "text", {}, { required: true }),
    field("app-hero-subtitle", "subtitle", "Subtitle", "text", {}, { required: true }),
    field("app-hero-content", "content", "Content", "text", { multiline: true }),
  ]),
});

const valueProp = await upsertContentType({
  id: "app-value-prop",
  kind: "component",
  name: "valueProp",
  label: "Value Prop",
  fields: withOrder([
    field("app-value-prop-headline", "headline", "Title", "text", {}, { required: true }),
    field("app-value-prop-description", "description", "Description", "text", { multiline: true }, { required: true }),
  ]),
});

const videoSection = await upsertContentType({
  id: "app-video-section",
  kind: "component",
  name: "videoSection",
  label: "Video CTA Section",
  fields: withOrder([
    field("app-video-url", "videoUrl", "Video URL", "text", {}, { required: true }),
    field("app-video-heading", "heading", "Heading", "text", {}, { required: true }),
    field("app-video-description", "description", "Description", "text", { multiline: true }),
    field("app-video-cta-label", "ctaLabel", "CTA Label", "text"),
    field("app-video-cta-href", "ctaHref", "CTA Link", "text"),
  ]),
});

const latestPostsSection = await upsertContentType({
  id: "app-latest-posts-section",
  kind: "component",
  name: "latestPostsSection",
  label: "Latest Posts Section",
  fields: withOrder([
    field("app-latest-posts-heading", "heading", "Heading", "text", {}, { required: true }),
    field("app-latest-posts-view-all-href", "viewAllHref", "View-all Link", "text"),
  ]),
});

const pressSection = await upsertContentType({
  id: "app-press-section",
  kind: "component",
  name: "pressSection",
  label: "Press Section",
  fields: withOrder([
    field("app-press-heading", "heading", "Heading", "text", {}, { required: true }),
    field("app-press-view-all-href", "viewAllHref", "View-all Link", "text"),
  ]),
});

const pressMention = await upsertContentType({
  id: "app-press-mention",
  kind: "component",
  name: "pressMention",
  label: "Press Mention",
  fields: withOrder([
    field("app-press-mention-outlet", "outlet", "Outlet", "text", {}, { required: true }),
    field("app-press-mention-headline", "headline", "Title", "text", {}, { required: true }),
    field("app-press-mention-date", "date", "Date", "text", {}, { required: true }),
    field("app-press-mention-href", "href", "Link", "text"),
  ]),
});

const bottomCta = await upsertContentType({
  id: "app-bottom-cta",
  kind: "component",
  name: "bottomCta",
  label: "Bottom CTA Band",
  fields: withOrder([
    field("app-bottom-cta-heading", "heading", "Heading", "text", {}, { required: true }),
    field("app-bottom-cta-description", "description", "Description", "text", { multiline: true }),
    field("app-bottom-cta-cta-label", "ctaLabel", "CTA Label", "text"),
    field("app-bottom-cta-cta-href", "ctaHref", "CTA Link", "text"),
  ]),
});

// --- The `homepage` singleton, embedding every section above ---

await upsertContentType({
  id: "app-homepage",
  kind: "singleton",
  name: "homepage",
  label: "Homepage",
  description: "Content for the public site's homepage (/).",
  fields: withOrder([
    field("app-homepage-hero", "hero", "Hero", "component", { componentId: heroSection.id, repeatable: false }),
    field(
      "app-homepage-value-props",
      "valueProps",
      "Value Props",
      "component",
      { componentId: valueProp.id, repeatable: true, sortable: true },
    ),
    field("app-homepage-video-section", "videoSection", "Video CTA", "component", {
      componentId: videoSection.id,
      repeatable: false,
    }),
    field("app-homepage-latest-posts-section", "latestPostsSection", "Latest Posts", "component", {
      componentId: latestPostsSection.id,
      repeatable: false,
    }),
    field("app-homepage-press-section", "pressSection", "Press", "component", {
      componentId: pressSection.id,
      repeatable: false,
    }),
    field(
      "app-homepage-press-mentions",
      "pressMentions",
      "Press Mentions",
      "component",
      { componentId: pressMention.id, repeatable: true, sortable: true },
    ),
    field("app-homepage-bottom-cta", "bottomCta", "Bottom CTA", "component", {
      componentId: bottomCta.id,
      repeatable: false,
    }),
  ]),
});

await writeSingletonEntry("homepage", {
  hero: {
    eyebrow: "Kiến thức HIV & ARV",
    headline: "Mai Anh Quyền",
    subtitle: "Tiếp cận viên cộng đồng, chung tay phòng chống HIV/AIDS",
    content:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  },
  valueProps: [
    {
      headline: "Kiến thức đáng tin cậy",
      description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent nec lacus vel elit dictum interdum.",
    },
    {
      headline: "Đồng hành riêng tư",
      description: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    },
    {
      headline: "Cộng đồng hỗ trợ",
      description: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
    },
  ],
  videoSection: {
    videoUrl: "/video_16x9_480_noaudio_trimmed.mp4",
    heading: "Lorem ipsum dolor sit amet consectetur adipiscing elit",
    description: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud.",
    ctaLabel: "Xem bài viết",
    ctaHref: "/blogs",
  },
  latestPostsSection: {
    heading: "Bài viết mới nhất",
    viewAllHref: "/blogs",
  },
  pressSection: {
    heading: "Bài báo nói về tôi",
    viewAllHref: "/about",
  },
  pressMentions: [
    { outlet: "[Tên báo/tạp chí]", headline: "Lorem ipsum dolor sit amet consectetur adipiscing elit", date: "12/2025", href: "#" },
    { outlet: "[Tên báo/tạp chí]", headline: "Sed do eiusmod tempor incididunt ut labore et dolore", date: "10/2025", href: "#" },
    { outlet: "[Tên báo/tạp chí]", headline: "Ut enim ad minim veniam quis nostrud exercitation", date: "06/2025", href: "#" },
    { outlet: "[Tên báo/tạp chí]", headline: "Duis aute irure dolor in reprehenderit in voluptate", date: "03/2025", href: "#" },
  ],
  bottomCta: {
    heading: "Bạn cần được tư vấn riêng tư?",
    description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.",
    ctaLabel: "Liên hệ ngay",
    ctaHref: "/contact",
  },
});

// --- The `blog` collection ---

await upsertContentType({
  id: "app-blog",
  kind: "collection",
  name: "blog",
  label: "Blog Post",
  features: { slug: true },
  fields: withOrder([
    field(
      "app-blog-tag",
      "tag",
      "Tag",
      "select",
      { options: ["Kiến thức cơ bản", "Điều trị ARV", "Sức khỏe tình dục", "Hỏi đáp"], multiple: false },
      { required: true },
    ),
    field("app-blog-excerpt", "excerpt", "Excerpt", "text", { multiline: true }, { required: true }),
    field("app-blog-date", "date", "Date", "date", {}, { required: true }),
    field("app-blog-content", "content", "Content", "text", { multiline: true }, { required: true }),
  ]),
});

/** "DD/MM/YYYY" -> `Date` (local midnight - matches how the old hardcoded
 * strings were always displayed, no time-of-day component). */
function parseViDate(s: string): Date {
  const [d, m, y] = s.split("/").map(Number);
  return new Date(y!, m! - 1, d);
}

await clearCollection("blog");

const posts = [
  {
    slug: "lorem-ipsum-dolor-sit-amet",
    tag: "Kiến thức cơ bản",
    title: "Lorem ipsum dolor sit amet consectetur",
    excerpt: "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim.",
    date: "01/08/2026",
    content: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
      "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
      "Praesent nec lacus vel elit dictum interdum. Nulla facilisi. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae mauris blandit aliquet.",
    ],
  },
  {
    slug: "ut-enim-ad-minim-veniam",
    tag: "Điều trị ARV",
    title: "Ut enim ad minim veniam quis nostrud",
    excerpt: "Exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis.",
    date: "29/07/2026",
    content: [
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
      "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      "Curabitur blandit tempus porttitor. Cras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur.",
    ],
  },
  {
    slug: "duis-aute-irure-dolor",
    tag: "Hỏi đáp",
    title: "Duis aute irure dolor in reprehenderit",
    excerpt: "In voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur.",
    date: "27/07/2026",
    content: [
      "In voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam.",
    ],
  },
  {
    slug: "excepteur-sint-occaecat",
    tag: "Sức khỏe tình dục",
    title: "Excepteur sint occaecat cupidatat non",
    excerpt: "Proident sunt in culpa qui officia deserunt mollit anim id est laborum.",
    date: "24/07/2026",
    content: [
      "Proident sunt in culpa qui officia deserunt mollit anim id est laborum. Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
    ],
  },
  {
    slug: "praesent-nec-lacus-vel",
    tag: "Kiến thức cơ bản",
    title: "Praesent nec lacus vel elit dictum",
    excerpt: "Interdum nulla facilisi vestibulum ante ipsum primis in faucibus orci luctus.",
    date: "20/07/2026",
    content: [
      "Interdum nulla facilisi. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.",
      "Mauris blandit aliquet elit, eget tincidunt nibh pulvinar a. Curabitur non nulla sit amet nisl tempus convallis quis ac lectus.",
    ],
  },
  {
    slug: "vestibulum-ante-ipsum",
    tag: "Điều trị ARV",
    title: "Vestibulum ante ipsum primis in faucibus",
    excerpt: "Orci luctus et ultrices posuere cubilia curae mauris blandit aliquet.",
    date: "18/07/2026",
    content: [
      "Orci luctus et ultrices posuere cubilia curae. Mauris blandit aliquet elit, eget tincidunt nibh pulvinar a.",
      "Curabitur non nulla sit amet nisl tempus convallis quis ac lectus. Vivamus magna justo, lacinia eget consectetur sed.",
    ],
  },
];

for (const post of posts) {
  await insertCollectionEntry("blog", {
    title: post.title,
    slug: post.slug,
    tag: post.tag,
    excerpt: post.excerpt,
    date: parseViDate(post.date),
    content: post.content.join("\n\n"),
  });
}
console.log(`[seed] inserted ${posts.length} "blog" row(s)`);

console.log("[seed] done.");
