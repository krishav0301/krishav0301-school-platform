import type { ApiClient } from "@/api/client";

import { validateForm, type ContentItem, type ContentSummary, type PublicItem, type FieldName, type FormErrors, type FormValues, type Kind, type State } from "./model";

/**
 * Everything the content screens ask of the server, with the answers turned into plain results the
 * screens can act on. Nothing here throws: a dropped connection is `failed`, like any other error.
 */

export type LoadResult = { ok: true; items: ContentSummary[]; todayBs: string | null } | { ok: false; reason: "forbidden" | "failed" };

/** The list: light items without their text, newest touched first. `limit` asks for fewer (a new form needs only today's date). */
export async function loadContent(api: ApiClient, filter: { kind?: Kind; state?: State; limit?: number }): Promise<LoadResult> {
  try {
    const { data, response } = await api.GET("/api/content", {
      params: { query: { ...(filter.kind && { kind: filter.kind }), ...(filter.state && { state: filter.state }), ...(filter.limit && { limit: filter.limit }) } },
    });
    if (data) return { ok: true, items: data.items, todayBs: data.todayBs };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type ItemResult = { ok: true; item: ContentItem } | { ok: false; reason: "not_found" | "forbidden" | "failed" };

/** One item with its text, for the edit form. */
export async function loadItem(api: ApiClient, id: string): Promise<ItemResult> {
  try {
    const { data, response } = await api.GET("/api/content/{id}", { params: { path: { id } } });
    if (data) return { ok: true, item: data };
    return { ok: false, reason: response.status === 404 ? "not_found" : response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

type DateOutcome = { ok: true; ad: string } | { ok: false; error: "dateInvalid" | "dateUnverified" } | { ok: false; error: "failed" };

/** Asks the server to turn one Nepali day into AD. Only the date module converts (D-014). */
async function toAd(api: ApiClient, bs: string): Promise<DateOutcome> {
  try {
    const { data, error, response } = await api.GET("/api/dates/to-ad", { params: { query: { bs } } });
    if (data) return { ok: true, ad: data.ad };
    if (response.status === 422 && error) return { ok: false, error: error.error === "unverified_year" ? "dateUnverified" : "dateInvalid" };
    if (response.status === 400) return { ok: false, error: "dateInvalid" };
    return { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "fields"; errors: FormErrors }
  | { ok: false; reason: "rejected" | "forbidden" | "not_found" | "failed" };

/**
 * Saves the form: a new draft when `id` is null, otherwise a change to that item. The form is checked
 * first, then the Nepali days are converted, and only then is anything written. A problem with a day
 * comes back against its own field.
 */
export async function saveItem(api: ApiClient, id: string | null, values: FormValues): Promise<SaveResult> {
  const problems = validateForm(values);
  if (Object.keys(problems).length > 0) return { ok: false, reason: "fields", errors: problems };

  const publishOnBs = values.publishOnBs.trim();
  const hideAfterBs = values.hideAfterBs.trim();
  const [publishOn, hideAfter] = await Promise.all([toAd(api, publishOnBs), hideAfterBs ? toAd(api, hideAfterBs) : Promise.resolve<DateOutcome>({ ok: true, ad: "" })]);

  const errors: FormErrors = {};
  const check = (field: FieldName, outcome: DateOutcome) => {
    if (!outcome.ok && outcome.error !== "failed") errors[field] = outcome.error === "dateUnverified" ? "contentForm.error.dateUnverified" : "contentForm.error.dateInvalid";
  };
  check("publishOnBs", publishOn);
  check("hideAfterBs", hideAfter);
  if (Object.keys(errors).length > 0) return { ok: false, reason: "fields", errors };
  if (!publishOn.ok || !hideAfter.ok) return { ok: false, reason: "failed" };

  const words = {
    title: values.title.trim(),
    body: values.body.trim(),
    // Only a vacancy has a contact; whatever is left in the box for another kind is not sent.
    contact: values.kind === "vacancy" ? values.contact.trim() : null,
    urgent: values.urgent,
    publishOn: publishOn.ad,
    hideAfter: hideAfterBs ? hideAfter.ad : null,
  };

  try {
    if (id === null) {
      const { data, response } = await api.POST("/api/content", { body: { kind: values.kind, ...words } });
      if (data) return { ok: true, id: data.id };
      return { ok: false, reason: failure(response.status) };
    }
    const { response } = await api.PATCH("/api/content/{id}", { params: { path: { id } }, body: words });
    if (response.ok) return { ok: true, id };
    return { ok: false, reason: failure(response.status) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

const failure = (status: number): "rejected" | "forbidden" | "not_found" | "failed" =>
  status === 400 || status === 422 ? "rejected" : status === 403 ? "forbidden" : status === 404 ? "not_found" : "failed";

export type ToggleResult = { ok: true } | { ok: false; reason: "conflict" | "gone" | "forbidden" | "failed" };

/** Puts an item on the website, or takes it off. `conflict` means someone else already did. */
export async function setPublished(api: ApiClient, id: string, publish: boolean): Promise<ToggleResult> {
  try {
    const path = publish ? "/api/content/{id}/publish" : "/api/content/{id}/unpublish";
    const { response } = await api.POST(path, { params: { path: { id } } });
    if (response.ok) return { ok: true };
    if (response.status === 409) return { ok: false, reason: "conflict" };
    if (response.status === 404) return { ok: false, reason: "gone" };
    if (response.status === 403) return { ok: false, reason: "forbidden" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type PublicResult = { ok: true; items: PublicItem[] } | { ok: false };

/** What the public may read today: the notices, holidays, routines, vacancies and posts on the site. No sign-in. */
export async function loadPublic(api: ApiClient): Promise<PublicResult> {
  try {
    const { data } = await api.GET("/api/site/content", { params: { query: {} } });
    return data ? { ok: true, items: data.items } : { ok: false };
  } catch {
    return { ok: false };
  }
}
