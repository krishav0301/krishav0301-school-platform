import type { ApiClient } from "@/api/client";
import { toAd } from "@/content/client";
import type { MessageKey } from "@/i18n/messages";

import { validateTermForm, type CloseCheck, type NextTerm, type TermFormErrors, type TermFormValues } from "./model";

/**
 * What the term screens ask of the server (D-110). Nothing here throws: a dropped connection is `failed`. A rule the
 * server refuses (422) keeps its own words, because they say which rule (a level already in another open term).
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };
export type Fail = { ok: false; reason: "forbidden" | "not_found" | "conflict" | "closed" | "not_draft" | "code_locked" | "failed" } | { ok: false; reason: "rule"; message: string };
export type Done = { ok: true } | Fail;

async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    return data ? { ok: true, data } : { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

function failOf(response: Response, error: unknown): Fail {
  const body = error as { error?: string; message?: string } | undefined;
  if (response.status === 403) return { ok: false, reason: "forbidden" };
  if (response.status === 404) return { ok: false, reason: "not_found" };
  if (response.status === 422 && body?.message) return { ok: false, reason: "rule", message: body.message };
  if (response.status === 409) {
    if (body?.error === "year_closed") return { ok: false, reason: "closed" };
    if (body?.error === "not_draft") return { ok: false, reason: "not_draft" };
    if (body?.error === "code_locked") return { ok: false, reason: "code_locked" };
    return { ok: false, reason: "conflict" };
  }
  return { ok: false, reason: "failed" };
}

async function send<T = unknown>(run: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<{ ok: true; data: T } | Fail> {
  try {
    const { data, error, response } = await run();
    return response.ok ? { ok: true, data: data as T } : failOf(response, error);
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** The words for a failure (a rule's own words come from the server). */
export const FAIL_MESSAGE: Record<Exclude<Fail["reason"], "rule">, MessageKey> = {
  forbidden: "terms.error.forbidden",
  not_found: "terms.error.notFound",
  conflict: "terms.error.conflict",
  closed: "terms.error.closed",
  not_draft: "terms.error.notDraft",
  code_locked: "terms.error.codeLocked",
  failed: "terms.error.failed",
};

export const loadTerms = (api: ApiClient) => load(() => api.GET("/api/academics/years"));
export const loadProgrammes = (api: ApiClient) => load(() => api.GET("/api/academics/programmes"));
export const loadNextTerm = (api: ApiClient, id: string): Promise<Loaded<NextTerm>> => load(() => api.GET("/api/academics/years/{id}/next", { params: { path: { id } } }));
export const loadCloseCheck = (api: ApiClient, id: string): Promise<Loaded<CloseCheck>> => load(() => api.GET("/api/academics/years/{id}/close-check", { params: { path: { id } } }));

export type FormResult = { ok: true; id?: string } | Fail | { ok: false; reason: "fields"; errors: TermFormErrors };

/** The two Nepali days, converted by the server's date module (D-014); a problem comes back against its own field. */
async function adDays(api: ApiClient, values: TermFormValues): Promise<{ ok: true; start: string; end: string } | { ok: false; reason: "fields"; errors: TermFormErrors } | Fail> {
  const [start, end] = await Promise.all([toAd(api, values.startBs.trim()), toAd(api, values.endBs.trim())]);
  const errors: TermFormErrors = {};
  if (!start.ok && start.error !== "failed") errors.startBs = start.error === "dateUnverified" ? "terms.error.unverified" : "terms.error.day";
  if (!end.ok && end.error !== "failed") errors.endBs = end.error === "dateUnverified" ? "terms.error.unverified" : "terms.error.day";
  if (Object.keys(errors).length > 0) return { ok: false, reason: "fields", errors };
  if (!start.ok || !end.ok) return { ok: false, reason: "failed" };
  if (end.ad <= start.ad) return { ok: false, reason: "fields", errors: { endBs: "terms.error.endBeforeStart" } };
  return { ok: true, start: start.ad, end: end.ad };
}

/** Makes a term as a draft, with its levels. */
export async function createTerm(api: ApiClient, values: TermFormValues): Promise<FormResult> {
  const problems = validateTermForm(values);
  if (Object.keys(problems).length > 0) return { ok: false, reason: "fields", errors: problems };
  const days = await adDays(api, values);
  if (!days.ok) return days;
  const code = values.code.trim();
  const sent = await send<{ id: string }>(() =>
    api.POST("/api/academics/years", { body: { label: values.label.trim(), ...(code ? { code } : {}), startDate: days.start, endDate: days.end, levelIds: values.levelIds } }),
  );
  return sent.ok ? { ok: true, id: sent.data.id } : sent;
}

/** Changes a draft term's details and levels, or an open term's levels only (the server refuses the rest). */
export async function updateTerm(api: ApiClient, id: string, values: TermFormValues, levelsOnly: boolean): Promise<FormResult> {
  if (levelsOnly) {
    const sent = await send(() => api.PATCH("/api/academics/years/{id}", { params: { path: { id } }, body: { levelIds: values.levelIds } }));
    return sent.ok ? { ok: true } : sent;
  }
  const problems = validateTermForm(values);
  if (Object.keys(problems).length > 0) return { ok: false, reason: "fields", errors: problems };
  const days = await adDays(api, values);
  if (!days.ok) return days;
  const code = values.code.trim();
  const sent = await send(() =>
    api.PATCH("/api/academics/years/{id}", { params: { path: { id } }, body: { label: values.label.trim(), ...(code ? { code } : {}), startDate: days.start, endDate: days.end, levelIds: values.levelIds } }),
  );
  return sent.ok ? { ok: true } : sent;
}

export const openTerm = async (api: ApiClient, id: string): Promise<Done> => {
  const sent = await send(() => api.POST("/api/academics/years/{id}/activate", { params: { path: { id } } }));
  return sent.ok ? { ok: true } : sent;
};

/** Closes a term; not ready comes back with the check, so the panel can say what is missing. */
export async function closeTerm(api: ApiClient, id: string): Promise<Done | { ok: false; reason: "not_ready"; check: CloseCheck }> {
  try {
    const { data, error, response } = await api.POST("/api/academics/years/{id}/close", { params: { path: { id } } });
    if (data) return { ok: true };
    const body = error as { error?: string; check?: CloseCheck } | undefined;
    if (response.status === 409 && body?.error === "not_ready" && body.check) return { ok: false, reason: "not_ready", check: body.check };
    return failOf(response, error);
  } catch {
    return { ok: false, reason: "failed" };
  }
}
