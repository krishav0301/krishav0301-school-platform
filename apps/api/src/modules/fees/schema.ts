import { z } from "@hono/zod-openapi";

export const PublicIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "That is not a valid id");

/** Whole paisa, positive: never a float (CLAUDE.md section 6). NPR 1 is 100 paisa. */
export const PaisaSchema = z.number().int("Money is whole paisa").positive("The amount must be more than zero").max(10_000_000_000);

export const FrequencySchema = z.enum(["one_time", "monthly", "yearly", "whole_course"]);

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD");

/** A new structure (D-172): a name, a wing, a start and an end date (AD; the screens show BS). Its lines are added to the draft. */
export const NewStructureSchema = z
  .strictObject({ name: z.string().trim().min(1, "Name the fee structure").max(80, "Keep the name to 80 characters"), sectionKey: z.string().min(1).max(40), startDate: DateSchema, endDate: DateSchema })
  .openapi("NewFeeStructure");
export type NewStructure = z.infer<typeof NewStructureSchema>;
/** The next period of a structure: new dates; the lines are copied in. */
export const NewPeriodSchema = z.strictObject({ startDate: DateSchema, endDate: DateSchema }).openapi("NewFeePeriod");
export type NewPeriod = z.infer<typeof NewPeriodSchema>;
/** A line of a structure: a name and a price in whole paisa. The whole total is due on the structure's start date. */
export const NewFeeItemSchema = z.strictObject({ name: z.string().trim().min(1, "Name the line").max(80, "Keep the name to 80 characters"), amountPaisa: PaisaSchema }).openapi("NewFeeItem");
export type NewFeeItem = z.infer<typeof NewFeeItemSchema>;
export const ChangeFeeItemSchema = z.strictObject({ name: z.string().trim().min(1).max(80).optional(), amountPaisa: PaisaSchema.optional(), isActive: z.boolean().optional() }).openapi("ChangeFeeItem");
export type ChangeFeeItem = z.infer<typeof ChangeFeeItemSchema>;
export const RequestEditSchema = z.strictObject({ reason: z.string().trim().min(3, "Say why the structure should change, in at least 3 characters").max(500, "Keep the reason to 500 characters") }).openapi("RequestFeeEdit");
export const LinkLevelsSchema = z.strictObject({ levelIds: z.array(PublicIdSchema).min(1, "Choose at least one level").max(60) }).openapi("LinkFeeLevels");
export const LinkResultSchema = z
  .object({
    levels: z.array(z.object({ levelId: z.string(), ok: z.boolean(), reason: z.enum(["not_found", "not_live", "wrong_wing", "conflict", "ended"]).optional() })),
    charged: z.number().int(),
    /** More students are still to be charged; the sweep makes the rest within minutes. */
    pending: z.boolean(),
  })
  .openapi("LinkFeeLevelsResult");

export const StructureStatusSchema = z.enum(["draft", "waiting", "live"]);

const StructureSummary = {
  /** The version in force (or being drafted): what lines are added to and what is sent for approval. */
  id: z.string(),
  name: z.string(),
  sectionKey: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startDateBs: z.string().nullable(),
  endDateBs: z.string().nullable(),
  status: StructureStatusSchema,
  totalPaisa: z.number().int(),
  levelsLinked: z.number().int(),
  /** The structure's last day has passed: it no longer charges anyone, as if unlinked. Renew it with the next period. */
  ended: z.boolean(),
  /** This is a new version being drafted or waiting while the approved one stays in force (an edit). */
  editing: z.boolean(),
};

export const FeeStructureListSchema = z.object({ structures: z.array(z.object(StructureSummary)) }).openapi("FeeStructureList");
export type FeeStructureList = z.infer<typeof FeeStructureListSchema>;

export const FeeStructureSchema = z
  .object({
    ...StructureSummary,
    /** The lines. `frequency` is only on a structure from before D-172 (monthly, a term, the course); a new line is one charge. */
    items: z.array(z.object({ id: z.string(), name: z.string(), amountPaisa: z.number().int(), frequency: FrequencySchema })),
    /** The approved version still in force while this one is edited: its id and total. */
    inForce: z.object({ id: z.string(), totalPaisa: z.number().int() }).nullable(),
    /** An edit of this structure has been asked for and not yet decided. */
    editRequested: z.boolean(),
    levels: z.array(z.object({ levelId: z.string(), programmeName: z.string(), levelName: z.string(), students: z.number().int() })),
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
    /** Set when a student who left closed the account: nothing can be added to it again (D-172). */
    closed: z.object({ closedOnBs: z.string().nullable(), owedPaisa: z.number().int() }).nullable(),
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

export const GiveDiscountSchema = z
  .strictObject({
    amountPaisa: PaisaSchema.optional(),
    percent: z.number().int().min(1).max(100).optional(),
    reason: DiscountReasonSchema,
    note: z.string().trim().max(300).optional(),
  })
  .refine((b) => (b.amountPaisa === undefined) !== (b.percent === undefined), "Give an amount or a percentage, not both")
  .openapi("GiveDiscount");

export const ReversalRequestSchema = z.strictObject({ reason: z.string().trim().min(1, "Say why the payment is being reversed").max(300) }).openapi("ReversalRequest");
export const GiveRefundSchema = z
  .strictObject({
    amountPaisa: PaisaSchema,
    method: z.enum(["cash", "bank_transfer", "cheque"]),
    reference: z.string().trim().min(1).max(80).optional(),
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .openapi("GiveRefund");

export const DiscountListSchema = z
  .object({
    discounts: z.array(
      z.object({
        id: z.string(),
        amountPaisa: z.number().int(),
        percent: z.number().int().nullable(),
        reason: DiscountReasonSchema,
        note: z.string().nullable(),
        status: z.enum(["active", "removed", "replaced"]),
        /** The moment the Principal can no longer change or remove it (15 days after it was first given). */
        changeableUntil: z.string(),
        canChange: z.boolean(),
        createdAt: z.string(),
      }),
    ),
  })
  .openapi("DiscountList");

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
        /** The student left and the fee account is closed; what is owed stays owed. */
        closed: z.boolean(),
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

// --- Reports (slice 6) ----------------------------------------------------------------------------------

export const DiscountReportSchema = z
  .object({
    discounts: z.array(
      z.object({
        id: z.string(),
        studentName: z.string(),
        sid: z.string(),
        className: z.string(),
        amountPaisa: z.number().int(),
        percent: z.number().int().nullable(),
        reason: DiscountReasonSchema,
        note: z.string().nullable(),
        status: z.enum(["active", "removed", "replaced"]),
        givenOnBs: z.string().nullable(),
        givenBy: z.string(),
      }),
    ),
    /** What the active discounts add up to, and how many there are. */
    activePaisa: z.number().int(),
    activeCount: z.number().int(),
  })
  .openapi("DiscountReport");
export type DiscountReport = z.infer<typeof DiscountReportSchema>;

export const PriceChangeListSchema = z
  .object({
    students: z.array(
      z.object({
        enrollmentId: z.string(),
        studentId: z.string(),
        studentName: z.string(),
        sid: z.string(),
        className: z.string(),
        /** The net effect of the price changes on what the student owes: negative, they owe less. */
        changePaisa: z.number().int(),
        /** What the student owes now (negative: credit). */
        balancePaisa: z.number().int(),
        closed: z.boolean(),
      }),
    ),
  })
  .openapi("PriceChangeList");
export type PriceChangeList = z.infer<typeof PriceChangeListSchema>;
