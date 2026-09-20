import { createApp } from "./app";
import { runOutbox } from "./core/notifications";
import type { Bindings } from "./core/types";

const app = createApp();

// Requests outside /api/* never reach this Worker: Cloudflare serves the static web app directly.
export default {
  fetch: app.fetch,
  // The sweep (see `triggers.crons` in wrangler.jsonc). A request delivers what it queues straight
  // away; this retries whatever failed or was left behind, so nothing depends on a single attempt.
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runOutbox(env).then((result) => console.warn(`Outbox sweep: ${JSON.stringify(result)}`)));
  },
};
