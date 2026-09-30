import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { runInBackground } from "../../core/background";
import { runOutbox } from "../../core/notifications";
import { paymentGateway } from "../../core/payments";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { enrollmentOfStudent, getReceipt, listAdjustments, ownAccount, staffAccount } from "./account";
import { proposeDiscount, recordRefund, requestRefund, requestReversal } from "./adjustments";
import { duesCsv, listDues, sendOverdueReminders } from "./dues";
import { gatewayCallback, listVouchers, recordCash, rejectVoucher, startOnlinePayment, submitVoucher, verifyVoucher, type PayResult } from "./payments";
import {
  AccountSchema,
  AdjustmentListSchema,
  CashPaymentSchema,
  ChangeFeeItemSchema,
  DuesListSchema,
  FeeStructureListSchema,
  FeeStructureSchema,
  GatewayCallbackSchema,
  GenerateChargesSchema,
  NewFeeItemSchema,
  NewStructureSchema,
  OnlinePaymentSchema,
  PaidSchema,
  ProposeDiscountSchema,
  PublicIdSchema,
  ReceiptSchema,
  RecordRefundSchema,
  RefundRequestSchema,
  RejectVoucherSchema,
  ReversalRequestSchema,
  VoucherListSchema,
  VoucherSchema,
} from "./schema";
import { addItem, changeItem, createStructure, generateCharges, getStructure, listStructures, sendStructure, type Failure } from "./structures";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
export const ErrorSchema = z.object({ error: z.string() }).openapi("FeesError");
export const InvalidSchema = z.object({ error: z.literal("invalid"), message: z.string() }).openapi("FeesInvalid");
const IdParam = z.object({ id: PublicIdSchema });
const Created = z.object({ id: z.string() });

export const failures = {
  403: { description: "Not allowed", content: json(ErrorSchema) },
  404: { description: "No such item, or not one the person may reach", content: json(ErrorSchema) },
  409: { description: "Not possible in its current state (not a draft, not live, already there, or the year is closed)", content: json(ErrorSchema) },
  422: { description: "Not valid", content: json(InvalidSchema) },
};

/** A fees write's failure as an answer. */
export function fail(c: Context<AppEnv>, failure: Failure | { ok: false; reason: string; message?: string }): never {
  if (failure.reason === "invalid") return c.json({ error: "invalid" as const, message: (failure as { message: string }).message }, 422) as never;
  if (failure.reason === "not_found") return c.json({ error: "not_found" }, 404) as never;
  if (failure.reason === "not_allowed") return c.json({ error: "forbidden" }, 403) as never;
  return c.json({ error: failure.reason }, 409) as never;
}

const DRAFT = { action: "fees.structure.draft" } as const;
const CASH = { action: "fees.cash.record" } as const;
const VOUCHER_UPLOAD = { action: "fees.voucher.upload" } as const;
const VOUCHER_VERIFY = { action: "fees.voucher.verify" } as const;
const ONLINE = { action: "fees.online.pay" } as const;
const RECEIPTS = { action: "fees.receipts.view" } as const;
const DISCOUNT = { action: "fees.discount.propose" } as const;
const REVERSAL = { action: "fees.reversal.request" } as const;
const REFUND = { action: "fees.refund.request" } as const;
const REFUND_RECORD = { action: "fees.refund.record" } as const;
const REPORTS = { action: "reports.fees" } as const;
const REMINDERS = { action: "fees.reminders.send" } as const;
const ClassQuery = z.object({ classId: PublicIdSchema.optional() });

const paid = (c: Context<AppEnv>, result: PayResult) =>
  result.ok ? c.json({ paymentId: result.paymentId, receipt: result.receipt }, 201) : fail(c, result);
const GENERATE = { action: "fees.charges.generate" } as const;
const VIEW = { action: "fees.view" } as const;

export function registerFees(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/structures",
      operationId: "list_fee_structures",
      tags: ["fees"],
      description: "The active year's fee structures in the person's sections. Not for students (their own fees are at /api/fees/me).",
      access: VIEW,
      responses: { 200: { description: "The structures", content: json(FeeStructureListSchema) }, 403: failures[403] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "forbidden" }, 403);
      return c.json(await listStructures(c.env.DB, grant), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/structures/{id}",
      operationId: "get_fee_structure",
      tags: ["fees"],
      description: "One fee structure: its items, its yearly total, and the classes of its level with their student counts.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The structure", content: json(FeeStructureSchema) }, 403: failures[403], 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "forbidden" }, 403);
      const found = await getStructure(c.env.DB, grant, c.req.valid("param").id);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures",
      operationId: "create_fee_structure",
      tags: ["fees"],
      description: "Drafts the active year's fee structure for a programme level. One per level and year.",
      access: DRAFT,
      request: { body: { required: true, content: json(NewStructureSchema) } },
      responses: { 201: { description: "Drafted", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await createStructure(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json").levelId);
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures/{id}/items",
      operationId: "add_fee_item",
      tags: ["fees"],
      description: "Adds an item to a draft: a name, an amount in whole paisa, and how often it is billed.",
      access: DRAFT,
      request: { params: IdParam, body: { required: true, content: json(NewFeeItemSchema) } },
      responses: { 201: { description: "Added", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await addItem(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/fees/items/{id}",
      operationId: "change_fee_item",
      tags: ["fees"],
      description: "Changes a draft's item, or switches it off. A structure waiting for approval or live does not change.",
      access: DRAFT,
      request: { params: IdParam, body: { required: true, content: json(ChangeFeeItemSchema) } },
      responses: { 200: { description: "Changed", content: json(z.object({ ok: z.literal(true) })) }, ...failures },
    },
    async (c) => {
      const result = await changeItem(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures/{id}/send",
      operationId: "send_fee_structure",
      tags: ["fees"],
      description: "Sends a draft with at least one item to the Admins for approval. It is locked while it waits.",
      access: DRAFT,
      request: { params: IdParam },
      responses: { 201: { description: "Sent; the approval request's id", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await sendStructure(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures/{id}/charges",
      operationId: "generate_fee_charges",
      tags: ["fees"],
      description: "Makes every missing charge for the active students of one class of the structure's level, from the live structure. Safe to repeat.",
      access: GENERATE,
      request: { params: IdParam, body: { required: true, content: json(GenerateChargesSchema) } },
      responses: { 200: { description: "Made", content: json(z.object({ created: z.number().int() })) }, ...failures },
    },
    async (c) => {
      const result = await generateCharges(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").classId);
      return result.ok ? c.json({ created: result.created }, 200) : fail(c, result);
    },
  );

  // --- The account (slice 3, D-076) ------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/me",
      operationId: "get_own_fees",
      tags: ["fees"],
      description: "The signed-in student's own fee account this year: charges, discounts, payments, what is due and overdue, the next due, the history and the receipts.",
      access: VIEW,
      responses: { 200: { description: "The account", content: json(AccountSchema) }, 404: { description: "No enrollment this year", content: json(ErrorSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const found = await ownAccount(c.env.DB, c.get("auth")!.userPublicId);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/enrollments/{id}",
      operationId: "get_fee_account",
      tags: ["fees"],
      description: "One student's fee account for one enrollment, for the Accountant (their sections) and the Admin (read). A student uses /me.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The account", content: json(AccountSchema) }, 403: failures[403], 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "not_found" }, 404);
      const found = await staffAccount(c.env.DB, grant, c.req.valid("param").id);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/students/{id}",
      operationId: "get_student_fee_account",
      tags: ["fees"],
      description: "A student's current fee account, found by the student's id (what search returns). For staff in the student's section.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The account", content: json(AccountSchema) }, 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "not_found" }, 404);
      const enrollment = await enrollmentOfStudent(c.env.DB, c.req.valid("param").id);
      const found = enrollment ? await staffAccount(c.env.DB, grant, enrollment) : null;
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/receipts/{id}",
      operationId: "get_receipt",
      tags: ["fees"],
      description: "One receipt, generated from the ledger. A student sees only their own; staff their sections.",
      access: RECEIPTS,
      request: { params: IdParam },
      responses: { 200: { description: "The receipt", content: json(ReceiptSchema) }, 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      const staff = grant.institution || grant.sections.length > 0;
      const found = await getReceipt(c.env.DB, c.req.valid("param").id, { grant, ownerUser: staff ? null : c.get("auth")!.userPublicId });
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- Payments ------------------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/payments/cash",
      operationId: "record_cash_payment",
      tags: ["fees"],
      description: "Cash at the counter: a payment and its numbered receipt, in one batch. The idempotency key makes a retry answer with the same receipt and record nothing new.",
      access: CASH,
      request: { body: { required: true, content: json(CashPaymentSchema) } },
      responses: { 201: { description: "Paid", content: json(PaidSchema) }, ...failures },
    },
    async (c) => paid(c, await recordCash(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"))),
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/me/vouchers",
      operationId: "submit_voucher",
      tags: ["fees"],
      description: "The student reports a bank deposit (the bank and its reference; no scan while file storage is off). The Accountant verifies it.",
      access: VOUCHER_UPLOAD,
      request: { body: { required: true, content: json(VoucherSchema) } },
      responses: { 201: { description: "Reported", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await submitVoucher(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/vouchers",
      operationId: "list_vouchers",
      tags: ["fees"],
      description: "Vouchers waiting for the Accountant, oldest first, in their sections.",
      access: VOUCHER_VERIFY,
      responses: { 200: { description: "The vouchers", content: json(VoucherListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listVouchers(c.env.DB, c.get("grant")!), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/vouchers/{id}/verify",
      operationId: "verify_voucher",
      tags: ["fees"],
      description: "Verifies a voucher: it becomes a payment with a numbered receipt, in one batch. Once.",
      access: VOUCHER_VERIFY,
      request: { params: IdParam },
      responses: { 201: { description: "Paid", content: json(PaidSchema) }, ...failures },
    },
    async (c) => paid(c, await verifyVoucher(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id)),
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/vouchers/{id}/reject",
      operationId: "reject_voucher",
      tags: ["fees"],
      description: "Rejects a voucher, with a reason. The student may report the deposit again, corrected.",
      access: VOUCHER_VERIFY,
      request: { params: IdParam, body: { required: true, content: json(RejectVoucherSchema) } },
      responses: { 200: { description: "Rejected", content: json(z.object({ ok: z.literal(true) })) }, ...failures },
    },
    async (c) => {
      const result = await rejectVoucher(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").reason);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/me/online-payments",
      operationId: "start_online_payment",
      tags: ["fees"],
      description: "Starts an online payment through the gateway. Only the demo adapter exists until Phase 9, and only in demo mode: otherwise 404.",
      access: ONLINE,
      request: { body: { required: true, content: json(OnlinePaymentSchema) } },
      responses: { 201: { description: "Started", content: json(z.object({ gatewayReference: z.string(), redirectUrl: z.string() })) }, 404: failures[404] },
    },
    async (c) => {
      const gateway = paymentGateway(c.env);
      if (!gateway) return c.json({ error: "not_found" }, 404);
      const result = await startOnlinePayment(c.env.DB, c.env.AUDIT_HMAC_KEY, gateway, c.get("auth")!.userPublicId, c.req.valid("json").amountPaisa);
      return result.ok ? c.json({ gatewayReference: result.gatewayReference, redirectUrl: result.redirectUrl }, 201) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/gateway/callback",
      operationId: "gateway_callback",
      tags: ["fees"],
      description:
        "The gateway's notice that a payment happened. Confirmed by asking the gateway itself, never by trusting this call, and applied once: a repeat answers the same. OPEN: a real gateway posts from its own origin; the same-origin rule needs an exception for this address in Phase 9.",
      access: { public: true },
      request: { body: { required: true, content: json(GatewayCallbackSchema) } },
      responses: { 200: { description: "Applied (or already applied)", content: json(z.object({ ok: z.literal(true) })) }, 404: failures[404], 409: failures[409] },
    },
    async (c) => {
      const gateway = paymentGateway(c.env);
      if (!gateway) return c.json({ error: "not_found" }, 404);
      const result = await gatewayCallback(c.env.DB, c.env.AUDIT_HMAC_KEY, gateway, c.req.valid("json").gatewayReference);
      if (result.ok) return c.json({ ok: true as const }, 200);
      return result.reason === "not_paid" ? c.json({ error: "not_paid" }, 409) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- Discounts, reversals, refunds (slice 4, D-077) ----------------------------------------------------
  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/enrollments/{id}/discounts",
      operationId: "propose_discount",
      tags: ["fees"],
      description: "Proposes a discount (an amount, or a percentage of what was charged, with a reason) and sends it to the Admins. Nothing changes until one approves it.",
      access: DISCOUNT,
      request: { params: IdParam, body: { required: true, content: json(ProposeDiscountSchema) } },
      responses: { 201: { description: "Sent for approval; the request's own id", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await proposeDiscount(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/payments/{id}/reversal",
      operationId: "request_reversal",
      tags: ["fees"],
      description: "Asks the Admins to reverse a payment made in error, with a reason. Approved, a new entry cancels it in full; the payment and its receipt stay on record.",
      access: REVERSAL,
      request: { params: IdParam, body: { required: true, content: json(ReversalRequestSchema) } },
      responses: { 201: { description: "Sent for approval", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await requestReversal(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").reason);
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/enrollments/{id}/refunds",
      operationId: "request_refund",
      tags: ["fees"],
      description: "Asks the Admins to refund credit (what was paid over what is owed). Approved, it is recorded as paid back, and only then written to the ledger.",
      access: REFUND,
      request: { params: IdParam, body: { required: true, content: json(RefundRequestSchema) } },
      responses: { 201: { description: "Sent for approval", content: json(Created) }, ...failures },
    },
    async (c) => {
      const { amountPaisa, reason } = c.req.valid("json");
      const result = await requestRefund(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, amountPaisa, reason);
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/refunds/{id}/record",
      operationId: "record_refund",
      tags: ["fees"],
      description: "Records how an approved refund was paid back. The ledger takes the refund in the same batch. Once.",
      access: REFUND_RECORD,
      request: { params: IdParam, body: { required: true, content: json(RecordRefundSchema) } },
      responses: { 200: { description: "Recorded", content: json(z.object({ ok: z.literal(true) })) }, ...failures },
    },
    async (c) => {
      const { method, reference } = c.req.valid("json");
      const result = await recordRefund(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, method, reference);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/enrollments/{id}/adjustments",
      operationId: "list_fee_adjustments",
      tags: ["fees"],
      description: "The discount, reversal and refund requests on one student's account, newest first, with where each stands.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The requests", content: json(AdjustmentListSchema) }, 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "not_found" }, 404);
      const found = await listAdjustments(c.env.DB, grant, c.req.valid("param").id);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  // --- Dues, reports and reminders (slice 5, D-078) -------------------------------------------------------
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/dues",
      operationId: "list_dues",
      tags: ["fees"],
      description: "Every student of the active year in the person's sections (or one class), with charged, discounted, paid, due and overdue, from the ledger.",
      access: REPORTS,
      request: { query: ClassQuery },
      responses: { 200: { description: "The dues list", content: json(DuesListSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await listDues(c.env.DB, c.get("grant")!, c.req.valid("query").classId ?? null), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/dues.csv",
      operationId: "export_dues",
      tags: ["fees"],
      description: "The dues list as CSV with NPR amounts in Nepali grouping, for Excel. OPEN: a native .xlsx needs a library the PM has not approved yet.",
      access: REPORTS,
      request: { query: ClassQuery },
      responses: { 200: { description: "The CSV", content: { "text/csv": { schema: z.string() } } } },
    },
    async (c) => {
      const csv = duesCsv(await listDues(c.env.DB, c.get("grant")!, c.req.valid("query").classId ?? null));
      c.header("Cache-Control", "no-store");
      c.header("Content-Disposition", 'attachment; filename="dues.csv"');
      return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8" });
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/reminders",
      operationId: "send_overdue_reminders",
      tags: ["fees"],
      description: "Emails every student in the Accountant's sections who has something overdue. Once per student per day: pressing it again sends nothing new.",
      access: REMINDERS,
      responses: { 200: { description: "Queued", content: json(z.object({ queued: z.number().int() })) } },
    },
    async (c) => {
      const result = await sendOverdueReminders(c.env.DB, c.env.AUDIT_HMAC_KEY, c.env.DATA_KEY, c.get("auth")!.userPublicId, c.get("grant")!);
      // Deliver what was just queued, as the other modules that send email do; the cron sweep retries the rest.
      const pending = runInBackground(c, runOutbox(c.env));
      if (pending) await pending;
      return c.json(result, 200);
    },
  );
}
