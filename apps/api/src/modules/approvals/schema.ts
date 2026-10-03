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
    /** The requester's role, for "Gita Thapa, Accountant"; Support's own requests show as "Support" (CLAUDE.md section 5). */
    requesterRole: z.enum(["coordinator", "accountant", "admin", "super_admin"]).nullable(),
    /** Sent by the person reading: never theirs to decide (D-102, admin FUT F-13). */
    mine: z.boolean(),
    /** The day it was sent, in BS, by Nepal's clock. */
    createdOnBs: z.string().nullable(),
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

/**
 * What the review panel shows for each of the five kinds (D-102), read from the subject as it stands now. A pending
 * request whose subject has changed since it was sent is `stale` and can no longer be approved (CLAUDE.md section 6).
 */
const Student = { student: z.string(), sid: z.string(), className: z.string().nullable() };
export const ApprovalDetailSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("website_content"),
      contentKind: z.string(),
      title: z.string(),
      /** The start of the text that will be published, as written (light markup), at most 1,500 characters. */
      bodyPreview: z.string(),
      bodyTruncated: z.boolean(),
      publishOnBs: z.string().nullable(),
      holidayFromBs: z.string().nullable(),
      holidayToBs: z.string().nullable(),
    }),
    z.object({
      kind: z.literal("fee_structure"),
      programme: z.string(),
      level: z.string(),
      year: z.string(),
      items: z.array(z.object({ name: z.string(), amountPaisa: z.number().int(), frequency: z.enum(["one_time", "monthly", "yearly", "whole_course"]) })),
      yearlyTotalPaisa: z.number().int(),
    }),
    z.object({
      kind: z.literal("discount"),
      ...Student,
      amountPaisa: z.number().int(),
      percent: z.number().int().nullable(),
      reason: z.enum(["scholarship", "sibling", "staff_child", "other"]).nullable(),
      note: z.string().nullable(),
    }),
    z.object({
      kind: z.literal("reversal"),
      ...Student,
      amountPaisa: z.number().int(),
      reason: z.string().nullable(),
      payment: z.object({ amountPaisa: z.number().int(), paidOnBs: z.string().nullable(), receiptNumber: z.string().nullable(), method: z.string().nullable() }).nullable(),
    }),
    z.object({
      kind: z.literal("refund"),
      ...Student,
      amountPaisa: z.number().int(),
      /** What the student has paid beyond what is charged, now (not counting this refund). */
      availableCreditPaisa: z.number().int(),
      note: z.string().nullable(),
    }),
  ])
  .openapi("ApprovalDetail");
export type ApprovalDetail = z.infer<typeof ApprovalDetailSchema>;

export const ApprovalReviewSchema = z
  .object({
    request: ApprovalSummarySchema,
    status: z.enum(["pending", "stale", "approved", "declined", "withdrawn"]),
    decisionReason: z.string().nullable(),
    /** Null when the subject is gone. */
    detail: ApprovalDetailSchema.nullable(),
  })
  .openapi("ApprovalReview");
export type ApprovalReview = z.infer<typeof ApprovalReviewSchema>;
