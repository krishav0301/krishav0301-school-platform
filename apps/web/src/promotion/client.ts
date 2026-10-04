import type { ApiClient } from "@/api/client";
import type { components } from "@/api/schema";

/** Moving students into the next term (D-110). Nothing here throws: a dropped connection is `failed`. */
export type Board = components["schemas"]["PromotionBoard"];
export type MoveResult = components["schemas"]["MoveResult"];
export type Move = components["schemas"]["Moves"]["moves"][number];

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };

export async function loadBoard(api: ApiClient, termId: string | null): Promise<Loaded<Board>> {
  try {
    const { data, response } = await api.GET("/api/promotions", { params: { query: termId ? { term: termId } : {} } });
    return data ? { ok: true, data } : { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Each student is answered on its own; a whole request that fails is `null`. */
export async function moveStudents(api: ApiClient, moves: Move[]): Promise<MoveResult[] | null> {
  try {
    const { data } = await api.POST("/api/promotions", { body: { moves } });
    return data ? data.results : null;
  } catch {
    return null;
  }
}
