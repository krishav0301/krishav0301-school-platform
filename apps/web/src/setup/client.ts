import type { ApiClient } from "@/api/client";
import { toAd } from "@/content/client";

import { validateYearForm, type FailReason, type YearFormErrors, type YearFormValues } from "./model";

/**
 * Everything the setup screens ask of the server, with the answers turned into plain results the screens can
 * act on. Nothing here throws: a dropped connection is `failed`, like any other error.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "failed" };

async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 403 ? "forbidden" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const loadYears = (api: ApiClient) => load(() => api.GET("/api/academics/years"));
export const loadProgrammes = (api: ApiClient) => load(() => api.GET("/api/academics/programmes"));
export const loadClasses = (api: ApiClient, yearId: string) => load(() => api.GET("/api/academics/classes", { params: { query: { year: yearId } } }));
export const loadTerminals = (api: ApiClient, yearId: string) => load(() => api.GET("/api/academics/terminals", { params: { query: { year: yearId } } }));

export type WriteResult = { ok: true } | { ok: false; reason: FailReason };
export type CreateResult = { ok: true; id: string } | { ok: false; reason: FailReason };

/** What a failed write means, from the status and the API's word for a 409. */
function reasonOf(response: Response, error: unknown): FailReason {
  const status = response.status;
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) {
    const code = (error as { error?: string } | undefined)?.error;
    return code === "year_closed" || code === "another_active" ? code : "conflict";
  }
  if (status === 400 || status === 422) return "rejected";
  return "failed";
}

type Sent = { ok: true; data: unknown } | { ok: false; reason: FailReason };

async function send(run: () => Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<Sent> {
  try {
    const { data, error, response } = await run();
    return response.ok ? { ok: true, data } : { ok: false, reason: reasonOf(response, error) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

const done = (sent: Sent): WriteResult => (sent.ok ? { ok: true } : sent);
const created = (sent: Sent): CreateResult => (sent.ok ? { ok: true, id: (sent.data as { id: string }).id } : sent);

export type YearResult = CreateResult | { ok: false; reason: "fields"; errors: YearFormErrors };

/**
 * Adds a year. The form is checked first, then the two Nepali days are converted by the server (only the date
 * module converts, D-014), and only then is anything written. A problem with a day comes back against its own field.
 */
export async function createYear(api: ApiClient, values: YearFormValues): Promise<YearResult> {
  const problems = validateYearForm(values);
  if (Object.keys(problems).length > 0) return { ok: false, reason: "fields", errors: problems };

  const [start, end] = await Promise.all([toAd(api, values.startBs.trim()), toAd(api, values.endBs.trim())]);
  const errors: YearFormErrors = {};
  if (!start.ok && start.error !== "failed") errors.startBs = start.error === "dateUnverified" ? "setup.error.dateUnverified" : "setup.error.dateInvalid";
  if (!end.ok && end.error !== "failed") errors.endBs = end.error === "dateUnverified" ? "setup.error.dateUnverified" : "setup.error.dateInvalid";
  if (Object.keys(errors).length > 0) return { ok: false, reason: "fields", errors };
  if (!start.ok || !end.ok) return { ok: false, reason: "failed" };

  return created(await send(() => api.POST("/api/academics/years", { body: { bsYear: Number(values.bsYear.trim()), startDate: start.ad, endDate: end.ad } })));
}

export const activateYear = async (api: ApiClient, id: string): Promise<WriteResult> =>
  done(await send(() => api.POST("/api/academics/years/{id}/activate", { params: { path: { id } } })));

export const createProgramme = async (api: ApiClient, body: { name: string; sectionKey: string; affiliation: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/programmes", { body })));

export const setProgrammeActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/programmes/{id}", { params: { path: { id } }, body: { active } })));

export const addLevel = async (api: ApiClient, programmeId: string, name: string): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/programmes/{id}/levels", { params: { path: { id: programmeId } }, body: { name } })));

export const setLevelActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/levels/{id}", { params: { path: { id } }, body: { active } })));

export const createClass = async (api: ApiClient, body: { yearId: string; levelId: string; label: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/classes", { body })));

export const setClassActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/classes/{id}", { params: { path: { id } }, body: { active } })));

export const createTerminal = async (api: ApiClient, body: { yearId: string; name: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/terminals", { body })));

// --- Subjects and the curriculum (slice 2) -----------------------------------------------------------

export const loadSubjects = (api: ApiClient) => load(() => api.GET("/api/academics/subjects"));
export const loadCurriculum = (api: ApiClient, levelId: string) => load(() => api.GET("/api/academics/curriculum", { params: { query: { level: levelId } } }));

export const createSubject = async (api: ApiClient, input: { name: string; code?: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/subjects", { body: { name: input.name, ...(input.code ? { code: input.code } : {}) } })));

export const setSubjectArchived = async (api: ApiClient, id: string, archived: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/subjects/{id}", { params: { path: { id } }, body: { archived } })));

export const createGroup = async (api: ApiClient, levelId: string, body: { name: string; pickCount: number }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/levels/{id}/groups", { params: { path: { id: levelId } }, body })));

export const setGroupActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/groups/{id}", { params: { path: { id } }, body: { active } })));

export const addOffering = async (
  api: ApiClient,
  body: { levelId: string; subjectId: string; creditHundredths: number | null; groupId: string | null },
): Promise<CreateResult> => created(await send(() => api.POST("/api/academics/offerings", { body })));

export const setOfferingGroup = async (api: ApiClient, id: string, groupId: string | null): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/offerings/{id}", { params: { path: { id } }, body: { groupId } })));

export const setOfferingActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/offerings/{id}", { params: { path: { id } }, body: { active } })));

export const addComponent = async (api: ApiClient, offeringId: string, body: { name: string; maxHundredths: number }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/offerings/{id}/components", { params: { path: { id: offeringId } }, body })));

export const setComponentActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/components/{id}", { params: { path: { id } }, body: { active } })));
