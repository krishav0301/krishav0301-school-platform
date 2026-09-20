import { z } from "@hono/zod-openapi";

import { loadConfig } from "../../core/config";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { ThemeSchema } from "../../core/theme";
import { saveTheme } from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const ErrorSchema = z.object({ error: z.string() }).openapi("ConfigError");

const PublicConfigSchema = z
  .object({
    school: z.object({
      name: z.string(),
      shortName: z.string(),
      currency: z.string(),
      timezone: z.string(),
      region: z.string(),
      template: z.string().nullable(),
    }),
    sections: z.array(z.object({ key: z.string(), name: z.string() })),
    /** Every module and whether this school uses it. */
    modules: z.record(z.string(), z.boolean()),
    /** Every renameable word with its final text for this school. */
    terms: z.record(z.string(), z.string()),
    theme: ThemeSchema.nullable(),
  })
  .openapi("PublicConfig");

const ContrastFailureSchema = z.object({
  mode: z.enum(["light", "dark"]),
  rule: z.string(),
  label: z.string(),
  ratio: z.number(),
  minimum: z.number(),
});

export function registerConfig(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/config/public",
      operationId: "public_config",
      tags: ["config"],
      description: "What the web app needs to draw itself for this school: name, sections, wording, modules, theme.",
      access: { public: true },
      responses: {
        200: { description: "The school's configuration", content: json(PublicConfigSchema) },
        503: { description: "This school has not been set up yet", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const config = await loadConfig(c.env.DB);
      if (!config) {
        c.header("Cache-Control", "no-store");
        return c.json({ error: "not_provisioned" }, 503);
      }
      c.header("Cache-Control", "public, max-age=60");
      return c.json(config, 200);
    },
  );

  defineRoute(
    app,
    {
      method: "put",
      path: "/api/config/theme",
      operationId: "save_theme",
      tags: ["config"],
      description: "Replaces the school's theme. Refused unless every colour pair passes the readability check.",
      access: { action: "branding.manage" },
      request: { body: { required: true, content: json(ThemeSchema) } },
      responses: {
        200: { description: "Saved and active", content: json(z.object({ theme: ThemeSchema })) },
        422: {
          description: "The theme is not readable. Nothing was saved.",
          content: json(z.object({ error: z.literal("contrast_check_failed"), failures: z.array(ContrastFailureSchema) })),
        },
      },
    },
    async (c) => {
      const theme = c.req.valid("json");
      const result = await saveTheme(c.env.DB, c.env.AUDIT_HMAC_KEY, theme, c.get("auth")!.userPublicId);
      if (!result.ok) return c.json({ error: "contrast_check_failed" as const, failures: result.failures }, 422);
      return c.json({ theme }, 200);
    },
  );
}
