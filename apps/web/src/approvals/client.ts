import type { ApiClient } from "@/api/client";

import type { ApprovalReview, ApprovalSummary, FailReason, MyApproval } from "./model";

/**
 * Everything the approvals screens ask of the server. Nothing here throws: a dropped connection is
 * `failed`, like any other error.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };
export type WriteResult = { ok: true } | { ok: false; reason: FailReason };

function reasonOf(status: number): FailReason {
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

/**
 * A decision's refusal, from the server's own word (D-102): `stale` (it changed since it was sent), `already_decided`
 * (someone else decided it first, or it was taken back; admin FUT F-07), `own_request` (never your own; F-13). Two
 * Admins in two tabs can both reach a request, so an already-decided one is not the same as a stale one.
 */
function decisionReason(status: number, body: unknown): FailReason {
  const code = (body as { error?: string } | undefined)?.error;
  if (code === "stale" || code === "already_decided" || code === "own_request") return code;
  if (status === 409) return "already_decided";
  return reasonOf(status);
}

/** Tells the menu's waiting count to look again (admin FUT F-03): a decision anywhere changes it. */
export const APPROVALS_CHANGED = "approvals-changed";
export function announceApprovalsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(APPROVALS_CHANGED));
}

/** One request with everything needed to decide it (D-102). */
export async function loadReview(api: ApiClient, id: string): Promise<Loaded<ApprovalReview> | { ok: false; reason: "not_found" }> {
  try {
    const { data, response } = await api.GET("/api/approvals/{id}", { params: { path: { id } } });
    if (data) return { ok: true, data };
    if (response.status === 404) return { ok: false, reason: "not_found" };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function loadInbox(api: ApiClient): Promise<Loaded<ApprovalSummary[]>> {
  try {
    const { data, response } = await api.GET("/api/approvals");
    if (data) return { ok: true, data: data.requests };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function loadMine(api: ApiClient): Promise<Loaded<MyApproval[]>> {
  try {
    const { data, response } = await api.GET("/api/approvals/mine");
    if (data) return { ok: true, data: data.requests };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function sendForApproval(api: ApiClient, subjectId: string): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/approvals", { body: { kind: "website_content", subjectId } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function withdraw(api: ApiClient, id: string): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/approvals/{id}/withdraw", { params: { path: { id } } });
    if (response.ok) announceApprovalsChanged();
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function approve(api: ApiClient, id: string): Promise<WriteResult> {
  try {
    const { response, error } = await api.POST("/api/approvals/{id}/approve", { params: { path: { id } } });
    announceApprovalsChanged(); // approved, stale or decided by someone else: the waiting count may have moved
    if (response.ok) return { ok: true };
    return { ok: false, reason: decisionReason(response.status, error) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function decline(api: ApiClient, id: string, reason: string): Promise<WriteResult> {
  try {
    const { response, error } = await api.POST("/api/approvals/{id}/decline", { params: { path: { id } }, body: { reason } });
    announceApprovalsChanged();
    if (response.ok) return { ok: true };
    return { ok: false, reason: decisionReason(response.status, error) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
