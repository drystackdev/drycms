/**
 * Turns this checkout into a fresh, ready-to-run project: asks for a project
 * name, creates a branch for it, then removes everything specific to the
 * CURRENT demo project and puts a working blank starter in its place.
 *
 * Run with: bun run new:project
 *
 * Interactive by default. For a scripted/CI run (and for testing this script
 * itself against a throwaway clone), it also takes flags:
 *
 *   bun run new:project -- --name "My Site" --yes [--drop-seed-pages]
 *
 * `--yes` answers every confirmation, including the type-the-branch-name one,
 * so it is the only mode that can destroy a tree without a human in the loop.
 *
 * What it resets, and why each one matters for a project that actually boots:
 *
 * - `src/apps/pages/**` - the demo public site. Replaced by a minimal
 *   starter (`layout.tsx`/`page.tsx`/`404.tsx`/`500.tsx`) that makes NO
 *   `dry()` call, so the site renders on a DB that has nothing modelled in
 *   it yet. Deleting the directory outright (what this script used to do)
 *   leaves every URL a 404 with no hint of where to start.
 * - `dry.seed.json` - re-snapshotted from the fresh DB. This is the one that
 *   silently undid the whole reset before: `seed.ts`'s
 *   `resolveDefaultContentTypeDefinitions` lets a packaged seed take over
 *   COMPLETELY when present, so a stale `dry.seed.json` re-created all of
 *   the old project's content types (plus its singleton copy and its nav
 *   rows, via `applyPackagedSingletonData`/`applyPackagedMenuData`) on the
 *   next first boot - i.e. the "wiped" project came back.
 * - `.dry/` - local content DB, KV, caches, sessions (all content types and
 *   entries, users, roles, AI keys).
 * - `public/` - the local `storage` root (uploaded media + `dry-icons/`).
 * - `dist/`, `.wrangler/` - stale build output/state for the old project.
 * - `wrangler.jsonc` - worker name + D1/R2/KV names, with the IDs put back
 *   to placeholders. Left alone, a `bun run deploy` from the new project
 *   would write straight into the OLD project's production database and
 *   bucket.
 * - `package.json`'s `name`.
 *
 * Deliberately NOT touched (framework-level or shared, not project content):
 * `dry.config.ts`, `icons.config.json`, `src/apps/vei/**`, `src/server/**`,
 * `docs/`, `plans/`, `status/`, `e2e/`.
 *
 * A plain `.ts` script run directly via `bun` (not through Vite's
 * `ssrLoadModule`), same reasoning as `dry-generate.ts`: it needs real
 * project modules (`server/config`, `lib/slugify`), which `bun` resolves
 * natively.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve as resolvePath } from "node:path";
import { slugify } from "../src/lib/slugify.js";
import { content, resolved } from "../src/server/config.js";

const root = process.cwd();
const rl = createInterface({ input: process.stdin, output: process.stdout });

const argv = process.argv.slice(2);
function hasFlag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function flagValue(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}
/** `--yes` skips every confirmation below, including the type-the-name one. */
const autoYes = hasFlag("yes");

/** A yes/no confirmation. Auto-confirmed under `--yes`. */
async function confirm(question: string): Promise<boolean> {
  if (autoYes) return true;
  const answer = await rl.question(question);
  return answer.trim().toLowerCase() === "y";
}

function fail(message: string): never {
  console.error(`[new:project] ${message}`);
  rl.close();
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Runs a `package.json` script in a CHILD process, on purpose - see the
 * `dry:generate` call below for why that isolation is load-bearing. */
function bunRun(script: string): void {
  execFileSync("bun", ["run", script], { stdio: "inherit" });
}

function at(...segments: string[]): string {
  return resolvePath(root, ...segments);
}

function remove(label: string, path: string): void {
  console.log(`  ${label}`);
  rmSync(at(path), { recursive: true, force: true });
}

/** Applies one anchored key rewrite to a JSON/JSONC file's TEXT (never
 * parse/re-stringify: `wrangler.jsonc`'s comments are its documentation and
 * would not survive the round trip). Reports a miss instead of silently
 * leaving the old project's value in place. */
function replaceOrWarn(source: string, file: string, pattern: RegExp, replacement: string): string {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    console.warn(
      `  ! ${file}: no match for ${pattern} - left as-is, check it by hand`,
    );
  }
  return next;
}

// ---------------------------------------------------------------- preflight

// Uncommitted work in TRACKED files is exactly what would get destroyed
// below (`src/apps/pages` is real, tracked source) - refuse rather than
// guess whether it's safe to proceed, same spirit as CODING-PRINCIPLES.md's
// concurrent-editing-hazards section (never assume, never auto-stash).
// Untracked files are a warning, not a refusal: they only disappear if they
// happen to sit inside one of the directories being removed, and refusing
// on them means a single stray scratch file blocks the script.
const statusLines = git("status", "--porcelain").split("\n").filter(Boolean);
const trackedChanges = statusLines.filter((line) => !line.startsWith("??"));
const untracked = statusLines.filter((line) => line.startsWith("??"));

if (trackedChanges.length > 0) {
  console.error("[new:project] Uncommitted changes in tracked files:");
  for (const line of trackedChanges) console.error(`  ${line}`);
  fail(
    "Commit or stash them first, then re-run. Refusing to risk deleting " +
      "in-progress work.",
  );
}

console.log("This creates a new branch, then permanently resets:");
console.log("  - src/apps/pages/**   → a minimal blank starter (demo site removed)");
console.log("  - .dry/               → fresh DB: only the built-in system content types, no entries,");
console.log("                          no users (bun run dev asks for a first-admin registration again)");
console.log("  - dry.seed.json       → re-snapshotted from that fresh DB (drops the old project's");
console.log("                          content types, singleton content and nav rows)");
console.log("  - public/             → deleted (uploaded media + dry-icons/)");
console.log("  - dist/, .wrangler/   → deleted (stale build output for the old project)");
console.log("  - wrangler.jsonc      → worker/D1/R2/KV names renamed, IDs back to placeholders");
console.log("  - package.json        → \"name\" renamed");
console.log("");

const rawName = (flagValue("name") ?? (await rl.question("New project name: "))).trim();
if (!rawName) fail("A project name is required (`--name \"My Site\"` in non-interactive mode).");

const branch = slugify(rawName);
if (!branch) fail(`"${rawName}" has no usable characters for a branch name.`);

console.log(`\nBranch name: ${branch}`);
if (!autoYes) {
  const confirmation = await rl.question(
    `Type "${branch}" to confirm - this cannot be undone: `,
  );
  if (confirmation.trim() !== branch) fail("Confirmation did not match. Aborted, nothing changed.");
}

if (untracked.length > 0) {
  console.log("\nUntracked files in the tree (only lost if they sit inside a removed directory):");
  for (const line of untracked) console.log(`  ${line}`);
  if (!(await confirm("Proceed? (y/N): "))) fail("Aborted, nothing changed.");
}

const port = 5173;
try {
  const pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).trim();
  if (pids) {
    console.warn(
      `\n[new:project] Warning: something is listening on :${port} (likely ` +
        `\`bun run dev\`). Stop it first - a live server holding .dry/content.sqlite ` +
        "open can recreate the old data right after this script deletes it.",
    );
    if (!(await confirm("Proceed anyway? (y/N): "))) fail("Aborted - stop the dev server and re-run.");
  }
} catch {
  // No `lsof`, or nothing listening on the port - nothing to warn about.
}

// The old project's page-seed script is 30KB of content types + copy for
// pages that are about to be deleted, so it's dead weight in a new project -
// but it's also the worked example `.claude/skills/seed-pages-content`
// points at, which is a real reason to keep it. The user's call, asked
// before anything is mutated.
// Under `--yes` it needs the explicit `--drop-seed-pages` flag: this one is
// an optional extra cleanup, not part of the reset, so "yes to all" should
// not silently delete a file the user may want as a reference.
const seedPagesScript = "scripts/seed-pages-content.ts";
let dropSeedPages = hasFlag("drop-seed-pages");
if (!dropSeedPages && !autoYes && existsSync(at(seedPagesScript))) {
  dropSeedPages = await confirm(
    `\nAlso delete ${seedPagesScript} (the old project's content seed, and the\n` +
      "worked example the seed-pages-content skill references)? (y/N): ",
  );
}
if (dropSeedPages && !existsSync(at(seedPagesScript))) dropSeedPages = false;

rl.close();

// ------------------------------------------------------------------ branch

console.log(`\nCreating branch "${branch}"...`);
git("checkout", "-b", branch);

// ------------------------------------------------------- the public site

console.log("\nResetting the public site (src/apps/pages)...");
rmSync(at("src/apps/pages"), { recursive: true, force: true });
mkdirSync(at("src/apps/pages"), { recursive: true });
writeStarterSite(rawName, resolved.path);
console.log("  wrote layout.tsx, page.tsx, 404.tsx, 500.tsx (no dry() calls - renders on an empty DB)");

// -------------------------------------------------------- local artifacts

console.log("\nDeleting local artifacts...");
remove("public/     (uploaded media + dry-icons/)", "public");
remove("dist/       (build output)", "dist");
remove(".wrangler/  (local wrangler state)", ".wrangler");
if (dropSeedPages) remove(`${seedPagesScript}  (old project content seed)`, seedPagesScript);

// ------------------------------------------------- packaged seed + fresh DB

// Written BEFORE the fresh DB is created, and deliberately with no
// `contentTypes` key at all: `resolveDefaultContentTypeDefinitions` reads
// `packagedSeed?.contentTypes ?? defaultContentTypeDefinitions()`, so an
// absent key falls back to the built-in system types, while an empty ARRAY
// would seed a DB with no system types whatsoever (`[]` is not nullish).
// The file itself has to keep existing - `seed.ts` imports it statically, so
// its absence is a hard build error on every runtime (that import is what
// makes the seed work on Workers, which has no filesystem).
console.log("\nResetting dry.seed.json to an empty packaged seed...");
writeFileSync(at("dry.seed.json"), `${JSON.stringify({ $schema: "./dry.seed.schema.json" }, null, 2)}\n`);

console.log("Wiping .dry/ (content DB, KV, caches, sessions)...");
const dryRoot = at(".dry");
rmSync(dryRoot, { recursive: true, force: true });
// The sqlite driver opens its file with no parent-directory creation of its
// own (`sqlite-driver.ts`) - every other local root under `.dry/` (kv,
// storage caches, ...) lazily `mkdir`s itself on first write instead, but
// the content DB doesn't, so this one has to exist up front.
mkdirSync(dryRoot, { recursive: true });

if (content.engine === "D1") {
  console.log(
    "\n[new:project] content.engine is \"D1\" - the local content reset only " +
      "applies to the sqlite engine, and dry.seed.json is now empty. Reset " +
      "your D1 binding/database separately, then re-run `bun run seed:sync`.",
  );
} else {
  // Both in CHILD processes, which is load-bearing rather than stylistic:
  // `seed.ts` captures `dry.seed.json` in a module-scope constant at import
  // time (a static JSON import), so THIS process still holds the old
  // project's packaged seed in memory. Creating the DB here would seed it
  // with exactly the content types this reset is removing.
  //
  // `dry:generate` opens `.dry/content.sqlite`, which runs the same
  // first-boot migration/seed path `bun run dev` would (`sqlite.ts`'s
  // `getHandle()`), then regenerates `src/apps/dry.generated.d.ts` - so the
  // committed generated types match the fresh DB immediately instead of
  // staying stale until the next dev-server start.
  console.log("\nCreating a fresh content DB + regenerating dry.generated.d.ts...");
  bunRun("dry:generate");
  // Now that the DB holds only the system types, snapshot it back into
  // `dry.seed.json` the canonical way, so a deployment of this project
  // seeds from a real snapshot instead of the empty placeholder above.
  console.log("\nSnapshotting the fresh DB back into dry.seed.json...");
  bunRun("seed:sync");
}

// ------------------------------------------------------------- project ids

console.log("\nRenaming the project...");

const wranglerFile = "wrangler.jsonc";
let wrangler = readFileSync(at(wranglerFile), "utf8");
wrangler = replaceOrWarn(wrangler, wranglerFile, /("name":\s*)"[^"]*"/, `$1"${branch}"`);
wrangler = replaceOrWarn(wrangler, wranglerFile, /("database_name":\s*)"[^"]*"/, `$1"${branch}-db"`);
wrangler = replaceOrWarn(
  wrangler,
  wranglerFile,
  /("database_id":\s*)"[^"]*"/,
  `$1"REPLACE_WITH_D1_DATABASE_ID"`,
);
wrangler = replaceOrWarn(wrangler, wranglerFile, /("bucket_name":\s*)"[^"]*"/, `$1"${branch}-content"`);
// Scoped to the `kv_namespaces` block: a bare `"id"` would also match D1's
// `database_id` line above.
wrangler = replaceOrWarn(
  wrangler,
  wranglerFile,
  /("kv_namespaces":[\s\S]*?"id":\s*)"[^"]*"/,
  `$1"REPLACE_WITH_KV_NAMESPACE_ID"`,
);
writeFileSync(at(wranglerFile), wrangler);
console.log(`  ${wranglerFile}: name=${branch}, D1=${branch}-db, R2=${branch}-content, IDs → placeholders`);

let pkg = readFileSync(at("package.json"), "utf8");
// `"name"` is package.json's first key; `"database_name"`-style keys can't
// match (the pattern needs the opening quote directly before `name`).
pkg = replaceOrWarn(pkg, "package.json", /("name":\s*)"[^"]*"/, `$1"${branch}"`);
if (dropSeedPages) {
  pkg = replaceOrWarn(pkg, "package.json", /^\s*"seed:pages":.*\n/m, "");
}
writeFileSync(at("package.json"), pkg);
console.log(`  package.json: name=${branch}${dropSeedPages ? ", seed:pages script removed" : ""}`);

// ------------------------------------------------------------------- done

console.log(`\nDone. On branch "${branch}".`);
console.log("\nNext steps:");
console.log("  1. bun run dev");
console.log(`  2. open http://localhost:5173${resolved.path} and register the first admin`);
console.log("     (the old account was wiped with .dry/)");
console.log("  3. model your content types, then `bun run seed:sync` to package them");
console.log("  4. before `bun run deploy`: fill in wrangler.jsonc's D1/KV IDs");
console.log("     (`wrangler d1 create`, `wrangler kv namespace create`, `wrangler r2 bucket create`)");
console.log("\nReview `git status`, then commit when ready.");

/**
 * Writes the blank starter public site. Every file here is intentionally
 * free of `dry()` reads: a brand-new project's DB has only the built-in
 * system content types, so anything reading an app content type would throw
 * "no content type named X exists" on the very first page view. See
 * `docs/APP-ROUTER.md` for the file conventions, and
 * `.claude/skills/seed-pages-content` for turning these hardcoded sections
 * into real CMS content.
 */
function writeStarterSite(projectName: string, adminPath: string): void {
  const write = (file: string, source: string) => {
    writeFileSync(at("src/apps/pages", file), source);
  };
  // The name is free-form user input, so it goes into the generated TSX as a
  // string LITERAL rendered through `{...}`, never inline JSX text - a name
  // containing `{`, `<` or a quote would otherwise emit a file that doesn't
  // parse. `adminPath` needs no such care (`options.ts`'s `resolvePath`
  // already rejects quotes/whitespace/brackets in it).
  const nameLiteral = JSON.stringify(projectName);

  write(
    "layout.tsx",
    `/**
 * Root layout for the public site - wraps every page under
 * \`src/apps/pages/**\`, including \`404.tsx\` (see \`docs/APP-ROUTER.md\`).
 *
 * Plain SYNC component with no data dependency, which is what makes a
 * brand-new project renderable: the demo site's layout read a
 * \`siteSettings\` singleton and a \`menu\` collection through \`dry()\`, and
 * neither exists until you model them. Once they do, make this \`async\` and
 * read them here - a layout renders on every page, so keep the read narrow
 * with \`select\` (see \`dry-reader.ts\`'s \`DrySelect\`).
 */
const SITE_NAME = ${nameLiteral};

export default function RootLayout({ children }: { children?: unknown }) {
  return (
    <div class="flex min-h-screen flex-col bg-white font-sans text-slate-900">
      <header class="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <a href="/" class="text-lg font-bold">
            {SITE_NAME}
          </a>
          <a
            href="${adminPath}"
            class="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Quản trị
          </a>
        </div>
      </header>

      <main class="flex-1">{children as never}</main>

      <footer class="border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} {SITE_NAME}
      </footer>
    </div>
  );
}
`,
  );

  write(
    "page.tsx",
    `/**
 * The site's root route (\`/\`) - the starter \`bun run new:project\` leaves
 * behind. Hardcoded on purpose; make it \`async\` and read real content with
 * \`dry()\` once you have content types, e.g.
 *
 *   const home = await dry().singleton("homepage").get();
 *   const { rows } = await dry().collection("blog").list({ pageSize: 3 });
 *
 * \`dry()\` is an ambient global here - no import needed (see
 * \`src/apps/dry.generated.d.ts\`, regenerated on every dev-server start).
 */
const SITE_NAME = ${nameLiteral};

export default function HomePage() {
  return (
    <div class="mx-auto max-w-3xl px-4 py-20">
      <p class="text-sm font-semibold uppercase tracking-wide text-slate-500">drycms</p>
      <h1 class="mt-2 text-4xl font-bold">{SITE_NAME}</h1>
      <p class="mt-4 text-slate-600">
        Trang này là starter trống. Sửa <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">src/apps/pages/page.tsx</code>{" "}
        để bắt đầu.
      </p>

      <ol class="mt-8 space-y-3 text-slate-700">
        <li>
          1. Vào <a href="${adminPath}" class="font-medium underline">${adminPath}</a> và tạo tài khoản admin đầu tiên.
        </li>
        <li>2. Tạo content type trong Content → Apply and build.</li>
        <li>
          3. Đọc dữ liệu ra trang bằng <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">dry()</code>, rồi{" "}
          <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">bun run seed:sync</code> để đóng gói schema.
        </li>
      </ol>
    </div>
  );
}
`,
  );

  write(
    "404.tsx",
    `/**
 * Pages-root fallback (\`route-tree.ts\`'s \`buildRouteTree\`) - rendered by
 * \`page-handler.ts\` for any URL that matches no real route AND has no
 * matching \`redirect\` row. Wrapped by the root layout like any other page
 * (a route miss isn't a content-layer failure, so there's no reason to
 * withhold the site's own chrome here) - see \`500.tsx\` for the opposite
 * choice and why.
 */
export default function NotFoundPage() {
  return (
    <div class="mx-auto max-w-3xl px-4 py-24 text-center">
      <p class="text-sm font-semibold uppercase tracking-wide text-slate-500">404</p>
      <h1 class="mt-2 text-2xl font-bold sm:text-3xl">Không tìm thấy trang</h1>
      <p class="mt-2 text-sm text-slate-600">Trang này có thể đã bị gỡ hoặc đường dẫn không đúng.</p>
      <a href="/" class="mt-6 inline-block text-sm font-medium underline">
        ← Về trang chủ
      </a>
    </div>
  );
}
`,
  );

  write(
    "500.tsx",
    `/**
 * Pages-root fallback (\`route-tree.ts\`'s \`buildRouteTree\`) - rendered
 * standalone by \`render.ts\`'s \`renderErrorHtml\` (no root layout, no
 * \`dry()\` context, no hydrate script) whenever rendering a page throws.
 *
 * Keep it a plain SYNC component with no data dependency at all: the content
 * layer is exactly what's often broken when this page is what's needed, so
 * it must stay renderable independent of the DB.
 */
export default function ServerErrorPage() {
  return (
    <div class="flex min-h-screen items-center justify-center px-4 text-center">
      <div>
        <p class="text-sm font-semibold uppercase tracking-wide text-slate-500">500</p>
        <h1 class="mt-2 text-2xl font-bold sm:text-3xl">Đã có lỗi xảy ra</h1>
        <p class="mt-2 text-sm text-slate-600">Vui lòng thử lại sau ít phút.</p>
        <a href="/" class="mt-6 inline-block text-sm font-medium underline">
          ← Về trang chủ
        </a>
      </div>
    </div>
  );
}
`,
  );
}
