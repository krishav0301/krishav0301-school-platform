import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { runInBackground } from "../../core/background";
import { runOutbox } from "../../core/notifications";
import { paymentGateway } from "../../core/payments";
import { defineRoute } from "../../core/routes";
import type { App, AppEnv } from "../../core/types";
import { enrollmentOfStudent, getReceipt, listAdjustments, ownAccount, staffAccount } from "./account";
import { giveRefund, requestReversal } from "./adjustments";
import { changeDiscount, discountsOf, giveDiscount, removeDiscount } from "./discounts";
import { discountReport, listPriceChanges } from "./reports";
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
  LinkLevelsSchema,
  LinkResultSchema,
  NewFeeItemSchema,
  NewPeriodSchema,
  NewStructureSchema,
  OnlinePaymentSchema,
  PaidSchema,
  GiveDiscountSchema,
  DiscountListSchema,
  DiscountReportSchema,
  PriceChangeListSchema,
  PublicIdSchema,
  ReceiptSchema,
  RequestEditSchema,
  GiveRefundSchema,
  RejectVoucherSchema,
  ReversalRequestSchema,
  VoucherListSchema,
  VoucherSchema,
} from "./schema";
import { addItem, changeItem, createStructure, discardEdit, getStructure, linkLevels, listStructures, requestEdit, sendStructure, startNextPeriod, unlinkLevel, type Failure } from "./structures";

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
const DISCOUNT = { action: "fees.discount.give" } as const;
const DISCOUNT_CHANGE = { action: "fees.discount.change" } as const;
const DISCOUNT_REPORT = { action: "fees.discount.report" } as const;
const PRICE_CHANGES = { action: "fees.pricechange.view" } as const;
const REVERSAL = { action: "fees.reversal.request" } as const;
const REFUND = { action: "fees.refund.give" } as const;
const REPORTS = { action: "reports.fees" } as const;
const REMINDERS = { action: "fees.reminders.send" } as const;
const ClassQuery = z.object({ classId: PublicIdSchema.optional() });

const paid = (c: Context<AppEnv>, result: PayResult) =>
  result.ok ? c.json({ paymentId: result.paymentId, receipt: result.receipt }, 201) : fail(c, result);
const LINK = { action: "fees.structure.link" } as const;
const EDIT = { action: "fees.structure.edit_request" } as const;
const VIEW = { action: "fees.view" } as const;

export function registerFees(app: App): void {
  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/structures",
      operationId: "list_fee_structures",
      tags: ["fees"],
      description: "The fee structures in the person's wings, newest period first. Not for students (their own fees are at /api/fees/me).",
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
      description: "One fee structure: its lines, its total, and the levels it is linked to with their student counts.",
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
      description: "Drafts a fee structure in a wing: a name, a start date and an end date. Lines are added to the draft; the Principal approves it; then it is linked to levels.",
      access: DRAFT,
      request: { body: { required: true, content: json(NewStructureSchema) } },
      responses: { 201: { description: "Drafted", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await createStructure(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("json"));
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
      description: "Adds a line to a draft: a name and a price in whole paisa. The lines add up to the structure's total, due on its start date.",
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
      description: "Changes a draft's line, or switches it off. A structure waiting for approval or live does not change.",
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
      description: "Sends a draft with at least one line to the Principal for approval. It is locked while it waits.",
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
      path: "/api/fees/structures/{id}/next-period",
      operationId: "start_next_fee_period",
      tags: ["fees"],
      description: "Starts the next period of a structure: a new draft of the same name and wing with the new dates and a copy of its lines, to edit and send for approval. Reuse for next year.",
      access: DRAFT,
      request: { params: IdParam, body: { required: true, content: json(NewPeriodSchema) } },
      responses: { 201: { description: "Drafted", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await startNextPeriod(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures/{id}/edit-request",
      operationId: "request_fee_structure_edit",
      tags: ["fees"],
      description: "Asks the Principal to let an approved structure be edited, with a reason. The approved version stays in force. When the Principal approves the request, a draft copy appears for the Accountant to edit and send for approval again.",
      access: EDIT,
      request: { params: IdParam, body: { required: true, content: json(RequestEditSchema) } },
      responses: { 201: { description: "Asked; the approval request's id", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await requestEdit(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").reason);
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures/{id}/discard",
      operationId: "discard_fee_structure_edit",
      tags: ["fees"],
      description: "Gives up a draft edit of an approved structure (only a draft that replaces an approved version). The approved version is untouched, and a new edit can be asked for.",
      access: DRAFT,
      request: { params: IdParam },
      responses: { 200: { description: "Discarded", content: json(z.object({ ok: z.literal(true) })) }, ...failures },
    },
    async (c) => {
      const result = await discardEdit(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "post",
      path: "/api/fees/structures/{id}/levels",
      operationId: "link_fee_levels",
      tags: ["fees"],
      description: "Links an approved structure to levels of its wing, with no approval. Every student of a linked level is then charged automatically, and so is one who joins later. A level has one structure for any dates.",
      access: LINK,
      request: { params: IdParam, body: { required: true, content: json(LinkLevelsSchema) } },
      responses: { 200: { description: "What happened to each level, and how many charges were made now", content: json(LinkResultSchema) }, ...failures },
    },
    async (c) => {
      const result = await linkLevels(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json").levelIds);
      return result.ok ? c.json({ levels: result.levels.map((l) => ({ levelId: l.levelId, ok: l.ok, ...(l.ok ? {} : { reason: l.reason }) })), charged: result.charged, pending: result.pending }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "delete",
      path: "/api/fees/structures/{id}/levels/{levelId}",
      operationId: "unlink_fee_level",
      tags: ["fees"],
      description: "Removes a level's link. Refused (409 in_use) once any student of the level, charged under it, has paid anything.",
      access: LINK,
      request: { params: z.object({ id: PublicIdSchema, levelId: PublicIdSchema }) },
      responses: { 200: { description: "Unlinked", content: json(z.object({ ok: z.literal(true) })) }, ...failures },
    },
    async (c) => {
      const { id, levelId } = c.req.valid("param");
      const result = await unlinkLevel(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, id, levelId);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
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
      operationId: "give_discount",
      tags: ["fees"],
      description: "The Principal gives a discount (an amount, or a percentage of what was charged, with a reason), never more than the fees in all. It applies at once; for 15 days the Principal can change or remove it, then it is frozen.",
      access: DISCOUNT,
      request: { params: IdParam, body: { required: true, content: json(GiveDiscountSchema) } },
      responses: { 201: { description: "Given; the discount's own id", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await giveDiscount(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/enrollments/{id}/discounts",
      operationId: "list_discounts",
      tags: ["fees"],
      description: "The discounts given on one student's account, newest first, with whether the Principal can still change each.",
      access: VIEW,
      request: { params: IdParam },
      responses: { 200: { description: "The discounts", content: json(DiscountListSchema) }, 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const grant = c.get("grant")!;
      if (!grant.institution && grant.sections.length === 0) return c.json({ error: "not_found" }, 404);
      const id = c.req.valid("param").id;
      const found = await listAdjustments(c.env.DB, grant, id);
      return found ? c.json({ discounts: await discountsOf(c.env.DB, id) }, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/discounts",
      operationId: "discount_report",
      tags: ["fees"],
      description: "The Principal's report of every discount given: the student, class, amount, reason, day and who gave it, and what the active ones add up to.",
      access: DISCOUNT_REPORT,
      responses: { 200: { description: "The report", content: json(DiscountReportSchema) } },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await discountReport(c.env.DB), 200);
    },
  );

  defineRoute(
    app,
    {
      method: "get",
      path: "/api/fees/structures/{id}/price-changes",
      operationId: "list_price_changes",
      tags: ["fees"],
      description: "The students whose billing a structure's approved edits changed: the net change for each and what they owe now.",
      access: PRICE_CHANGES,
      request: { params: IdParam },
      responses: { 200: { description: "The students", content: json(PriceChangeListSchema) }, 404: failures[404] },
    },
    async (c) => {
      c.header("Cache-Control", "no-store");
      const found = await listPriceChanges(c.env.DB, c.get("grant")!, c.req.valid("param").id);
      return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
    },
  );

  defineRoute(
    app,
    {
      method: "patch",
      path: "/api/fees/discounts/{id}",
      operationId: "change_discount",
      tags: ["fees"],
      description: "The Principal changes a discount within 15 days of giving it: the old one is taken back and the new one given in one step. After 15 days it is frozen.",
      access: DISCOUNT_CHANGE,
      request: { params: IdParam, body: { required: true, content: json(GiveDiscountSchema) } },
      responses: { 200: { description: "Changed; the new discount's id", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await changeDiscount(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 200) : fail(c, result);
    },
  );

  defineRoute(
    app,
    {
      method: "delete",
      path: "/api/fees/discounts/{id}",
      operationId: "remove_discount",
      tags: ["fees"],
      description: "The Principal takes a discount back within 15 days of giving it: a new entry cancels it and the student owes it again. After 15 days it is frozen.",
      access: DISCOUNT_CHANGE,
      request: { params: IdParam },
      responses: { 200: { description: "Taken back", content: json(z.object({ ok: z.literal(true) })) }, ...failures },
    },
    async (c) => {
      const result = await removeDiscount(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id);
      return result.ok ? c.json({ ok: true as const }, 200) : fail(c, result);
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
      operationId: "give_refund",
      tags: ["fees"],
      description: "The Accountant pays back a student's credit (what was paid over what is owed), up to the credit and no more. It is written to the ledger at once; no approval.",
      access: REFUND,
      request: { params: IdParam, body: { required: true, content: json(GiveRefundSchema) } },
      responses: { 201: { description: "Paid back", content: json(Created) }, ...failures },
    },
    async (c) => {
      const result = await giveRefund(c.env.DB, c.env.AUDIT_HMAC_KEY, c.get("auth")!.userPublicId, c.req.valid("param").id, c.req.valid("json"));
      return result.ok ? c.json({ id: result.publicId }, 201) : fail(c, result);
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
