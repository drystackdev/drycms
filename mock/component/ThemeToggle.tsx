import { useEffect } from "preact/hooks";

const STORAGE_KEY = "drycms-site-theme";

function preferredTheme(): "light" | "dark" {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// Same read-storage/fall-back-to-matchMedia logic as `preferredTheme` above,
// inlined as a string literal so it can run as a plain <script> before
// Preact hydrates. Without this, the page always paints "light" first (the
// `dark` class is only added by `applyTheme` inside `useEffect`, which runs
// post-hydration), then flashes to dark for anyone who chose it.
const FLASH_GUARD_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}`;

/** Render as the very first node in `<body>` (ahead of everything else on
 * the page) so it applies the stored/preferred theme class before first
 * paint - pages have no static HTML shell of their own to inline this into
 * the way the admin app's `index.html` does. */
export function ThemeFlashGuard() {
  return <script dangerouslySetInnerHTML={{ __html: FLASH_GUARD_SCRIPT }} />;
}

export default function ThemeToggle() {
  useEffect(() => applyTheme(preferredTheme()), []);

  function toggleTheme() {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      class="inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Toggle dark and light theme"
      title="Toggle dark and light theme"
    >
      <svg class="size-4 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
      </svg>
      <svg class="hidden size-4 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
    </button>
  );
}

export const defaultProps = {};
