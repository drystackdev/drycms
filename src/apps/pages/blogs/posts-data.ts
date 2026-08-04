export interface BlogPost {
  slug: string;
  tag: string;
  title: string;
  excerpt: string;
  date: string;
  content: string[];
}

export const POSTS: BlogPost[] = [
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
