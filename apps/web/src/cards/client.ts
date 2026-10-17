import type { ApiClient } from "@/api/client";
import type { components } from "@/api/schema";

export type CardView = components["schemas"]["CardView"];
/** Whose card: a student, or a staff member (a teacher, Co-ordinator, Accountant or Admin). */
export type CardOwner = "students" | "people";

export type CardLoad = { ok: true; data: CardView } | { ok: false; reason: "hidden" | "failed" };
export type CardChange = { ok: true } | { ok: false; reason: "in_use" | "changed" | "not_allowed" | "failed" } | { ok: false; reason: "invalid"; message: string };

/** 403 and 404 both mean "nothing to show this person" (not allowed, not theirs, or cards are off): the panel stays out of the way. */
export async function loadCard(api: ApiClient, owner: CardOwner, id: string): Promise<CardLoad> {
  try {
    const { data, response } =
      owner === "students"
        ? await api.GET("/api/cards/students/{id}", { params: { path: { id } } })
        : await api.GET("/api/cards/people/{id}", { params: { path: { id } } });
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 || response.status === 404 ? "hidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

async function changed(request: Promise<{ response: Response; error?: unknown }>): Promise<CardChange> {
  try {
    const { response, error } = await request;
    if (response.ok) return { ok: true };
    if (response.status === 422 && error && typeof error === "object" && "message" in error) return { ok: false, reason: "invalid", message: String((error as { message: unknown }).message) };
    if (response.status === 409) return { ok: false, reason: error && typeof error === "object" && "error" in error && (error as { error: unknown }).error === "changed" ? "changed" : "in_use" };
    return { ok: false, reason: response.status === 403 || response.status === 404 ? "not_allowed" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Links a card, or replaces the one in use (a reason is then required). */
export function linkCard(api: ApiClient, owner: CardOwner, id: string, cardNumber: string, reason?: string): Promise<CardChange> {
  const body = { cardNumber, ...(reason ? { reason } : {}) };
  return changed(owner === "students" ? api.PUT("/api/cards/students/{id}", { params: { path: { id } }, body }) : api.PUT("/api/cards/people/{id}", { params: { path: { id } }, body }));
}

export function retireCard(api: ApiClient, owner: CardOwner, id: string, reason: string): Promise<CardChange> {
  return changed(
    owner === "students"
      ? api.POST("/api/cards/students/{id}/retire", { params: { path: { id } }, body: { reason } })
      : api.POST("/api/cards/people/{id}/retire", { params: { path: { id } }, body: { reason } }),
  );
}
