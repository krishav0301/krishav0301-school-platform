import { z } from "@hono/zod-openapi";

import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { ProfileSchema, ProfileUpdateSchema, getOwnProfile, updateOwnProfile } from "./self";
import { resetTwoFactor } from "./service";

const ErrorSchema = z.object({ error: z.string() }).openapi("AccountsError");
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

export function registerAccounts(app: App): void {
  // Settings (D-091): your own profile. Anyone signed in sees it; only staff correct it (a student's details are the Co-ordinator's).
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/account/profile",
      operationId: "own_profile",
      tags: ["accounts"],
      description: "Your own name, email and phone, and whether you may correct them yourself.",
      access: { authenticated: true },
      responses: { 200: { description: "Your profile", content: { "application/json": { schema: ProfileSchema } } }, 404: { description: "Switched off", content: { "application/json": { schema: z.object({ error: z.string() }) } } } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const profile = await getOwnProfile(c.env.DB, c.get("auth")!.userPublicId);
      return profile ? c.json(profile, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/account/profile",
      operationId: "update_own_profile",
      tags: ["accounts"],
      description: "Correct your own name and phone (staff only). The email is your sign-in and is not changed here. Recorded in the audit log.",
      access: { action: "account.profile.edit" },
      request: { body: { required: true, content: { "application/json": { schema: ProfileUpdateSchema } } } },
      responses: {
        200: { description: "Saved", content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } } },
        403: { description: "Not staff, or switched off; nothing changed", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    },
    async (c) => {
      const result = await updateOwnProfile(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : c.json({ error: "forbidden" }, 403);
    },
  );

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
