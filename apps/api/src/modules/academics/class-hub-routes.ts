import { defineRoute } from "../../core/routes";
import type { App } from "../../core/types";
import { getClassHub, listClassHub } from "./class-hub";
import { giveRollNumbers } from "./rolls";
import { ErrorSchema, IdParam, json } from "./routes";
import { ClassHubListSchema, ClassHubSchema, RollNumbersResultSchema } from "./schema";

const VIEW = { action: "classes.view" } as const;
const GIVE_ROLLS = { action: "classes.rolls.generate" } as const;

/** A class as one page (FUT point 19, D-116): the classes a person opens, and one of them with its students. */
export function registerClassHub(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/classes",
      operationId: "list_class_pages",
      tags: ["academics"],
      description: "The classes of open terms the person opens: every class (or a wing's) for the Principal and the Co-ordinator; for a teacher, the classes they teach in or lead.",
      access: VIEW,
      responses: { 200: { description: "The classes", content: json(ClassHubListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listClassHub(c.env.DB, c.get("grant")!, c.get("auth")!.userPublicId), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/classes/{id}",
      operationId: "get_class_page",
      tags: ["academics"],
      description:
        "One class as a page: where it sits, its students, its subjects and exams, and what the person may see of it. A subject teacher gets names only, their own subjects, and no attendance. A class the person does not open is 404, the same as a missing one.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The class", content: json(ClassHubSchema) }, 404: { description: "No such class, or not one the person opens", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const hub = await getClassHub(c.env.DB, c.get("grant")!, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return hub ? c.json(hub, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/classes/{id}/roll-numbers",
      operationId: "give_roll_numbers",
      tags: ["academics"],
      description:
        "Gives every active student of the class who has no roll number the next numbers, alphabetically by name. Numbers already given never change, and a number is never given twice in a class. 409 when nobody is waiting for one or the term is closed.",
      access: GIVE_ROLLS,
      request: { params: IdParam },
      responses: {
        200: { description: "Numbered", content: json(RollNumbersResultSchema) },
        404: { description: "No such class, or not one the person may number", content: json(ErrorSchema) },
        409: { description: "Nobody is waiting for a roll number, or the term is closed", content: json(ErrorSchema) },
      },
    },
    async (c) => {
      const result = await giveRollNumbers(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      if (result.ok) return c.json(result.result, 200);
      if (result.reason === "not_found" || result.reason === "not_allowed") return c.json({ error: "not_found" }, 404);
      return c.json({ error: result.reason }, 409);
    },
  );
}
