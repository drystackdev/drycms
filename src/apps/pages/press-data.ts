export interface PressMention {
  outlet: string;
  title: string;
  date: string;
  href: string;
}

export const PRESS_MENTIONS: PressMention[] = [
  { outlet: "[Tên báo/tạp chí]", title: "Lorem ipsum dolor sit amet consectetur adipiscing elit", date: "12/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", title: "Sed do eiusmod tempor incididunt ut labore et dolore", date: "10/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", title: "Ut enim ad minim veniam quis nostrud exercitation", date: "06/2025", href: "#" },
  { outlet: "[Tên báo/tạp chí]", title: "Duis aute irure dolor in reprehenderit in voluptate", date: "03/2025", href: "#" },
];
