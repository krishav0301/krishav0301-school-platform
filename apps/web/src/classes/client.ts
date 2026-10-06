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
