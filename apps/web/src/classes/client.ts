import type { ApiClient } from "@/api/client";
import type { Loaded } from "@/setup/client";

import type { ClassHub, ClassHubList } from "./model";

/** A class the person does not open answers 404, the same as a missing one: shown as "not yours to see". */
async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 || response.status === 404 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** The classes the person opens (FUT point 19). */
export const loadClassHubList = (api: ApiClient): Promise<Loaded<ClassHubList>> => load(() => api.GET("/api/classes"));

/** One class as its page. */
export const loadClassHub = (api: ApiClient, id: string): Promise<Loaded<ClassHub>> => load(() => api.GET("/api/classes/{id}", { params: { path: { id } } }));

/** What giving a class its roll numbers came to: how many were numbered, nobody was waiting, or it failed. */
export type GivenRolls = { ok: true; numbered: number } | { ok: false; reason: "nobody_waiting" | "failed" };

/** Gives the class's students who have no roll number the next numbers, alphabetically (the PM, 2026-10-29). */
export async function giveRollNumbers(api: ApiClient, classId: string): Promise<GivenRolls> {
  try {
    const { data, response } = await api.POST("/api/classes/{id}/roll-numbers", { params: { path: { id: classId } } });
    if (data) return { ok: true, numbered: data.numbered };
    return { ok: false, reason: response.status === 409 ? "nobody_waiting" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
