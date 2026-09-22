import { createApp } from "./app";
import { runOutbox } from "./core/notifications";
import type { Bindings } from "./core/types";
import { expireStaleApplications } from "./modules/admissions/service";
import { isCrawlerFile, isFilledPage, renderCrawlerFile, renderPublicPage } from "./modules/site";

const app = createApp();

// Static files are served by Cloudflare directly, without waking this Worker. Only /api/* and the few public
// pages in `FILLED_PAGES` (see `run_worker_first` in wrangler.jsonc) come here; those pages get what is true
// for this school written into them so crawlers that do not run JavaScript find real words (D-046).
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    const method = request.method;
    if (method === "GET" || method === "HEAD") {
      const { pathname } = new URL(request.url);
      if (isCrawlerFile(pathname)) return renderCrawlerFile(request, env);
      if (env.ASSETS && isFilledPage(pathname)) return renderPublicPage(request, env);
    }
    return app.fetch(request, env, ctx);
  },
  // The sweep (see `triggers.crons` in wrangler.jsonc). A request delivers what it queues straight
  // away; this retries whatever failed or was left behind, so nothing depends on a single attempt.
  // The same 5-minute schedule also expires abandoned, never-verified applications (D-063): both are
  // cheap, low-volume housekeeping, so neither needs a cron trigger of its own.
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runOutbox(env).then((result) => console.warn(`Outbox sweep: ${JSON.stringify(result)}`)));
    ctx.waitUntil(expireStaleApplications(env.DB).then((result) => console.warn(`Application expiry sweep: ${JSON.stringify(result)}`)));
  },
};
