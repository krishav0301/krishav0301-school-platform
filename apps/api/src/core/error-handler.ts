import type { Context } from "hono";

/**
 * What every unhandled exception gets: a log line naming the request it broke (visible in the Worker's
 * own logs even with no alerting service configured), and a generic answer that never leaks a stack
 * trace or an internal message to the caller.
 */
export function logUnhandledError(err: unknown, method: string, path: string): void {
  console.error(`Unhandled error on ${method} ${path}:`, err instanceof Error ? (err.stack ?? err.message) : err);
}

export function unhandledErrorResponse(c: Context): Response {
  return c.json({ error: "internal_error" }, 500);
}
