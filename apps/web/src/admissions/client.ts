import type { ApiClient } from "@/api/client";

import type { ApplicantForm, ApplicationDetail, ApplicationSummary, OpenLevel, StudentDetail, StudentSummary } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };

export async function loadOpenLevels(api: ApiClient): Promise<Loaded<OpenLevel[]>> {
  try {
    const { data, response } = await api.GET("/api/admissions/levels");
    if (data) return { ok: true, data: data.levels };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** A random, URL-safe token: the public form's own idempotency key, made once per visit to the form. */
export function newSubmissionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type ApplyOutcome = { ok: true; id: string } | { ok: false; reason: "throttled" | "not_found" | "failed" } | { ok: false; reason: "invalid"; message: string };

function applicantBody(values: ApplicantForm, dob: string) {
  return {
    firstName: values.firstName.trim(),
    middleName: values.middleName.trim() || undefined,
    lastName: values.lastName.trim(),
    dob,
    phone: values.phone.trim(),
    email: values.email.trim(),
    guardianName: values.guardianName.trim(),
    guardianPhone: values.guardianPhone.trim(),
    previousSchool: values.previousSchool.trim() || undefined,
    referredBy: values.referredBy.trim() || undefined,
    levelId: values.levelId,
  };
}

/**
 * Anonymous. `website` is the honeypot: a field off-screen and out of the tab order (see
 * ApplyScreen), so a real visitor never fills it, but a script that fills every field it finds does.
 */
export async function apply(api: ApiClient, values: ApplicantForm, dob: string, submissionToken: string, website: string): Promise<ApplyOutcome> {
  try {
    const { data, response, error } = await api.POST("/api/admissions/apply", { body: { ...applicantBody(values, dob), submissionToken, website } });
    if (data) return { ok: true, id: data.id };
    if (response.status === 429) return { ok: false, reason: "throttled" };
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type VerifyOutcome = { ok: true } | { ok: false };

export async function verifyEmail(api: ApiClient, token: string): Promise<VerifyOutcome> {
  try {
    const { response } = await api.POST("/api/admissions/verify", { body: { token } });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

export type RegisterOutcome = { ok: true; id: string } | { ok: false; reason: "forbidden" | "not_found" | "failed" } | { ok: false; reason: "invalid"; message: string };
/** A walk-in is admitted in the same request, so the answer also carries the SID and the one-time temporary
 * password: shown here and nowhere else (never emailed), for the Co-ordinator to hand the student in front of them. */
export type WalkInOutcome = { ok: true; id: string; sid: string; temporaryPassword: string } | { ok: false; reason: "forbidden" | "not_found" | "failed" } | { ok: false; reason: "invalid"; message: string };

export async function registerWalkIn(api: ApiClient, values: ApplicantForm, dob: string, classId: string): Promise<WalkInOutcome> {
  try {
    const { data, response, error } = await api.POST("/api/admissions/walk-ins", { body: { ...applicantBody(values, dob), classId } });
    if (data) return { ok: true, id: data.id, sid: data.sid, temporaryPassword: data.temporaryPassword };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function registerForQueue(api: ApiClient, values: ApplicantForm, dob: string): Promise<RegisterOutcome> {
  try {
    const { data, response, error } = await api.POST("/api/admissions/register", { body: applicantBody(values, dob) });
    if (data) return { ok: true, id: data.id };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function loadQueue(api: ApiClient): Promise<Loaded<ApplicationSummary[]>> {
  try {
    const { data, response } = await api.GET("/api/admissions/queue");
    if (data) return { ok: true, data: data.applications };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type LoadApplicationResult = { ok: true; data: ApplicationDetail } | { ok: false; reason: "forbidden" | "not_found" | "failed" };

export async function loadApplication(api: ApiClient, id: string): Promise<LoadApplicationResult> {
  try {
    const { data, response } = await api.GET("/api/admissions/applications/{id}", { params: { path: { id } } });
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type DecideOutcome = { ok: true } | { ok: false; reason: "forbidden" | "not_found" | "conflict" | "failed" } | { ok: false; reason: "invalid"; message: string };

export async function requestChanges(api: ApiClient, id: string, fields: string[], reason: string): Promise<DecideOutcome> {
  try {
    const { response } = await api.POST("/api/admissions/applications/{id}/request-changes", { params: { path: { id } }, body: { fields, reason } });
    if (response.ok) return { ok: true };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 409 ? "conflict" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function rejectApplication(api: ApiClient, id: string, reason: string): Promise<DecideOutcome> {
  try {
    const { response } = await api.POST("/api/admissions/applications/{id}/reject", { params: { path: { id } }, body: { reason } });
    if (response.ok) return { ok: true };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 409 ? "conflict" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** `temporaryPassword` is shown here and nowhere else (never emailed): the Co-ordinator must relay it to the new student some other way. */
export type ApproveOutcome = { ok: true; sid: string; temporaryPassword: string } | { ok: false; reason: "forbidden" | "not_found" | "conflict" | "failed" } | { ok: false; reason: "invalid"; message: string };

export async function approveApplication(api: ApiClient, id: string, classId: string, rollNo: number | null): Promise<ApproveOutcome> {
  try {
    const { data, response, error } = await api.POST("/api/admissions/applications/{id}/approve", { params: { path: { id } }, body: { classId, ...(rollNo ? { rollNo } : {}) } });
    if (data) return { ok: true, sid: data.sid, temporaryPassword: data.temporaryPassword };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 409 ? "conflict" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function searchStudents(api: ApiClient, q: string): Promise<Loaded<StudentSummary[]>> {
  try {
    const { data, response } = await api.GET("/api/students", { params: { query: { q } } });
    if (data) return { ok: true, data: data.students };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function loadStudent(api: ApiClient, id: string): Promise<Loaded<StudentDetail>> {
  try {
    const { data, response } = await api.GET("/api/students/{id}", { params: { path: { id } } });
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type LoadOwnStudentResult = { ok: true; data: StudentDetail } | { ok: false; reason: "not_found" | "failed" };

export async function loadOwnStudent(api: ApiClient): Promise<LoadOwnStudentResult> {
  try {
    const { data, response } = await api.GET("/api/students/me");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 404 ? "not_found" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
