import { z } from "@hono/zod-openapi";

import { readDevMailbox } from "../../core/email";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const MailboxSchema = z
  .object({
    messages: z.array(z.object({ id: z.number().int(), at: z.string(), to: z.string(), subject: z.string(), body: z.string() })),
  })
  .openapi("DevMailbox");

/**
 * The test mailbox (D-086). Where email goes to the "dev" adapter (development and staging; refused in production by
 * `core/environment.ts`), nothing is really sent, so UAT testers could never follow a verification or reset link. An
 * Admin reads here what would have been sent. With any other adapter the address does not exist.
 */
export function registerNotifications(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/dev/mailbox",
      operationId: "dev_mailbox",
      tags: ["notifications"],
      description: "The emails the site would have sent, newest first (the last 100). Only where email is not really sent; never in production.",
      access: { action: "dev.mailbox.view" },
      responses: {
        200: { description: "The kept emails", content: json(MailboxSchema) },
        404: { description: "Email is really sent here, so there is no test mailbox", content: json(z.object({ error: z.string() })) },
      },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      if (c.env.EMAIL_ADAPTER !== "dev") return c.json({ error: "not_found" }, 404);
      return c.json({ messages: await readDevMailbox(c.env.DB) }, 200);
    },
  );
}
