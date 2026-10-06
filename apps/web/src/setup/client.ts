import type { ApiClient } from "@/api/client";

import type { FailReason } from "./model";

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
    return code === "year_closed" || code === "in_use" || code === "code_taken" || code === "code_locked" || code === "locked" ? code : "conflict";
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

/** Adds a section (D-095) with its receipt code (D-102). Its key comes back as the id. */
export const createSection = async (api: ApiClient, name: string, receiptCode?: string): Promise<CreateResult> => {
  const sent = await send(() => api.POST("/api/academics/sections", { body: receiptCode ? { name, receiptCode } : { name } }));
  return sent.ok ? { ok: true, id: (sent.data as { key: string }).key } : sent;
};

/** Renames a section, or gives it a receipt code while it may still change (D-102). */
export const updateSection = async (api: ApiClient, key: string, changes: { name?: string; receiptCode?: string }): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/sections/{key}", { params: { path: { key } }, body: changes })));

/** Switches a section off or on (D-097). */
export const setSectionActive = async (api: ApiClient, key: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/sections/{key}", { params: { path: { key } }, body: { active } })));

/** Deletes a section, programme or level that nothing is attached to (D-097); anything attached comes back as "in_use". */
export const deleteSection = async (api: ApiClient, key: string): Promise<WriteResult> =>
  done(await send(() => api.DELETE("/api/academics/sections/{key}", { params: { path: { key } } })));
export const deleteProgramme = async (api: ApiClient, id: string): Promise<WriteResult> =>
  done(await send(() => api.DELETE("/api/academics/programmes/{id}", { params: { path: { id } } })));
export const deleteClass = async (api: ApiClient, id: string): Promise<WriteResult> =>
  done(await send(() => api.DELETE("/api/academics/classes/{id}", { params: { path: { id } } })));
export const deleteLevel = async (api: ApiClient, id: string): Promise<WriteResult> =>
  done(await send(() => api.DELETE("/api/academics/levels/{id}", { params: { path: { id } } })));

/** Sends only the three fields the API takes: it refuses any other (a strict body), such as the form's grading choice. */
export const createProgramme = async (api: ApiClient, { name, sectionKey, affiliation }: { name: string; sectionKey: string; affiliation: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/programmes", { body: { name, sectionKey, affiliation } })));

/** Changes a programme's name or affiliation (D-096's Edit). */
export const updateProgramme = async (api: ApiClient, id: string, body: { name?: string; affiliation?: string }): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/programmes/{id}", { params: { path: { id } }, body })));

export const renameLevel = async (api: ApiClient, id: string, name: string): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/levels/{id}", { params: { path: { id } }, body: { name } })));

export const setProgrammeActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/programmes/{id}", { params: { path: { id } }, body: { active } })));

/** A new level, with how long it runs in months (D-114). */
export const addLevel = async (api: ApiClient, programmeId: string, name: string, usualMonths: number): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/programmes/{id}/levels", { params: { path: { id: programmeId } }, body: { name, usualMonths } })));

/** A level's length in months (D-114): a term takes only levels of its own length. */
export const setLevelLength = async (api: ApiClient, id: string, usualMonths: number): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/levels/{id}", { params: { path: { id } }, body: { usualMonths } })));

export const setLevelActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/levels/{id}", { params: { path: { id } }, body: { active } })));

export const createClass = async (api: ApiClient, body: { yearId: string; levelId: string; label: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/classes", { body })));

/** A class's section, such as A or Morning, or none (D-114). Its term and level never change. */
export const renameClass = async (api: ApiClient, id: string, label: string): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/classes/{id}", { params: { path: { id } }, body: { label } })));

export const setClassActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/classes/{id}", { params: { path: { id } }, body: { active } })));

// --- The exam pattern (D-117): one per term, out of 100 ---------------------------------------------------

export const loadExamPattern = (api: ApiClient, yearId: string) => load(() => api.GET("/api/academics/years/{id}/exam-pattern", { params: { path: { id: yearId } } }));

export interface ExamPatternInput {
  graded: boolean;
  theoryMinPercent: number;
  practicalMinPercent: number;
  gradeBands: { grade: string; from: number }[] | null;
  terminals: { id?: string; name: string; weight: number; hasPractical: boolean }[];
}

/** Saves the whole pattern. A rule it breaks (weights not adding up to 100, grades out of order) comes back in the server's words. */
export async function saveExamPattern(api: ApiClient, yearId: string, body: ExamPatternInput): Promise<WriteResult | { ok: false; reason: "rejected"; message: string }> {
  try {
    const { error, response } = await api.PUT("/api/academics/years/{id}/exam-pattern", { params: { path: { id: yearId } }, body });
    if (response.ok) return { ok: true };
    const message = (error as { message?: string } | undefined)?.message;
    if (response.status === 422 && message) return { ok: false, reason: "rejected", message };
    return { ok: false, reason: reasonOf(response, error) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

// --- Subjects and the curriculum (slice 2) -----------------------------------------------------------

export const loadSubjects = (api: ApiClient) => load(() => api.GET("/api/academics/subjects"));
export const loadCurriculum = (api: ApiClient, levelId: string) => load(() => api.GET("/api/academics/curriculum", { params: { query: { level: levelId } } }));

/** A subject in a wing (D-114). */
export const createSubject = async (api: ApiClient, input: { name: string; code?: string; sectionKey: string }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/subjects", { body: { name: input.name, sectionKey: input.sectionKey, ...(input.code ? { code: input.code } : {}) } })));

/** A subject's name, code (none when empty) and wing; the wing moves only while no curriculum uses it (FUT point 17). */
export const updateSubject = async (api: ApiClient, id: string, input: { name: string; code: string; sectionKey: string }): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/subjects/{id}", { params: { path: { id } }, body: { name: input.name, code: input.code || null, sectionKey: input.sectionKey } })));

export const setSubjectArchived = async (api: ApiClient, id: string, archived: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/subjects/{id}", { params: { path: { id } }, body: { archived } })));

export const createGroup = async (api: ApiClient, levelId: string, body: { name: string; pickCount: number }): Promise<CreateResult> =>
  created(await send(() => api.POST("/api/academics/levels/{id}/groups", { params: { path: { id: levelId } }, body })));

export const setGroupActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/groups/{id}", { params: { path: { id } }, body: { active } })));

export const addOffering = async (
  api: ApiClient,
  body: { levelId: string; subjectId: string; creditHundredths: number | null; groupId: string | null; fullMarksHundredths: number; practicalHundredths: number | null },
): Promise<CreateResult> => created(await send(() => api.POST("/api/academics/offerings", { body })));

/** A subject's paper (D-117): its full marks, and the practical's share or none. */
export const setOfferingPaper = async (api: ApiClient, id: string, body: { fullMarksHundredths: number; practicalHundredths: number | null }): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/offerings/{id}", { params: { path: { id } }, body })));

export const setOfferingGroup = async (api: ApiClient, id: string, groupId: string | null): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/offerings/{id}", { params: { path: { id } }, body: { groupId } })));

export const setOfferingActive = async (api: ApiClient, id: string, active: boolean): Promise<WriteResult> =>
  done(await send(() => api.PATCH("/api/academics/offerings/{id}", { params: { path: { id } }, body: { active } })));


