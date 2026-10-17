import { z } from "@hono/zod-openapi";

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

/**
 * What the route accepts. It is deliberately loose: a number that is the wrong shape is refused by the service with a
 * sentence (422), the same answer as every other rule, not by the framework with a bare 400.
 */
export const LinkCardBodySchema = z.strictObject({ cardNumber: z.string().max(100), reason: z.string().max(300).optional() }).openapi("LinkCard");
export const RetireCardBodySchema = z.strictObject({ reason: z.string().max(300) }).openapi("RetireCard");

/** What the reader types, once trimmed: 4 to 32 letters and digits. Upper-cased by the service so 04a1 and 04A1 are one card. */
export const LinkCardSchema = z.strictObject({
  cardNumber: z.string().trim().regex(/^[0-9A-Za-z]{4,32}$/, "A card number is 4 to 32 letters and digits, with no spaces"),
  reason: z.string().trim().min(3, "Say why in a few words").max(300, "Keep the reason under 300 characters").optional(),
});
export type LinkCard = z.infer<typeof LinkCardSchema>;

export const RetireCardSchema = z.strictObject({
  reason: z.string().trim().min(3, "Say why in a few words").max(300, "Keep the reason under 300 characters"),
});

export const CardViewSchema = z
  .object({
    owner: z.object({ kind: z.enum(["student", "person"]), name: z.string() }),
    /** The card in use now; null when the person has none. `usable` is false while the owner is Left, Graduated or switched off. */
    current: z.object({ cardNumber: z.string(), issuedAt: z.string(), issuedOnBs: z.string().nullable(), usable: z.boolean() }).nullable(),
    history: z.array(z.object({ cardNumber: z.string(), issuedAt: z.string(), retiredAt: z.string(), retiredOnBs: z.string().nullable(), reason: z.string() })),
  })
  .openapi("CardView");
export type CardView = z.infer<typeof CardViewSchema>;
