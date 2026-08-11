# Production hang: every admin request "treo" with no error (2026-08-12)

## Plan

Diagnose from `wrangler tail` (production Worker `mai-anh-quyen`), then fix
the cause rather than the symptom. Reported as: `/dry/api/content/category`
hangs forever, no response, no error; "everything except
`/dry/api/content-types` is stalled".

## Status

### What the logs actually showed

```
03:42:31   401   wall=1ms    GET content/category?page=0&pageSize=5&...
03:50:23   401   wall=0ms    GET memory
03:50:25   401   wall=1ms    GET content-types          <- also 401
03:50:25   401   wall=0ms    GET content/blog?...
        ...6 seconds, zero requests - no refresh attempted...
03:50:32   200   wall=2892ms POST auth/refresh          <- only after a manual reload
03:50:35   200   wall=102ms  GET content/blog?...       <- everything healthy again
```

The server never hung: it answered 401 in 0-1ms. The 15-minute access token
had expired, and the BROWSER never recovered - no refresh was attempted at
all until the page was reloaded. Nothing surfaced the 401, so the UI sat on
spinners. "Only content-types works" was its IndexedDB cache rendering stale
data; that endpoint was 401ing too.

D1 was healthy throughout (direct `SELECT COUNT(*)` = 0.19ms), R2 fine,
public site fine.

### Root cause - three links, all the same anti-pattern

One promise, created inside one request/tab, awaited by another that can
never be released if the first goes away:

1. `lib/native/csrf-fetch.ts` - on 401 it awaits `refreshOnce()` before
   retrying, and shares that ONE promise across every 401'd request. Wedged
   promise = whole admin wedged.
2. `store/auth.ts` - the rotation ran inside `navigator.locks.request()`
   with no timeout. A Web Lock is released only when its holder finishes or
   its page dies; a tab whose refresh wedged (or that the browser froze in
   the background) does neither, so every later 401 queued behind it
   silently, in every tab.
3. `server/auth-security.ts` - `refreshLocks` chains a request's promise
   into the next request's `await`, released only in that request's
   `finally`. On workerd a canceled request (the admin reloading while a
   refresh is in flight - exactly what a frozen UI provokes) has its pending
   I/O canceled, so that `finally` never runs and the promise never settles.
   Every later refresh for the same token then hangs for the life of the
   isolate: no response, no error, and no `wrangler tail` event, since an
   invocation is only logged when it ends.

Cancellation in production is not hypothetical - the tail caught
`outcome: canceled` twice within 30 minutes.

### Fixes

- `server/auth-security.ts` - `awaitPreviousLock()` bounds the wait on the
  previous rotation (10s) and heals the chain (the waiter already installed
  its own lock and does release it).
- `server/rate-limit.ts` - same bound (3s) on the login-counter lock.
- `store/auth.ts` - Web Lock wait bounded (12s, via `{ signal }`) with an
  unlocked rotate as the fallback; the refresh POST itself bounded (15s) and
  never throwing - it returns `null` so the caller's own 401 surfaces.
- `store/auth.ts` + `csrf-fetch.ts` - `markSessionExpired()`: a 401 the
  refresh couldn't rescue now flips `authState` to `anonymous`, so `AuthGate`
  shows Sign in instead of leaving every page spinning. Entry drafts live in
  IndexedDB, so nothing in progress is lost.

Found while hunting, same class, NOT the cause of this incident:

- `content-types/engine/entries-d1.ts` + `engine/d1.ts` - the D1 bootstrap
  memos cached an IN-FLIGHT promise keyed by binding, which poisons an
  isolate the same way. They now memoize only completed work (`WeakSet`),
  paying an idempotent `CREATE TABLE IF NOT EXISTS` on a racing request
  instead.
- `storage/r2.ts` + `routes/storage.ts` - a media read round-tripped R2's web
  stream through `Readable.fromWeb`/`toWeb`; the `nodejs_compat` cancel path
  throws `TypeError: Cannot read properties of undefined (reading
  '_readableState')` on every canceled `<video>` download (seen in the tail).
  `StorageReadResult.webStream` now hands the response R2's own stream, and
  `stream` became a lazy getter so the conversion never locks it.

### Verification

- `bun run typecheck` clean; `bun run test` 1048 passed (16 pre-existing
  failures in seed/dry-reader/engine specs, untouched by this work).
- Two new regression tests in `store/auth.test.ts`: a lock that is never
  released still refreshes (unlocked), and a refresh request that never
  returns resolves to `null` instead of hanging. `FakeLockManager` gained the
  real `{ signal }` overload.
- `bunx playwright test` 22/22; `bun run build:worker` builds.
- NOT yet deployed - production still runs the broken version at the time of
  writing.

### Also observed (not fixed)

- Public homepage spiked to 3.7-5.4s several times (usually 255-337ms), with
  one visitor-canceled request at 5s.
- `/favicon.ico` 404s cost 2-3.2s each, through the Worker.

## Speed

Diagnosis to fix in one session, driven entirely by `wrangler tail` +
`wrangler d1 execute` against production; no local repro was possible (the
local dev DB can't even log in on this branch - it has a `system-user-avatar`
field of a type no branch here registers).
