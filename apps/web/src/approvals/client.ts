import type { ApiClient } from "@/api/client";

import type { ApprovalSummary, FailReason, MyApproval } from "./model";

/**
 * Everything the approvals screens ask of the server. Nothing here throws: a dropped connection is
 * `failed`, like any other error.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };
export type WriteResult = { ok: true } | { ok: false; reason: FailReason };

function reasonOf(status: number): FailReason {
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict"; // the server does not distinguish "already resolved" from "stale" by status alone; 409 covers both, and `stale` is read from the body below where present
  if (status === 400 || status === 422) return "rejected";
  return "failed";
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
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** A 409 on a decide is always `stale`: an already-resolved request cannot be reached (the inbox no longer lists it). */
export async function approve(api: ApiClient, id: string): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/approvals/{id}/approve", { params: { path: { id } } });
    if (response.ok) return { ok: true };
    return { ok: false, reason: response.status === 409 ? "stale" : reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function decline(api: ApiClient, id: string, reason: string): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/approvals/{id}/decline", { params: { path: { id } }, body: { reason } });
    if (response.ok) return { ok: true };
    return { ok: false, reason: response.status === 409 ? "stale" : reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
