import { z } from "@hono/zod-openapi";

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

/** Whole paisa, positive: never a float (CLAUDE.md section 6). NPR 1 is 100 paisa. */
export const PaisaSchema = z.number().int("Money is whole paisa").positive("The amount must be more than zero").max(10_000_000_000);

export const FrequencySchema = z.enum(["one_time", "monthly", "yearly", "whole_course"]);

export const NewStructureSchema = z.strictObject({ levelId: PublicIdSchema }).openapi("NewFeeStructure");
export const NewFeeItemSchema = z
  .strictObject({ name: z.string().trim().min(1, "Name the item").max(80, "Keep the name to 80 characters"), amountPaisa: PaisaSchema, frequency: FrequencySchema })
  .openapi("NewFeeItem");
export type NewFeeItem = z.infer<typeof NewFeeItemSchema>;
export const ChangeFeeItemSchema = z
  .strictObject({ name: z.string().trim().min(1).max(80).optional(), amountPaisa: PaisaSchema.optional(), frequency: FrequencySchema.optional(), isActive: z.boolean().optional() })
  .openapi("ChangeFeeItem");
export type ChangeFeeItem = z.infer<typeof ChangeFeeItemSchema>;
export const GenerateChargesSchema = z.strictObject({ classId: PublicIdSchema }).openapi("GenerateCharges");

export const StructureStatusSchema = z.enum(["draft", "waiting", "live"]);

const StructureSummary = {
  id: z.string(),
  levelId: z.string(),
  status: StructureStatusSchema,
  yearLabel: z.string(),
  programmeName: z.string(),
  levelName: z.string(),
  sectionKey: z.string(),
  yearlyTotalPaisa: z.number().int(),
};

export const FeeStructureListSchema = z.object({ structures: z.array(z.object(StructureSummary)) }).openapi("FeeStructureList");
export type FeeStructureList = z.infer<typeof FeeStructureListSchema>;

export const FeeStructureSchema = z
  .object({
    ...StructureSummary,
    items: z.array(z.object({ id: z.string(), name: z.string(), amountPaisa: z.number().int(), frequency: FrequencySchema })),
    classes: z.array(z.object({ id: z.string(), label: z.string(), students: z.number().int() })),
  })
  .openapi("FeeStructure");
export type FeeStructure = z.infer<typeof FeeStructureSchema>;

// --- Payments and the account (slice 3) --------------------------------------------------------------

/** The client's own key for one payment: a retry with it records nothing new and answers with the same receipt. */
const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "That is not a valid idempotency key");

export const CashPaymentSchema = z.strictObject({ enrollmentId: PublicIdSchema, amountPaisa: PaisaSchema, idempotencyKey: IdempotencyKeySchema, memo: z.string().trim().max(200).optional() }).openapi("CashPayment");
export type CashPayment = z.infer<typeof CashPaymentSchema>;

export const PaidSchema = z.object({ paymentId: z.string(), receipt: z.object({ id: z.string(), number: z.string() }) }).openapi("Paid");

export const VoucherSchema = z
  .strictObject({
    amountPaisa: PaisaSchema,
    bank: z.string().trim().min(1, "Name the bank").max(80),
    reference: z.string().trim().min(1, "Give the deposit's reference number").max(80),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD"),
  })
  .openapi("Voucher");
export type Voucher = z.infer<typeof VoucherSchema>;
export const RejectVoucherSchema = z.strictObject({ reason: z.string().trim().min(1, "Give a reason").max(300) }).openapi("RejectVoucher");

export const VoucherListSchema = z
  .object({
    vouchers: z.array(
      z.object({
        id: z.string(),
        enrollmentId: z.string(),
        studentName: z.string(),
        sid: z.string(),
        amountPaisa: z.number().int(),
        bank: z.string(),
        reference: z.string(),
        paidOn: z.string(),
        paidOnBs: z.string().nullable(),
        submittedAt: z.string(),
      }),
    ),
  })
  .openapi("VoucherList");
export type VoucherList = z.infer<typeof VoucherListSchema>;

export const OnlinePaymentSchema = z.strictObject({ amountPaisa: PaisaSchema }).openapi("OnlinePayment");
export const GatewayCallbackSchema = z.strictObject({ gatewayReference: z.string().min(1).max(120) }).openapi("GatewayCallback");

export const LedgerKindSchema = z.enum(["charge", "carried_dues", "discount", "payment", "reversal", "refund"]);

export const AccountSchema = z
  .object({
    enrollmentId: z.string(),
    studentName: z.string(),
    sid: z.string(),
    className: z.string(),
    yearLabel: z.string(),
    chargedPaisa: z.number().int(),
    discountPaisa: z.number().int(),
    /** Payments net of reversals. */
    paidPaisa: z.number().int(),
    refundedPaisa: z.number().int(),
    balancePaisa: z.number().int(),
    duePaisa: z.number().int(),
    overduePaisa: z.number().int(),
    creditPaisa: z.number().int(),
    nextDue: z.object({ dueOn: z.string(), dueOnBs: z.string().nullable(), remainingPaisa: z.number().int() }).nullable(),
    entries: z.array(
      z.object({
        id: z.string(),
        kind: LedgerKindSchema,
        amountPaisa: z.number().int(),
        memo: z.string().nullable(),
        period: z.string().nullable(),
        dueOnBs: z.string().nullable(),
        createdOnBs: z.string().nullable(),
        reversed: z.boolean(),
        receiptId: z.string().nullable(),
      }),
    ),
    receipts: z.array(z.object({ id: z.string(), number: z.string(), amountPaisa: z.number().int(), issuedOnBs: z.string().nullable(), reversed: z.boolean() })),
  })
  .openapi("FeeAccount");
export type Account = z.infer<typeof AccountSchema>;

export const ReceiptSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    amountPaisa: z.number().int(),
    method: z.enum(["cash", "voucher", "gateway"]),
    issuedAt: z.string(),
    issuedOnBs: z.string().nullable(),
    studentName: z.string(),
    sid: z.string(),
    className: z.string(),
    yearLabel: z.string(),
    reversed: z.boolean(),
    /** What is still owed on the student's account now, after this and every other entry. */
    balanceAfterPaisa: z.number().int(),
  })
  .openapi("Receipt");
export type Receipt = z.infer<typeof ReceiptSchema>;

// --- Discounts, reversals, refunds (slice 4) ------------------------------------------------------------

/** OPEN: CLAUDE.md section 9 default reasons; the client publishes a scholarship the list may need its own entry for. */
export const DiscountReasonSchema = z.enum(["scholarship", "sibling", "staff_child", "other"]);

export const ProposeDiscountSchema = z
  .strictObject({
    amountPaisa: PaisaSchema.optional(),
    percent: z.number().int().min(1).max(100).optional(),
    reason: DiscountReasonSchema,
    note: z.string().trim().max(300).optional(),
  })
  .refine((b) => (b.amountPaisa === undefined) !== (b.percent === undefined), "Give an amount or a percentage, not both")
  .openapi("ProposeDiscount");

export const ReversalRequestSchema = z.strictObject({ reason: z.string().trim().min(1, "Say why the payment is being reversed").max(300) }).openapi("ReversalRequest");
export const RefundRequestSchema = z.strictObject({ amountPaisa: PaisaSchema, reason: z.string().trim().min(1, "Say why").max(300) }).openapi("RefundRequest");
export const RecordRefundSchema = z
  .strictObject({ method: z.enum(["cash", "bank_transfer", "cheque"]), reference: z.string().trim().min(1).max(80).optional() })
  .openapi("RecordRefund");

export const AdjustmentListSchema = z
  .object({
    adjustments: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["discount", "reversal", "refund"]),
        status: z.enum(["draft", "pending", "approved", "recorded", "closed"]),
        amountPaisa: z.number().int(),
        reason: z.string().nullable(),
        note: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  })
  .openapi("AdjustmentList");
export type AdjustmentList = z.infer<typeof AdjustmentListSchema>;

// --- Dues and reports (slice 5) -------------------------------------------------------------------------

export const DuesListSchema = z
  .object({
    today: z.string(),
    students: z.array(
      z.object({
        enrollmentId: z.string(),
        /** The student's own id, so the dues list opens their fee account (D-104). */
        studentId: z.string(),
        studentName: z.string(),
        sid: z.string(),
        classId: z.string(),
        className: z.string(),
        hasEmail: z.boolean(),
        chargedPaisa: z.number().int(),
        discountPaisa: z.number().int(),
        paidPaisa: z.number().int(),
        balancePaisa: z.number().int(),
        duePaisa: z.number().int(),
        overduePaisa: z.number().int(),
      }),
    ),
    totals: z.object({ chargedPaisa: z.number().int(), discountPaisa: z.number().int(), paidPaisa: z.number().int(), duePaisa: z.number().int(), overduePaisa: z.number().int() }),
  })
  .openapi("DuesList");
export type DuesList = z.infer<typeof DuesListSchema>;
