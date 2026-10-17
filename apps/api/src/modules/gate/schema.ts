import { z } from "@hono/zod-openapi";

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

export const SCAN_RESULTS = ["marked", "again", "recorded", "no_school", "unknown", "retired", "inactive"] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

/** What the route accepts: loose on purpose, so a bad value is refused by the service with a sentence (422), like every other rule. */
export const ScanBodySchema = z.strictObject({ cardNumber: z.string().max(200), scanId: z.string().max(100), at: z.string().max(40).optional() }).openapi("GateScan");

/** What a tap must be: the number the reader typed (upper-cased), an id the gate page made for this tap, and optionally when it happened. */
export const ScanInputSchema = z.strictObject({
  cardNumber: z.string().trim().regex(/^[0-9A-Za-z]{1,100}$/, "That is not a card number"),
  scanId: z.string().regex(/^[0-9A-Za-z_-]{8,64}$/, "The scan needs an id of 8 to 64 letters, digits, dashes or underscores"),
  at: z.iso.datetime({ offset: true, message: "The tap time is not a valid time" }).optional(),
});

export const ScanResponseSchema = z
  .object({
    result: z.enum(SCAN_RESULTS),
    /** Who the card is, for the screen to greet; null for an unknown card. */
    person: z.object({ name: z.string(), kind: z.enum(["student", "staff"]), role: z.string().nullable(), place: z.string().nullable() }).nullable(),
    /** When the card was tapped (the server's time unless the gate sent an earlier one it had kept offline). */
    at: z.string(),
    /** For `again`: when the first tap of the day was. */
    firstAt: z.string().nullable(),
  })
  .openapi("GateScanResult");

export const AccountNameSchema = z.strictObject({ name: z.string().trim().min(2, "Give the gate a name of at least 2 letters").max(60, "Keep the name under 60 characters") });
export const AccountBodySchema = z.strictObject({ name: z.string().max(200) }).openapi("GateAccountName");

/** Signing a computer in: loose, so a wrong shape is the same "that did not work" as a wrong password. */
export const SignInBodySchema = z.strictObject({ gateId: z.string().max(100), password: z.string().max(300), code: z.string().max(30), computer: z.string().max(200).optional() }).openapi("GateSignIn");
export const SignInResponseSchema = z.object({ key: z.string(), account: z.string(), computer: z.object({ id: z.string(), label: z.string() }) }).openapi("GateSignedIn");

export const IssuedLoginSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    gateId: z.string(),
    password: z.string(),
    authenticator: z.object({ secret: z.string(), uri: z.string() }),
  })
  .openapi("GateLoginIssued");

export const AccountListSchema = z
  .object({
    accounts: z.array(
      z.object({
        id: z.string(),
        gateId: z.string(),
        name: z.string(),
        status: z.enum(["active", "disabled"]),
        createdAt: z.string(),
        computers: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            status: z.enum(["active", "revoked"]),
            signedInAt: z.string(),
            lastSeenAt: z.string().nullable(),
            /** The Nepal day of the last tap as a Bikram Sambat date, and the time of day there ("14:05"); null before the first tap. */
            lastSeenOnBs: z.string().nullable(),
            lastSeenTime: z.string().nullable(),
          }),
        ),
      }),
    ),
  })
  .openapi("GateAccountList");

export const MeSchema = z.object({ account: z.string(), computer: z.string() }).openapi("GateMe");
