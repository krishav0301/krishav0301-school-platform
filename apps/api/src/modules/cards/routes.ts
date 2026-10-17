import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import type { CardOwnerKind } from "./guard";
import { readCards } from "./queries";
import { CardViewSchema, LinkCardBodySchema, PublicIdSchema, RetireCardBodySchema } from "./schema";
import { linkCard, retireCard, type CardResult } from "./service";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const ErrorSchema = z.object({ error: z.string() }).openapi("CardError");
const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("CardInvalid");
const OkSchema = z.object({ ok: z.literal(true) }).openapi("CardOk");
const IdParam = z.object({ id: PublicIdSchema });

const notFound = { 404: { description: "No such person, not one the caller may manage, no card to retire, or cards are switched off for this school", content: json(ErrorSchema) } };

/** Turns a service refusal into the documented answer (the cast is because one function serves every route's answer type). */
function answer(c: Context<AppEnv>, result: CardResult): never {
  if (result.ok) return c.json({ ok: true as const }, 200) as never;
  if (result.reason === "invalid") return c.json({ error: "invalid" as const, message: result.message }, 422) as never;
  if (result.reason === "conflict") return c.json({ error: result.error }, 409) as never;
  return c.json({ error: "not_found" }, 404) as never;
}

const WHO = {
  students: { noun: "student", path: "students" },
  people: { noun: "staff member (a teacher, Co-ordinator, Accountant or Admin)", path: "people" },
} as const satisfies Record<CardOwnerKind, { noun: string; path: string }>;

/** RFID cards (D-174): which card number belongs to which person. Only while the `card_attendance` module is on. */
export function registerCards(app: App): void {
  for (const kind of ["students", "people"] as const) {
    const { noun, path } = WHO[kind];
    const word = kind === "students" ? "student" : "person";

    defineRoute(
      app,
      {
        method: "get",
        path: `/api/cards/${path}/{id}`,
        operationId: `get_${word}_card`,
        tags: ["cards"],
        description: `A ${noun}'s card in use and the cards retired before it. The number is what the reader types. \`usable\` is false while the person has left, graduated or been switched off.`,
        access: { action: "cards.view" },
        request: { params: IdParam },
        responses: { 200: { description: "The card and its history", content: json(CardViewSchema) }, ...notFound },
      },
      async (c) => {
        c.header("Cache-Control", "no-store");
        const view = await readCards(c.env.DB, c.get("auth")!.userPublicId, kind, c.req.valid("param").id);
        return view ? c.json(view, 200) : c.json({ error: "not_found" }, 404);
      },
    );

    defineRoute(
      app,
      {
        method: "put",
        path: `/api/cards/${path}/{id}`,
        operationId: `link_${word}_card`,
        tags: ["cards"],
        description: `Links a card to a ${noun}, or replaces the one they have (then a reason is required and the old card is retired). Sending the same number again changes nothing. A number belongs to one person for good.`,
        access: { action: "cards.manage" },
        request: { params: IdParam, body: { required: true, content: json(LinkCardBodySchema) } },
        responses: {
          200: { description: "Linked (or already linked to this person)", content: json(OkSchema) },
          ...notFound,
          409: { description: "That number is another person's, or was retired (`card_in_use`), or the person's card changed meanwhile (`changed`)", content: json(ErrorSchema) },
          422: { description: "The number is the wrong shape, or a replacement has no reason", content: json(InvalidSchema) },
        },
      },
      async (c) => answer(c, await linkCard(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, kind, c.req.valid("param").id, c.req.valid("json"))),
    );

    defineRoute(
      app,
      {
        method: "post",
        path: `/api/cards/${path}/{id}/retire`,
        operationId: `retire_${word}_card`,
        tags: ["cards"],
        description: `Retires a ${noun}'s card with a reason, for example when it is lost. Nothing is deleted, and the number can never be linked again.`,
        access: { action: "cards.manage" },
        request: { params: IdParam, body: { required: true, content: json(RetireCardBodySchema) } },
        responses: {
          200: { description: "Retired", content: json(OkSchema) },
          ...notFound,
          422: { description: "No reason given", content: json(InvalidSchema) },
        },
      },
      async (c) => answer(c, await retireCard(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, kind, c.req.valid("param").id, c.req.valid("json"))),
    );
  }
}
