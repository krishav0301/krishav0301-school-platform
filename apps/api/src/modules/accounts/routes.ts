import { z } from "@hono/zod-openapi";

import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { resetTwoFactor } from "./service";

const ErrorSchema = z.object({ error: z.string() }).openapi("AccountsError");
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

export function registerAccounts(app: App): void {
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/users/{userId}/two-factor/reset",
      operationId: "reset_two_factor",
      tags: ["accounts"],
      description:
        "Removes a person's two-step sign-in and ends their sessions, so they set it up again at the next sign-in. For a lost phone with no recovery codes. Super Admin only; nobody resets their own.",
      access: { action: "accounts.reset_2fa" },
      request: { params: z.object({ userId: z.string().length(32) }) },
      responses: {
        204: { description: "Removed" },
        400: { description: "Nobody can reset their own two-step sign-in", content: json(ErrorSchema) },
        404: { description: "No such person", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const { userId } = c.req.valid("param");
      const result = await resetTwoFactor(c.env.DB, c.env.AUDIT_HMAC_KEY, { targetPublicId: userId, actorPublicId: c.get("auth")!.userPublicId });
      if (result === "own_account") return c.json({ error: "cannot_reset_own" }, 400);
      if (result === "not_found") return c.json({ error: "not_found" }, 404);
      return c.body(null, 204);
    },
  );
}
