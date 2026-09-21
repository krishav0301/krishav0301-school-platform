import { createApp } from "./app";
import { runOutbox } from "./core/notifications";
import type { Bindings } from "./core/types";
import { isFilledPage, renderPublicPage } from "./modules/site";

const app = createApp();

// Static files are served by Cloudflare directly, without waking this Worker. Only /api/* and the few public
// pages in `FILLED_PAGES` (see `run_worker_first` in wrangler.jsonc) come here; those pages get what is true
// for this school written into them so crawlers that do not run JavaScript find real words (D-046).
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    const method = request.method;
    if ((method === "GET" || method === "HEAD") && env.ASSETS && isFilledPage(new URL(request.url).pathname)) return renderPublicPage(request, env);
    return app.fetch(request, env, ctx);
  },
  // The sweep (see `triggers.crons` in wrangler.jsonc). A request delivers what it queues straight
  // away; this retries whatever failed or was left behind, so nothing depends on a single attempt.
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runOutbox(env).then((result) => console.warn(`Outbox sweep: ${JSON.stringify(result)}`)));
  },
};
