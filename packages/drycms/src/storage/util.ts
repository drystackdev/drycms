import type { Readable } from "node:stream";

/** Runs `fn` over `items` with at most `limit` in flight at once - a plain
 * `Promise.all(items.map(fn))` would fire all of them simultaneously. Shared
 * by the `github`/`gitlab` adapters, both of which page through remote APIs
 * where an unbounded fan-out risks opening far too many sockets at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function bufferOf(data: Readable | Uint8Array): Promise<Buffer> {
  if (data instanceof Uint8Array) return Buffer.from(data);
  const chunks: Buffer[] = [];
  for await (const chunk of data) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Shared by the `github`/`gitlab` adapters, whose commit-based writes both
 * need a message string. */
export function commitMessage(action: string, relPath: string): string {
  return `${new Date().toISOString()} ${action}: ${relPath || "/"}`;
}

/** Inverse of joining a path onto the configured storage `root`: strips it
 * back off, or `null` if `entryPath` lies outside it entirely. Shared by the
 * `github`/`gitlab` adapters, whose recursive-tree APIs return paths
 * relative to the whole repo/project, not scoped to `root`. */
export function stripRoot(root: string, entryPath: string): string | null {
  if (root === "") return entryPath;
  if (entryPath === root) return "";
  if (entryPath.startsWith(`${root}/`)) return entryPath.slice(root.length + 1);
  return null;
}
