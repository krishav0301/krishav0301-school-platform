import type { ApiClient } from "@/api/client";
import type { components } from "@/api/schema";
import type { Loaded } from "@/setup/client";

/** The Audit trail and Sign-ins views (D-102, admin FUT F-11): read only, the Admin's and Support's. */
export type AuditTrail = components["schemas"]["AuditTrail"];
export type SignInLog = components["schemas"]["SignInLog"];

export const AREAS = ["people", "structure", "admissions", "daily", "fees", "results", "approvals", "website"] as const;
export type Area = (typeof AREAS)[number];

async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const loadAuditTrail = (api: ApiClient, query: { page: number; area?: Area; q?: string }) =>
  load(() => api.GET("/api/audit/events", { params: { query: { page: query.page, ...(query.area ? { area: query.area } : {}), ...(query.q ? { q: query.q } : {}) } } }));

export const loadSignIns = (api: ApiClient, query: { page: number; failedOnly: boolean; q?: string }) =>
  load(() => api.GET("/api/audit/sign-ins", { params: { query: { page: query.page, ...(query.failedOnly ? { failed: "1" as const } : {}), ...(query.q ? { q: query.q } : {}) } } }));
