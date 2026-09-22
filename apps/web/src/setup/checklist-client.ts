import type { ApiClient } from "@/api/client";

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };
export type Checklist = import("@/api/schema").components["schemas"]["SetupChecklist"];

export async function loadChecklist(api: ApiClient): Promise<Loaded<Checklist>> {
  try {
    const { data, response } = await api.GET("/api/academics/checklist");
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
