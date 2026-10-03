import { z } from "@hono/zod-openapi";

import { AUDIT_AREAS } from "../../core/audit";

const AREAS = Object.keys(AUDIT_AREAS) as [keyof typeof AUDIT_AREAS, ...(keyof typeof AUDIT_AREAS)[]];

const Page = z.coerce.number().int().min(1).max(10_000).optional();
const Search = z.string().trim().max(100).optional();

export const AuditTrailQuery = z.object({ page: Page, area: z.enum(AREAS).optional(), q: Search });
export const SignInQuery = z.object({ page: Page, failed: z.enum(["1", "0"]).optional(), q: Search });

const When = { onBs: z.string().nullable(), time: z.string(), at: z.string() };
const Paging = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };

export const AuditTrailSchema = z
  .object({
    rows: z.array(
      z.object({
        id: z.number().int(),
        ...When,
        action: z.string(),
        entityType: z.string(),
        summary: z.string(),
        reason: z.string().nullable(),
        /** The person's name; "Support" for the build team; null for the system itself. */
        actor: z.string().nullable(),
      }),
    ),
    ...Paging,
  })
  .openapi("AuditTrail");

export const SignInLogSchema = z
  .object({
    rows: z.array(
      z.object({
        id: z.number().int(),
        ...When,
        name: z.string().nullable(),
        email: z.string(),
        success: z.boolean(),
        reason: z.string().nullable(),
        ip: z.string().nullable(),
      }),
    ),
    ...Paging,
  })
  .openapi("SignInLog");
