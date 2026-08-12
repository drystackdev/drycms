/**
 * `bun run dev:worker`'s last step: starts `wrangler dev` and, once it says
 * it's listening, pushes the demo project into it (`scripts/seed-demo.ts`).
 *
 * A wrapper rather than a `&&` chain in `package.json` because the seed can
 * only run AFTER the server is up, and `wrangler dev` never exits - so the
 * two genuinely have to overlap. Wrangler stays in the foreground and owns
 * stdio; the seed runs once, alongside it, and its failure is reported but
 * deliberately non-fatal (a broken seed shouldn't cost you the dev server
 * you were about to debug in).
 *
 * Plain `.mjs` run by `node`, same as `scripts/dev-server.mjs` - this file
 * only spawns processes, so it has nothing to gain from bun's TS support.
 *
 * `--no-seed` skips the seeding half and just runs `wrangler dev`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const skipSeed = process.argv.includes("--no-seed");
/** Matches wrangler's own "Ready on http://localhost:8788" line - the port is
 * whatever it actually picked, which is not always the configured one (it
 * steps forward when the port is busy), so it's read from the log rather
 * than assumed. */
const READY = /Ready on (https?:\/\/[^\s]+)/;

const wrangler = spawn("wrangler", ["dev", ...process.argv.slice(2).filter((arg) => arg !== "--no-seed")], {
  stdio: ["inherit", "pipe", "inherit"],
  env: process.env,
});

let seeded = skipSeed;

wrangler.stdout.on("data", (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
  if (seeded) return;
  const match = text.match(READY);
  if (!match) return;
  seeded = true;
  runSeed(match[1]);
});

function runSeed(origin) {
  const base = `${origin.replace(/\/$/, "")}/dry`;
  console.log(`[drycms] seeding the demo project into ${base} ...`);
  const seed = spawn(
    "bun",
    [fileURLToPath(new URL("./seed-demo.ts", import.meta.url)), "--base", base, "--wait", "30"],
    { stdio: "inherit", env: process.env },
  );
  seed.on("exit", (code) => {
    if (code !== 0) console.error(`[drycms] demo seeding failed (exit ${code}) - the dev server is still running; re-run it with \`bun run seed:demo -- --base ${base}\`.`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => wrangler.kill(signal));
}
wrangler.on("exit", (code) => process.exit(code ?? 0));
