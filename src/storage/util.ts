import type { Readable } from "node:stream";

/** Runs `fn` over `items` with at most `limit` operations in flight. */
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

/** Creates a consistent message for a batch storage mutation. */
export function commitMessage(action: string, relPath: string): string {
  return `${new Date().toISOString()} ${action}: ${relPath || "/"}`;
}
