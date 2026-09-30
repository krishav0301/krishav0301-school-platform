import type { ApiClient } from "@/api/client";

import type { AttendanceClassList, AttendanceDay, AttendanceSummary, OwnAttendance, OwnTeacherMonth, TeacherDay } from "./model";

/** What the attendance screens ask of the server, as plain results. Nothing here throws. */
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

export const loadClasses = (api: ApiClient): Promise<Loaded<AttendanceClassList>> => load(() => api.GET("/api/attendance/classes"));
export const loadDay = (api: ApiClient, classId: string, date?: string): Promise<Loaded<AttendanceDay>> =>
  load(() => api.GET("/api/attendance/classes/{id}/day", { params: { path: { id: classId }, query: date ? { date } : {} } }));
export const loadSummary = (api: ApiClient, classId: string): Promise<Loaded<AttendanceSummary>> => load(() => api.GET("/api/attendance/classes/{id}/summary", { params: { path: { id: classId } } }));
export const loadOwn = (api: ApiClient): Promise<Loaded<OwnAttendance>> => load(() => api.GET("/api/attendance/me"));

export type SaveResult = { ok: true; present: number; absent: number } | { ok: false; reason: "closed" | "failed" };

/** Today's register: the absent students; everyone else is present. Safe to send again (it replaces the day). */
export async function saveToday(api: ApiClient, classId: string, absent: string[]): Promise<SaveResult> {
  try {
    const { data, response } = await api.PUT("/api/attendance/classes/{id}/today", { params: { path: { id: classId } }, body: { absent } });
    if (data) return { ok: true, present: data.present, absent: data.absent };
    return { ok: false, reason: response.status === 409 ? "closed" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** A failure as the shared loading gate shows it. A 404 (switched off, or not yours) reads as "could not load". */
export const gateFailure = (reason: "forbidden" | "not_found" | "failed") => ({ ok: false, reason: reason === "forbidden" ? "forbidden" : "failed" }) as const;

export const loadTeacherDay = (api: ApiClient, date?: string): Promise<Loaded<TeacherDay>> =>
  load(() => api.GET("/api/attendance/teachers/day", { params: { query: date ? { date } : {} } }));
export const loadOwnMonth = (api: ApiClient, month?: string): Promise<Loaded<OwnTeacherMonth>> =>
  load(() => api.GET("/api/attendance/teachers/me", { params: { query: month ? { month } : {} } }));

export type TeacherSaveResult = { ok: true } | { ok: false; reason: "closed" | "failed" } | { ok: false; reason: "invalid"; message: string };

/** Saves a day's teacher list: the exceptions, and a reason for any day but today. */
export async function saveTeacherDay(api: ApiClient, date: string, exceptions: { teacherId: string; status: "absent" | "leave" }[], reason: string): Promise<TeacherSaveResult> {
  try {
    const { data, error, response } = await api.PUT("/api/attendance/teachers/day", { body: { date, exceptions, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
    if (data) return { ok: true };
    if (response.status === 409) return { ok: false, reason: "closed" };
    if (response.status === 422 && error && "message" in error) return { ok: false, reason: "invalid", message: error.message };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
