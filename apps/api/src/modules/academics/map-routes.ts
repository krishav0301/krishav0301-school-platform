import { z } from "@hono/zod-openapi";

import { allowedSections } from "../../core/permissions";
import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { PublicIdSchema, SetupMapSchema } from "./schema";
import { ErrorSchema, json } from "./routes";
import { getSetupMap } from "./setup-map";

const TermQuery = z.object({ term: PublicIdSchema.optional() });

/** The setup map (the PM, 2026-10-10): the whole structure of the open terms, in one read-only answer. */
export function registerSetupMap(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/academics/setup-map",
      operationId: "get_setup_map",
      tags: ["academics"],
      description:
        "Each open term (or the one named) with its exam pattern, and under it Wing, Department and Level; each level with its subjects and its sections, and each section with its Class Teacher, who teaches which subject and how many students it has. Only the wings the person reaches.",
      access: { action: "setup.structure.view" },
      request: { query: TermQuery },
      responses: { 200: { description: "The setup map", content: json(SetupMapSchema) }, 404: { description: "No such open term", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const { term } = c.req.valid("query");
      const map = await getSetupMap(c.env.DB, allowedSections(c.get("grant")!), term ?? null);
      return term && map.terms.length === 0 ? c.json({ error: "not_found" }, 404) : c.json(map, 200);
    },
  );
}
