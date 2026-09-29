import type { ApiClient } from "@/api/client";

import type { Account, AdjustmentList, DuesList, FeeStructure, FeeStructureList, Receipt, VoucherList } from "./model";

/** What the fee screens ask of the server, as plain results. Nothing here throws. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "not_found" | "failed" };

async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    if (data) return { ok: true, data };
    if (response.status === 403) return { ok: false, reason: "forbidden" };
    if (response.status === 404) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const gateFailure = (reason: "forbidden" | "not_found" | "failed") => ({ ok: false, reason: reason === "forbidden" ? "forbidden" : "failed" }) as const;

export const loadOwnAccount = (api: ApiClient): Promise<Loaded<Account>> => load(() => api.GET("/api/fees/me"));
export const loadStudentAccount = (api: ApiClient, studentId: string): Promise<Loaded<Account>> => load(() => api.GET("/api/fees/students/{id}", { params: { path: { id: studentId } } }));
export const loadAdjustments = (api: ApiClient, enrollmentId: string): Promise<Loaded<AdjustmentList>> =>
  load(() => api.GET("/api/fees/enrollments/{id}/adjustments", { params: { path: { id: enrollmentId } } }));
export const loadReceipt = (api: ApiClient, id: string): Promise<Loaded<Receipt>> => load(() => api.GET("/api/fees/receipts/{id}", { params: { path: { id } } }));
export const loadStructures = (api: ApiClient): Promise<Loaded<FeeStructureList>> => load(() => api.GET("/api/fees/structures"));
export const loadStructure = (api: ApiClient, id: string): Promise<Loaded<FeeStructure>> => load(() => api.GET("/api/fees/structures/{id}", { params: { path: { id } } }));
export const loadVouchers = (api: ApiClient): Promise<Loaded<VoucherList>> => load(() => api.GET("/api/fees/vouchers"));
export const loadDues = (api: ApiClient): Promise<Loaded<DuesList>> => load(() => api.GET("/api/fees/dues"));

/** A write's plain result: done, the API's own words (422), or a state it cannot happen in. */
export type Sent<T = unknown> = { ok: true; data: T } | { ok: false; reason: "invalid"; message: string } | { ok: false; reason: "refused" | "closed" | "failed" };

async function send<T>(run: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Sent<T>> {
  try {
    const { data, error, response } = await run();
    if (response.ok) return { ok: true, data: data as T };
    if (response.status === 422 && error && typeof error === "object" && "message" in error) return { ok: false, reason: "invalid", message: String((error as { message: unknown }).message) };
    if (response.status === 409 && (error as { error?: string } | undefined)?.error === "year_closed") return { ok: false, reason: "closed" };
    if (response.status === 400 || response.status === 404 || response.status === 409) return { ok: false, reason: "refused" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const recordCash = (api: ApiClient, body: { enrollmentId: string; amountPaisa: number; idempotencyKey: string }) => send(() => api.POST("/api/fees/payments/cash", { body }));
export const proposeDiscount = (api: ApiClient, enrollmentId: string, body: { amountPaisa?: number; percent?: number; reason: "scholarship" | "sibling" | "staff_child" | "other"; note?: string }) =>
  send(() => api.POST("/api/fees/enrollments/{id}/discounts", { params: { path: { id: enrollmentId } }, body }));
export const requestReversal = (api: ApiClient, paymentId: string, reason: string) => send(() => api.POST("/api/fees/payments/{id}/reversal", { params: { path: { id: paymentId } }, body: { reason } }));
export const requestRefund = (api: ApiClient, enrollmentId: string, body: { amountPaisa: number; reason: string }) =>
  send(() => api.POST("/api/fees/enrollments/{id}/refunds", { params: { path: { id: enrollmentId } }, body }));
export const recordRefund = (api: ApiClient, id: string, body: { method: "cash" | "bank_transfer" | "cheque"; reference?: string }) =>
  send(() => api.POST("/api/fees/refunds/{id}/record", { params: { path: { id } }, body }));
export const createStructure = (api: ApiClient, levelId: string) => send(() => api.POST("/api/fees/structures", { body: { levelId } }));
export const addFeeItem = (api: ApiClient, structureId: string, body: { name: string; amountPaisa: number; frequency: "one_time" | "monthly" | "yearly" | "whole_course" }) =>
  send(() => api.POST("/api/fees/structures/{id}/items", { params: { path: { id: structureId } }, body }));
export const removeFeeItem = (api: ApiClient, itemId: string) => send(() => api.PATCH("/api/fees/items/{id}", { params: { path: { id: itemId } }, body: { isActive: false } }));
export const sendStructure = (api: ApiClient, id: string) => send(() => api.POST("/api/fees/structures/{id}/send", { params: { path: { id } } }));
export const generateCharges = (api: ApiClient, id: string, classId: string) => send(() => api.POST("/api/fees/structures/{id}/charges", { params: { path: { id } }, body: { classId } }));
export const verifyVoucher = (api: ApiClient, id: string) => send(() => api.POST("/api/fees/vouchers/{id}/verify", { params: { path: { id } } }));
export const rejectVoucher = (api: ApiClient, id: string, reason: string) => send(() => api.POST("/api/fees/vouchers/{id}/reject", { params: { path: { id } }, body: { reason } }));
export const submitVoucher = (api: ApiClient, body: { amountPaisa: number; bank: string; reference: string; paidOn: string }) => send(() => api.POST("/api/fees/me/vouchers", { body }));
export const sendReminders = (api: ApiClient) => send(() => api.POST("/api/fees/reminders"));
