import type { ApiClient } from "@/api/client";

import type { ActivityClassList, AssignmentDetail, ClassActivityDay, MissingActivity, MyActivityToday, OwnActivity, StudentAssignments, StudentNotes, TeacherAssignments, TeacherNotes } from "./model";

/** What the classwork screens ask of the server, as plain results. Nothing here throws. */
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

/** A failure as the shared loading gate shows it. */
export const gateFailure = (reason: "forbidden" | "not_found" | "failed") => ({ ok: false, reason: reason === "forbidden" ? "forbidden" : "failed" }) as const;

export const loadMyToday = (api: ApiClient): Promise<Loaded<MyActivityToday>> => load(() => api.GET("/api/activity/mine"));
export const loadOwnActivity = (api: ApiClient): Promise<Loaded<OwnActivity>> => load(() => api.GET("/api/activity/me"));
export const loadMissing = (api: ApiClient): Promise<Loaded<MissingActivity>> => load(() => api.GET("/api/activity/missing"));
export const loadActivityClasses = (api: ApiClient): Promise<Loaded<ActivityClassList>> => load(() => api.GET("/api/activity/classes"));
export const loadClassDay = (api: ApiClient, classId: string, date?: string): Promise<Loaded<ClassActivityDay>> =>
  load(() => api.GET("/api/activity/classes/{classId}", { params: { path: { classId }, query: date ? { date } : {} } }));

export type WriteResult = { ok: true } | { ok: false; reason: "closed" | "failed" | "gone" };

/** Today's entry for one subject in one class. Safe to send again: it replaces today's entry. */
export async function writeActivity(api: ApiClient, classId: string, offeringId: string, body: string): Promise<WriteResult> {
  try {
    const { data, response } = await api.PUT("/api/activity/classes/{classId}/subjects/{offeringId}/today", { params: { path: { classId, offeringId } }, body: { body: body.trim() } });
    if (data) return { ok: true };
    if (response.status === 409) return { ok: false, reason: "closed" };
    if (response.status === 404) return { ok: false, reason: "gone" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const loadTeacherNotes = (api: ApiClient): Promise<Loaded<TeacherNotes>> => load(() => api.GET("/api/notes/mine"));
export const loadStudentNotes = (api: ApiClient): Promise<Loaded<StudentNotes>> => load(() => api.GET("/api/notes/me"));
export const loadTeacherAssignments = (api: ApiClient): Promise<Loaded<TeacherAssignments>> => load(() => api.GET("/api/assignments/mine"));
export const loadStudentAssignments = (api: ApiClient): Promise<Loaded<StudentAssignments>> => load(() => api.GET("/api/assignments/me"));
export const loadAssignment = (api: ApiClient, id: string): Promise<Loaded<AssignmentDetail>> => load(() => api.GET("/api/assignments/{id}", { params: { path: { id } } }));

/** A write's plain result: done, a reason in the API's words (422), or a state it cannot happen in (404, 409). */
export type Sent = { ok: true; id?: string } | { ok: false; reason: "invalid"; message: string } | { ok: false; reason: "refused" | "closed" | "failed" };

async function send(run: () => Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<Sent> {
  try {
    const { data, error, response } = await run();
    if (response.ok) return { ok: true, id: (data as { id?: string } | undefined)?.id };
    if (response.status === 422 && error && typeof error === "object" && "message" in error) return { ok: false, reason: "invalid", message: String((error as { message: unknown }).message) };
    if (response.status === 409 && (error as { error?: string } | undefined)?.error === "year_closed") return { ok: false, reason: "closed" };
    if (response.status === 404 || response.status === 409) return { ok: false, reason: "refused" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const shareNote = (api: ApiClient, body: { classId: string; offeringId: string; kind: "note" | "question_paper"; title: string; body?: string; link?: string }) => send(() => api.POST("/api/notes", { body }));
export const withdrawNote = (api: ApiClient, id: string) => send(() => api.POST("/api/notes/{id}/withdraw", { params: { path: { id } } }));
export const setAssignment = (api: ApiClient, body: { classId: string; offeringId: string; title: string; instructions: string; dueAt: string; link?: string; maxMarks?: number }) =>
  send(() => api.POST("/api/assignments", { body }));
export const withdrawAssignment = (api: ApiClient, id: string) => send(() => api.POST("/api/assignments/{id}/withdraw", { params: { path: { id } } }));
export const submitWork = (api: ApiClient, id: string, body: string) => send(() => api.PUT("/api/assignments/{id}/submission", { params: { path: { id } }, body: { body } }));
export const requestResubmission = (api: ApiClient, id: string, reason: string) =>
  send(() => api.POST("/api/assignments/{id}/submission/resubmit-request", { params: { path: { id } }, body: { reason } }));
export const reviewWork = (api: ApiClient, id: string, submissionId: string, body: { marks?: number; feedback?: string }) =>
  send(() => api.POST("/api/assignments/{id}/submissions/{submissionId}/review", { params: { path: { id, submissionId } }, body }));
export const decideResubmission = (api: ApiClient, id: string, submissionId: string, allow: boolean) =>
  send(() => api.POST("/api/assignments/{id}/submissions/{submissionId}/resubmission", { params: { path: { id, submissionId } }, body: { allow } }));
