/**
 * One-time (re-runnable) seed: creates the content types every
 * `src/apps/pages/**` route reads via `dry()` (home, blog, about, contact,
 * the shared site chrome in `layout.tsx`), and populates them with the same
 * copy those pages used to have hardcoded - see
 * `status/homepage-content-seed.md`.
 *
 * Run with: bun run seed:pages
 *
 * Schema is idempotent (`upsertContentType` reconciles by name on every
 * run); the `blog` collection is cleared and reinserted each run so re-
 * running doesn't pile up duplicate posts; the shared `menu` collection's
 * "Main Navigation" row is upserted by name instead (it's not a table this
 * script owns exclusively).
 */
import {
  clearCollection,
  insertCollectionEntry,
  upsertCollectionEntryByField,
  upsertContentType,
  writeSingletonEntry,
} from "./lib/content-seed.js";

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

/** Shared across `homepage` and `about` (both used to import the same
 * `PRESS_MENTIONS` from `press-data.ts`) - same `pressMention` component
 * type, but each singleton gets its own copy of the rows (child tables are
 * keyed by parent id, so there's no way to physically share rows across two
 * different parents). */
const PRESS_MENTIONS_DATA = [
  { outlet: "[Tên báo/tạp chí]", headline: "Lorem ipsum dolor sit amet consectetur adipiscing elit", date: "12/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", headline: "Sed do eiusmod tempor incididunt ut labore et dolore", date: "10/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", headline: "Ut enim ad minim veniam quis nostrud exercitation", date: "06/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", headline: "Duis aute irure dolor in reprehenderit in voluptate", date: "03/2025", href: "#" },
];

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
    field("app-hero-image", "image", "Image", "image", {}, { required: true }),
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
    field("app-press-mention-image", "image", "Image", "image", { multiple: false }),
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
    image: "hero.jpg",
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
  pressMentions: PRESS_MENTIONS_DATA,
  bottomCta: {
    heading: "Bạn cần được tư vấn riêng tư?",
    description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.",
    ctaLabel: "Liên hệ ngay",
    ctaHref: "/contact",
  },
});

// --- The `category` collection (blog categories - an admin can add more
// through the Content admin, no schema change needed like a fixed `select`
// would have required) ---

const category = await upsertContentType({
  id: "app-category",
  kind: "collection",
  name: "category",
  label: "Category",
  features: { slug: true },
  fields: [],
});

const categoryNames = ["Kiến thức cơ bản", "Điều trị ARV", "Sức khỏe tình dục", "Hỏi đáp"];
const categoryIdByName = new Map<string, number>();
for (const name of categoryNames) {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const row = await upsertCollectionEntryByField("category", "title", name, { title: name, slug });
  categoryIdByName.set(name, row.id);
}

// --- The `blog` collection ---

await upsertContentType({
  id: "app-blog",
  kind: "collection",
  name: "blog",
  label: "Blog Post",
  features: { slug: true, seo: true },
  fields: withOrder([
    field("app-blog-category", "category", "Category", "relation", { target: category.id, cardinality: "manyToOne" }, { required: true }),
    field("app-blog-excerpt", "excerpt", "Excerpt", "text", { multiline: true }, { required: true }),
    field("app-blog-date", "date", "Date", "date", {}, { required: true }),
    field("app-blog-image", "image", "Cover Image", "image", { multiple: false }),
    field(
      "app-blog-content",
      "content",
      "Content",
      "richtext",
      // Same as `richTextFieldType.defaultConfig` (field-registry.ts) - a
      // fully-capable editor. Passed explicitly: unlike the admin "Add
      // Field" dialog (which merges `defaultConfig` in automatically when a
      // type is picked), a field built programmatically here gets exactly
      // the `config` object given - an empty one would mean every
      // formatting feature starts OFF.
      {
        inline: false,
        layoutContent: false,
        bold: true,
        italic: true,
        underline: true,
        color: true,
        link: true,
        heading: true,
        alignment: true,
        lists: true,
        image: true,
        component: true,
        table: true,
        grid: true,
        fullscreen: true,
      },
      { required: true },
    ),
  ]),
});

/** "DD/MM/YYYY" -> `Date` (local midnight - matches how the old hardcoded
 * strings were always displayed, no time-of-day component). */
function parseViDate(s: string): Date {
  const [d, m, y] = s.split("/").map(Number);
  return new Date(y!, m! - 1, d);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain paragraph strings -> the HTML a `richtext` field stores (one `<p>`
 * per paragraph) - matches what the RichText editor itself would produce
 * for the same plain-text paragraphs. */
function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
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
    category: categoryIdByName.get(post.tag),
    excerpt: post.excerpt,
    date: parseViDate(post.date),
    content: paragraphsToHtml(post.content),
  });
}
console.log(`[seed] inserted ${posts.length} "blog" row(s)`);

// --- The `blogsPage` singleton (src/apps/pages/blogs/page.tsx's header copy) ---

const blogsHeader = await upsertContentType({
  id: "app-blogs-header",
  kind: "component",
  name: "blogsHeader",
  label: "Blogs Header",
  fields: withOrder([
    field("app-blogs-header-eyebrow", "eyebrow", "Eyebrow", "text", {}, { required: true }),
    field("app-blogs-header-headline", "headline", "Headline", "text", {}, { required: true }),
    field("app-blogs-header-description", "description", "Description", "text", { multiline: true }),
  ]),
});

await upsertContentType({
  id: "app-blogs-page",
  kind: "singleton",
  name: "blogsPage",
  label: "Blogs Page",
  description: "Content for /blogs.",
  fields: withOrder([
    field("app-blogs-page-header", "header", "Header", "component", { componentId: blogsHeader.id, repeatable: false }),
  ]),
});

await writeSingletonEntry("blogsPage", {
  header: {
    eyebrow: "Blog",
    headline: "Kiến thức HIV & ARV",
    description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  },
});

// --- The `about` singleton (src/apps/pages/about/page.tsx) ---

const aboutIntro = await upsertContentType({
  id: "app-about-intro",
  kind: "component",
  name: "aboutIntro",
  label: "About Intro",
  fields: withOrder([
    field("app-about-intro-eyebrow", "eyebrow", "Eyebrow", "text", {}, { required: true }),
    field("app-about-intro-headline", "headline", "Headline", "text", {}, { required: true }),
    field("app-about-intro-description", "description", "Description", "text", { multiline: true }, { required: true }),
    field("app-about-intro-image", "image", "Image", "image", {}, { required: true }),
  ]),
});

const aboutStory = await upsertContentType({
  id: "app-about-story",
  kind: "component",
  name: "aboutStory",
  label: "About Story",
  fields: withOrder([
    field("app-about-story-heading", "heading", "Heading", "text", {}, { required: true }),
    field("app-about-story-content", "content", "Content", "text", { multiline: true }, { required: true }),
  ]),
});

const aboutMissionSection = await upsertContentType({
  id: "app-about-mission-section",
  kind: "component",
  name: "aboutMissionSection",
  label: "Mission Section",
  fields: withOrder([field("app-about-mission-heading", "heading", "Heading", "text", {}, { required: true })]),
});

const missionItem = await upsertContentType({
  id: "app-mission-item",
  kind: "component",
  name: "missionItem",
  label: "Mission Item",
  fields: withOrder([field("app-mission-item-text", "text", "Text", "text", {}, { required: true })]),
});

const aboutExperienceSection = await upsertContentType({
  id: "app-about-experience-section",
  kind: "component",
  name: "aboutExperienceSection",
  label: "Experience Section",
  fields: withOrder([field("app-about-experience-heading", "heading", "Heading", "text", {}, { required: true })]),
});

const experienceItem = await upsertContentType({
  id: "app-experience-item",
  kind: "component",
  name: "experienceItem",
  label: "Experience Item",
  fields: withOrder([
    field("app-experience-item-year", "year", "Year", "text", {}, { required: true }),
    field("app-experience-item-description", "description", "Description", "text", {}, { required: true }),
  ]),
});

const aboutPressSection = await upsertContentType({
  id: "app-about-press-section",
  kind: "component",
  name: "aboutPressSection",
  label: "About Press Section",
  fields: withOrder([
    field("app-about-press-heading", "heading", "Heading", "text", {}, { required: true }),
    field("app-about-press-description", "description", "Description", "text", { multiline: true }),
  ]),
});

await upsertContentType({
  id: "app-about",
  kind: "singleton",
  name: "about",
  label: "About",
  description: "Content for /about.",
  fields: withOrder([
    field("app-about-intro-field", "intro", "Intro", "component", { componentId: aboutIntro.id, repeatable: false }),
    field("app-about-story-field", "story", "Story", "component", { componentId: aboutStory.id, repeatable: false }),
    field("app-about-mission-section-field", "missionSection", "Mission Section", "component", {
      componentId: aboutMissionSection.id,
      repeatable: false,
    }),
    field("app-about-mission-items", "missionItems", "Mission Items", "component", {
      componentId: missionItem.id,
      repeatable: true,
      sortable: true,
    }),
    field("app-about-experience-section-field", "experienceSection", "Experience Section", "component", {
      componentId: aboutExperienceSection.id,
      repeatable: false,
    }),
    field("app-about-experience-items", "experienceItems", "Experience Items", "component", {
      componentId: experienceItem.id,
      repeatable: true,
      sortable: true,
    }),
    field("app-about-press-section-field", "pressSection", "Press Section", "component", {
      componentId: aboutPressSection.id,
      repeatable: false,
    }),
    field("app-about-press-mentions", "pressMentions", "Press Mentions", "component", {
      componentId: pressMention.id,
      repeatable: true,
      sortable: true,
    }),
    field("app-about-bottom-cta", "bottomCta", "Bottom CTA", "component", { componentId: bottomCta.id, repeatable: false }),
  ]),
});

await writeSingletonEntry("about", {
  intro: {
    eyebrow: "Giới thiệu",
    headline: "Mai Anh Quyền",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.",
    image: "main.jpg",
  },
  story: {
    heading: "Câu chuyện của tôi",
    content: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent nec lacus vel elit dictum interdum. Nulla facilisi. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.",
      "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    ].join("\n\n"),
  },
  missionSection: { heading: "Sứ mệnh" },
  missionItems: [
    { text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit." },
    { text: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris." },
    { text: "Duis aute irure dolor in reprehenderit in voluptate velit esse." },
  ],
  experienceSection: { heading: "Kinh nghiệm & Chứng chỉ" },
  experienceItems: [
    { year: "2026", description: "Lorem ipsum dolor sit amet consectetur adipiscing elit." },
    { year: "2024", description: "Sed do eiusmod tempor incididunt ut labore et dolore magna." },
    { year: "2021", description: "Ut enim ad minim veniam quis nostrud exercitation ullamco." },
  ],
  pressSection: {
    heading: "Bài báo nói về tôi",
    description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.",
  },
  pressMentions: PRESS_MENTIONS_DATA,
  bottomCta: {
    heading: "Cùng trò chuyện với tôi",
    description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.",
    ctaLabel: "Liên hệ ngay",
    ctaHref: "/contact",
  },
});

// --- The `contact` singleton (src/apps/pages/contact/page.tsx) ---

const contactHeader = await upsertContentType({
  id: "app-contact-header",
  kind: "component",
  name: "contactHeader",
  label: "Contact Header",
  fields: withOrder([
    field("app-contact-header-eyebrow", "eyebrow", "Eyebrow", "text", {}, { required: true }),
    field("app-contact-header-headline", "headline", "Headline", "text", {}, { required: true }),
    field("app-contact-header-description", "description", "Description", "text", { multiline: true }),
  ]),
});

const contactChannel = await upsertContentType({
  id: "app-contact-channel",
  kind: "component",
  name: "contactChannel",
  label: "Contact Channel",
  fields: withOrder([
    field(
      "app-contact-channel-kind",
      "kind",
      "Kind",
      "select",
      { options: ["phone", "email", "fanpage"], multiple: false },
      { required: true },
    ),
    field("app-contact-channel-label", "label", "Label", "text", {}, { required: true }),
    field("app-contact-channel-value", "value", "Value", "text", {}, { required: true }),
    field("app-contact-channel-href", "href", "Link", "text", {}, { required: true }),
  ]),
});

await upsertContentType({
  id: "app-contact",
  kind: "singleton",
  name: "contact",
  label: "Contact",
  description: "Content for /contact (the form itself stays static).",
  fields: withOrder([
    field("app-contact-header-field", "header", "Header", "component", { componentId: contactHeader.id, repeatable: false }),
    field("app-contact-channels", "channels", "Channels", "component", {
      componentId: contactChannel.id,
      repeatable: true,
      sortable: true,
    }),
  ]),
});

await writeSingletonEntry("contact", {
  header: {
    eyebrow: "Liên hệ",
    headline: "Cùng trò chuyện",
    description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mọi thông tin được giữ riêng tư và bảo mật tuyệt đối.",
  },
  channels: [
    { kind: "phone", label: "Điện thoại", value: "0000 000 000", href: "tel:0000000000" },
    { kind: "email", label: "Email", value: "contact@example.com", href: "mailto:contact@example.com" },
    { kind: "fanpage", label: "Fanpage", value: "facebook.com/[tenpage]", href: "#" },
  ],
});

// --- The `siteSettings` singleton (src/apps/pages/layout.tsx's header/footer chrome) ---

await upsertContentType({
  id: "app-site-settings",
  kind: "singleton",
  name: "siteSettings",
  label: "Site Settings",
  description: "Site-wide header/footer chrome shared by every public page.",
  fields: withOrder([
    field("app-site-settings-brand-name", "brandName", "Brand Name", "text", {}, { required: true }),
    field("app-site-settings-header-cta-label", "headerCtaLabel", "Header CTA Label", "text"),
    field("app-site-settings-header-cta-href", "headerCtaHref", "Header CTA Link", "text"),
    field("app-site-settings-footer-description", "footerDescription", "Footer Description", "text", { multiline: true }),
    field("app-site-settings-phone", "phone", "Phone", "text"),
    field("app-site-settings-email", "email", "Email", "text"),
    field("app-site-settings-fanpage-url", "fanpageUrl", "Fanpage Link", "text"),
    field("app-site-settings-copyright", "copyrightText", "Copyright Text", "text"),
  ]),
});

await writeSingletonEntry("siteSettings", {
  brandName: "Mai Anh Quyền",
  headerCtaLabel: "Tư vấn ngay",
  headerCtaHref: "/contact",
  footerDescription:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Đồng hành và chia sẻ kiến thức về HIV, điều trị ARV một cách riêng tư và tận tâm.",
  phone: "0000 000 000",
  email: "contact@example.com",
  fanpageUrl: "#",
  copyrightText: "© 2026 Mai Anh Quyền. Nội dung chỉ mang tính chất tham khảo, không thay thế tư vấn y tế chuyên môn.",
});

// --- The `seoDefaults` singleton's actual content ---
//
// `seoDefaults` is now one of the built-in types every drycms app gets from
// first boot (see `content-types/seed.ts`) - this script only seeds its
// DATA, not its schema, unlike the component/singleton types above.
await writeSingletonEntry("seoDefaults", {
  seo: {
    metaTitle: "Mai Anh Quyền - Tiếp cận viên cộng đồng, phòng chống HIV/AIDS",
    description:
      "Đồng hành và chia sẻ kiến thức về HIV, điều trị ARV một cách riêng tư và tận tâm.",
  },
});

// --- Site navigation - reuses the built-in `menu`/`menuItem` types ---
//
// The built-in `menuItem.href` field ships with `validation.format: "url"`
// (see `content-types/seed.ts`), which rejects relative in-app routes like
// "/about" (`entry-validate.ts` runs `new URL(value)`, which throws on a
// non-absolute string). `menuItem` is an ordinary, freely-editable system
// default (not `frozen`/`locked` - only `role`/`aiKey`/`seo` are), so this
// reconciles it in place to drop that constraint while keeping `href`
// required - same field ids as `seed.ts` (`IDS.menuItem*`), so this is a
// real in-place edit, not a parallel type.
await upsertContentType({
  id: "system-menu-item",
  kind: "component",
  name: "menuItem",
  label: "Menu Item",
  description: "One link in a menu.",
  fields: withOrder([
    field("system-menu-item-label", "label", "Label", "text", {}, { required: true }),
    field("system-menu-item-description", "description", "Description", "text", { multiline: true }),
    field("system-menu-item-href", "href", "Href", "text", {}, { required: true }),
  ]),
});

await upsertCollectionEntryByField("menu", "name", "Main Navigation", {
  name: "Main Navigation",
  refs: [
    { label: "Trang chủ", href: "/", description: "" },
    { label: "Giới thiệu", href: "/about", description: "" },
    { label: "Blog", href: "/blogs", description: "" },
    { label: "Liên hệ", href: "/contact", description: "" },
  ],
});

console.log("[seed] done.");
