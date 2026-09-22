import type { ApiClient } from "@/api/client";

import type { Teaching, TeachingFailReason } from "./teaching-model";

/**
 * Everything the Teaching screen asks of the server. Nothing here throws: a dropped connection is `failed`.
 * A class outside the viewer's sections answers the same as a missing one, so `loadTeaching` reads it as `failed`
 * (the class picker only ever offers classes the viewer's own `GET /api/academics/classes` already includes).
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };
export type WriteResult = { ok: true } | { ok: false; reason: TeachingFailReason };

export async function loadTeaching(api: ApiClient, classId: string): Promise<Loaded<Teaching>> {
  try {
    const { data, response } = await api.GET("/api/academics/classes/{id}/teaching", { params: { path: { id: classId } } });
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

function reasonOf(status: number): TeachingFailReason {
  if (status === 403 || status === 404) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

export async function setAssignment(api: ApiClient, classId: string, offeringId: string, teacherId: string | null): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/academics/assignments", { body: { classId, offeringId, teacherId } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function setClassTeacher(api: ApiClient, classId: string, teacherId: string | null): Promise<WriteResult> {
  try {
    const { response } = await api.POST("/api/academics/classes/{id}/class-teacher", { params: { path: { id: classId } }, body: { teacherId } });
    return response.ok ? { ok: true } : { ok: false, reason: reasonOf(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
