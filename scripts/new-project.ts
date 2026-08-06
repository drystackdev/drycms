/**
 * Resets this checkout into a blank project skeleton: asks for a new
 * project name, creates a branch for it, then wipes everything specific to
 * the CURRENT demo project - the public site's pages, all local content
 * (types + entries + users/roles/AI keys/sessions), and uploaded media.
 *
 * Run with: bun run new:project
 *
 * A plain `.ts` script run directly via `bun` (not through Vite's
 * `ssrLoadModule`), same reasoning as `dry-generate.ts`: it needs real
 * project modules (`content-types/engine`, `server/config`), which `bun`
 * resolves natively.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve as resolvePath } from "node:path";
import { slugify } from "../src/lib/slugify.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function fail(message: string): never {
  console.error(`[new:project] ${message}`);
  rl.close();
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// A dirty tree is exactly what would get silently destroyed below (`src/
// apps/pages` is real, tracked source) - refuse rather than guess whether
// it's safe to proceed, same spirit as CODING-PRINCIPLES.md's concurrent-
// editing-hazards section (never assume, never auto-stash).
const dirty = git("status", "--porcelain");
if (dirty) {
  fail(
    "Working tree has uncommitted changes - commit or stash them first, " +
      "then re-run. Refusing to risk deleting in-progress work.",
  );
}

console.log("This creates a new branch, then permanently deletes:");
console.log("  - src/apps/pages/**          (the public site's pages)");
console.log("  - public/                    (uploaded media/icons)");
console.log(
  "  - .dry/                     (local content DB - ALL content types/entries," +
    " users, roles, AI keys, sessions; reseeds to just the built-in system types on next boot)",
);
console.log("");

const rawName = (await rl.question("New project name: ")).trim();
if (!rawName) fail("A project name is required.");

const branch = slugify(rawName);
if (!branch) fail(`"${rawName}" has no usable characters for a branch name.`);

console.log(`\nBranch name: ${branch}`);
const confirmation = await rl.question(
  `Type "${branch}" to confirm - this cannot be undone: `,
);
if (confirmation.trim() !== branch) fail("Confirmation did not match. Aborted, nothing changed.");

const port = 5173;
try {
  const pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).trim();
  if (pids) {
    console.warn(
      `\n[new:project] Warning: something is listening on :${port} (likely ` +
        `\`bun run dev\`). Stop it first - a live server holding .dry/content.sqlite ` +
        "open can recreate the old data right after this script deletes it.",
    );
    const proceed = await rl.question("Proceed anyway? (y/N): ");
    if (proceed.trim().toLowerCase() !== "y") fail("Aborted - stop the dev server and re-run.");
  }
} catch {
  // No `lsof`, or nothing listening on the port - nothing to warn about.
}

rl.close();

console.log(`\nCreating branch "${branch}"...`);
git("checkout", "-b", branch);

const root = process.cwd();
console.log("Deleting src/apps/pages...");
rmSync(resolvePath(root, "src/apps/pages"), { recursive: true, force: true });

console.log("Deleting public/...");
rmSync(resolvePath(root, "public"), { recursive: true, force: true });

console.log("Wiping .dry/ (local content DB, caches, sessions)...");
const dryRoot = resolvePath(root, ".dry");
rmSync(dryRoot, { recursive: true, force: true });
// The sqlite driver opens its file with no parent-directory creation of its
// own (`sqlite-driver.ts`) - every other local root under `.dry/` (kv,
// storage caches, ...) lazily `mkdir`s itself on first write instead, but
// the content DB doesn't, so this one has to exist up front.
mkdirSync(dryRoot, { recursive: true });

// Constructing the engine adapter and touching it opens a fresh
// `.dry/content.sqlite`, which runs the exact same first-boot migration/seed
// path `bun run dev` would (`sqlite.ts`'s `getHandle()`) - so right after
// this, the DB already contains only `defaultContentTypeDefinitions()`'s
// types (`content-types/seed.ts`), with zero entries in any of them. Regenerating `dry.generated.d.ts` here (the same
// call `dry-generate.ts`/`dev-server.mjs` make) keeps that committed file in
// sync immediately, instead of leaving it stale until the next `bun run dev`.
const { content } = await import("../src/server/config.js");
if (content.engine === "D1") {
  console.log(
    "\n[new:project] content.engine is \"D1\" - local content reset only " +
      "applies to the sqlite engine. Reset your D1 binding/database separately.",
  );
} else {
  const { createContentEngineAdapter } = await import("../src/content-types/engine/index.js");
  const { generateDryTypes } = await import("../src/content-types/codegen.js");
  const { writeGeneratedDryTypes } = await import("../src/content-types/types-cache.js");

  const adapter = createContentEngineAdapter(content);
  const allTypes = await adapter.listContentTypes();
  await writeGeneratedDryTypes(generateDryTypes(allTypes));
  console.log(
    `Reseeded ${allTypes.length} system content type(s): ${allTypes.map((t) => t.name).join(", ")}`,
  );
}

console.log(`\nDone. On branch "${branch}", src/apps/pages and public/ are gone,`);
console.log("and the local content DB has only the system content types, no entries.");
console.log("Review `git status`, then commit when ready. `bun run dev` will need a");
console.log("first-admin registration again (the old account was wiped with .dry/).");
