# Deployment

drycms runs on both Node and Cloudflare Workers. This guide covers both paths.

## Node (development & self-hosted)

Default setup. `src/server/adapters/node.ts` runs the Preact server as an `http.Server`.

```bash
# Development
bun run dev

# Production build
bun run build

# Start production server
bun run start
```

`bun run build` produces:
- `dist/client/` - client-side Preact app (Vite SPA build)
- `dist/server/entry-node.js` - Node server entry point

Data storage (configured via `dry.config.ts`):
- `kind: "local"` (default) - SQLite file at `.dry/content.sqlite`, media in `.dry/storage/`
- `kind: "cloudflare"` - (incompatible with Node) - requires Workers runtime

See [ARCHITECTURE.md](ARCHITECTURE.md#server-one-fetch-shaped-handler-adapter-per-runtime) for the handler architecture.

## Cloudflare Workers

drycms runs as a Cloudflare Worker backed by D1 (SQL database) and R2 (file storage).

### Prerequisites

1. **Cloudflare account** - with a Zone/Domain for your app's public URL
2. **Wrangler CLI** - installed as `wrangler` devDependency (included in repo)
3. **D1 database** - created via `wrangler d1 create drycms`
4. **R2 bucket** - created via `wrangler r2 bucket create drycms-media`
5. **KV namespace** (optional, for caching) - created via `wrangler kv:namespace create drycms-cache`

### Configuration

1. **Update `dry.config.ts`** to use Cloudflare backend:

   ```ts
   export default config({
     kind: "cloudflare",  // Switches to D1 + R2
     ai: { /* ... */ }
   });
   ```

2. **Update `wrangler.jsonc`** with your Cloudflare resources:

   ```jsonc
   {
     "d1_databases": [
       {
         "binding": "CONTENT_DB",
         "database_name": "drycms",
         "database_id": "<your-d1-id>"  // from `wrangler d1 list`
       }
     ],
     "r2_buckets": [
       {
         "binding": "MEDIA_BUCKET",
         "bucket_name": "drycms-media"
       }
     ],
     "kv_namespaces": [
       {
         "binding": "KV",
         "id": "<your-kv-id>",              // from `wrangler kv:namespace list`
         "preview_id": "<your-preview-id>"
       }
     ],
     "assets": {
       "directory": "dist/client"
     }
   }
   ```

3. **Set production secret** (required for auth):

   ```bash
   wrangler secret put DRYCMS_SECRET_KEY
   # Paste a random 32+ character string
   ```

### Build & Deploy

```bash
# Build for Workers (includes client + server)
bun run build:worker

# Deploy to Cloudflare (requires wrangler login)
bun run deploy

# Dry-run (no actual deploy)
wrangler deploy --dry-run
```

`bun run build:worker` runs:
1. `vite build` - client (Preact SPA)
2. `vite build --ssr src/server/entry-worker.ts` - server (Worker entry point)
3. Zips `dist/client/` for the Assets binding

**After first deploy**, visit your Worker's URL to register the first Super Admin account (one-time). The registration form requires a `DRYCMS_BOOTSTRAP_TOKEN` env var (set via `wrangler secret put` or `.env.production`).

### Public-page caching (and what a page view actually costs)

A public page view goes through two caches, in this order:

1. **Edge cache** (`src/server/app-router/edge-cache.ts`) - Cloudflare's Cache
   API, keyed by URL, TTL from `pagesCache.edgeTtl` in `dry.config.ts`
   (default `60` seconds, `0` disables). A hit costs no D1 and no R2 at all.
   Only anonymous `GET`s are stored or served: a request carrying an admin
   session or VEI cookie bypasses it in both directions, so an editor always
   sees their own change immediately while an anonymous visitor sees it at
   most `edgeTtl` seconds later. **The Cache API is disabled on
   `*.workers.dev`** - the Worker must be served through a custom
   domain/route for this layer to do anything (it degrades to a miss, never
   an error).
2. **pages-cache** (`src/server/app-router/pages-cache.ts`) - rendered HTML in
   R2, validated against every touched content type's data version, so it is
   never stale. Costs one R2 read plus one batched D1 version query per view.

Both are production-only (`import.meta.env.DEV` skips them) and both are
skipped for a VEI edit-mode render.

`status/worker-request-cost.md` has the per-request cost breakdown these
layers exist to cut, and why D1 throughput - not any quota - is the real
ceiling on a busy site.

### Known limitations on Workers

- **AI local mode** (`ai.mode: "local"`) is not supported - requires Node's `child_process`. Set `kind: "cloudflare"` and provide an AI key (Anthropic, Google, OpenAI, etc.) via `DryOption.ai`.
- **RichText Component Builder's Build button** (`/dry/richtext-components` → "Confirm") requires Vite + `node:fs` - only works in Node. Pre-build components locally, commit their `.js` files, and they'll still load in Workers.
- **Static file serving** is via the **Assets binding** (point to `dist/client/` in `wrangler.jsonc`), not `node:fs`.

### Runtime bindings in code

When `kind: "cloudflare"`, `src/server/entry-worker.ts` passes the Cloudflare `env` (containing `CONTENT_DB`, `MEDIA_BUCKET`, `KV`, `ASSETS`) to the handler. All route modules (`routes/content-entries.ts`, etc.) already accept it through the `context` parameter - no code changes needed.

Bindings used:
- `env.CONTENT_DB` - D1 database for entries, content-types, auth, roles
- `env.MEDIA_BUCKET` - R2 bucket for user uploads, icons, component bundles
- `env.KV` - Cloudflare KV for caching (optional, configured via `dry.config.ts`'s `kv` block)
- `env.ASSETS` - Workers Static Assets for the admin shell + client SPA

See [ARCHITECTURE.md](ARCHITECTURE.md#server-one-fetch-shaped-handler-adapter-per-runtime) for details.

### Debugging

```bash
# Local dev server with Workers bindings (not yet supported - use Node dev)
# For now, develop against local SQLite, test Workers deploy with `--dry-run`

# Check deployed Worker logs
wrangler tail
```

### Reset & redeploy

To wipe data and start fresh:

```bash
# Delete and recreate D1
wrangler d1 delete drycms
wrangler d1 create drycms

# Redeploy
bun run deploy
```

**Re-seed data** - after first-run Super Admin registration, the initial schema and content seed (if `dry.seed.json` exists) are applied automatically. To re-seed, delete the D1 database above and redeploy.
