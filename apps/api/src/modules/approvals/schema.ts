import { z } from "@hono/zod-openapi";

export const APPROVAL_KINDS = ["website_content", "fee_structure", "discount", "reversal", "refund"] as const;
export const ApprovalKindSchema = z.enum(APPROVAL_KINDS).openapi("ApprovalKind");
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

export const RequestInputSchema = z.strictObject({ kind: ApprovalKindSchema, subjectId: PublicIdSchema }).openapi("RequestApproval");
export type RequestInput = z.infer<typeof RequestInputSchema>;

const Reason = z.string().trim().min(1, "Give a reason").max(500, "Keep the reason to 500 characters");

/** `approve: true` needs nothing else; `approve: false` needs a reason. What `decideRequest` takes. */
export const DecisionInputSchema = z.discriminatedUnion("approve", [z.strictObject({ approve: z.literal(true) }), z.strictObject({ approve: z.literal(false), reason: Reason })]).openapi("Decision");
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

/** What the `POST .../decline` route itself takes over the wire: just the reason, `approve: false` is implied by the address. */
export const DeclineInputSchema = z.strictObject({ reason: Reason }).openapi("DeclineInput");
export type DeclineInput = z.infer<typeof DeclineInputSchema>;

export const ApprovalSummarySchema = z
  .object({
    id: z.string(),
    kind: ApprovalKindSchema,
    subjectId: z.string(),
    summary: z.string(),
    snapshot: z.unknown(),
    requestedBy: z.string(),
    createdAt: z.string(),
  })
  .openapi("ApprovalSummary");
export type ApprovalSummary = z.infer<typeof ApprovalSummarySchema>;

export const ApprovalListSchema = z.object({ requests: z.array(ApprovalSummarySchema) }).openapi("ApprovalList");
export type ApprovalList = z.infer<typeof ApprovalListSchema>;

export const MyApprovalSchema = ApprovalSummarySchema.extend({
  status: z.enum(["pending", "approved", "declined", "stale", "withdrawn"]),
  decisionReason: z.string().nullable(),
}).openapi("MyApproval");
export type MyApproval = z.infer<typeof MyApprovalSchema>;

export const MyApprovalListSchema = z.object({ requests: z.array(MyApprovalSchema) }).openapi("MyApprovalList");
export type MyApprovalList = z.infer<typeof MyApprovalListSchema>;
