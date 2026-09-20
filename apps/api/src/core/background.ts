import type { Context } from "hono";

/**
 * Lets work continue after the response has gone out (delivering an email that a request queued).
 * A failure here is logged and forgotten: the event is still in the outbox, so the next sweep retries it.
 * Where there is no execution context (some tests), the work is returned so the caller can await it.
 */
export function runInBackground(c: Context, work: Promise<unknown>): Promise<unknown> | void {
  const safe = work.catch((error) => console.error("Background job failed:", error instanceof Error ? error.message : error));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    return safe;
  }
}
