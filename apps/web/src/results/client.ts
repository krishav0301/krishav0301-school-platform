import type { ApiClient } from "@/api/client";

import type { ClassElectives, ClassSheet, MarkSheet, MarksCard, MyMarkSheets, OwnResults, RecheckList, ReviewBoard, Top20 } from "./model";

/** What the results screens ask of the server, as plain results. Nothing here throws. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "forbidden" | "not_found" | "failed" };

async function load<T>(run: () => Promise<{ data?: T; response: Response }>): Promise<Loaded<T>> {
  try {
    const { data, response } = await run();
    if (data) return { ok: true, data };
    if (response.status === 403) return { ok: false, reason: "forbidden" };
    if (response.status === 404) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const gateFailure = (reason: "forbidden" | "not_found" | "failed") =>
  ({
    ok: false,
    reason: reason === "forbidden" ? "forbidden" : "failed",
  }) as const;

export const loadMySheets = (api: ApiClient): Promise<Loaded<MyMarkSheets>> => load(() => api.GET("/api/results/mine"));
export const loadSheet = (api: ApiClient, classId: string, offeringId: string, terminalId: string): Promise<Loaded<MarkSheet>> =>
  load(() => api.GET("/api/results/classes/{classId}/subjects/{offeringId}/terminals/{terminalId}", { params: { path: { classId, offeringId, terminalId } } }));
export const loadReviewSheet = (api: ApiClient, sheetId: string): Promise<Loaded<MarkSheet>> =>
  load(() =>
    api.GET("/api/results/review/sheets/{sheetId}", {
      params: { path: { sheetId } },
    }),
  );
export const loadBoard = (api: ApiClient, terminalId?: string): Promise<Loaded<ReviewBoard>> =>
  load(() =>
    api.GET("/api/results/review", {
      params: { query: terminalId ? { terminalId } : {} },
    }),
  );
export const loadOwnResults = (api: ApiClient): Promise<Loaded<OwnResults>> => load(() => api.GET("/api/results/me"));
export const loadCard = (api: ApiClient, cardId: string): Promise<Loaded<MarksCard>> => load(() => api.GET("/api/results/cards/{cardId}", { params: { path: { cardId } } }));
export const loadTop20 = (api: ApiClient, terminalId?: string): Promise<Loaded<Top20>> =>
  load(() =>
    api.GET("/api/results/top20", {
      params: { query: terminalId ? { terminalId } : {} },
    }),
  );
export const loadClassSheet = (api: ApiClient, classId: string, terminalId: string): Promise<Loaded<ClassSheet>> =>
  load(() =>
    api.GET("/api/results/classes/{classId}/terminals/{terminalId}/sheet", {
      params: { path: { classId, terminalId } },
    }),
  );
export const loadRechecks = (api: ApiClient): Promise<Loaded<RecheckList>> => load(() => api.GET("/api/results/rechecks"));
export const loadElectives = (api: ApiClient, classId: string): Promise<Loaded<ClassElectives>> =>
  load(() =>
    api.GET("/api/results/classes/{classId}/electives", {
      params: { path: { classId } },
    }),
  );

/** A write's plain result: done, the API's own words, or a state it cannot happen in. */
export type Sent<T = unknown> = { ok: true; data: T } | { ok: false; reason: "invalid" | "refused"; message: string | null } | { ok: false; reason: "closed" | "failed" };

async function send<T>(run: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Sent<T>> {
  try {
    const { data, error, response } = await run();
    if (response.ok) return { ok: true, data: data as T };
    const body = (error && typeof error === "object" ? error : {}) as {
      error?: string;
      message?: string;
    };
    if (response.status === 422) return { ok: false, reason: "invalid", message: body.message ?? null };
    if (response.status === 409 && body.error === "year_closed") return { ok: false, reason: "closed" };
    if (response.status === 400 || response.status === 404 || response.status === 409) return { ok: false, reason: "refused", message: body.message ?? null };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

type Mark = {
  enrollmentId: string;
  componentId: string;
  valueHundredths: number | null;
  absent: boolean;
};

export const saveMarks = (api: ApiClient, classId: string, offeringId: string, terminalId: string, marks: Mark[]) =>
  send(() =>
    api.PUT("/api/results/classes/{classId}/subjects/{offeringId}/terminals/{terminalId}", {
      params: { path: { classId, offeringId, terminalId } },
      body: { marks },
    }),
  );
export const submitSheet = (api: ApiClient, classId: string, offeringId: string, terminalId: string) =>
  send(() => api.POST("/api/results/classes/{classId}/subjects/{offeringId}/terminals/{terminalId}/submit", { params: { path: { classId, offeringId, terminalId } } }));
export const verifySheets = (api: ApiClient, sheetIds: string[]) => send(() => api.POST("/api/results/review/verify", { body: { sheetIds } }));
export const sendBack = (api: ApiClient, sheetId: string, note: string) =>
  send(() =>
    api.POST("/api/results/review/sheets/{sheetId}/send-back", {
      params: { path: { sheetId } },
      body: { note },
    }),
  );
export const publishClass = (api: ApiClient, classId: string, terminalId: string) =>
  send(() =>
    api.POST("/api/results/classes/{classId}/publish", {
      params: { path: { classId } },
      body: { terminalId },
    }),
  );
export const requestRecheck = (api: ApiClient, publicationId: string, offeringId: string, reason: string) =>
  send(() =>
    api.POST("/api/results/publications/{publicationId}/rechecks", {
      params: { path: { publicationId } },
      body: { offeringId, reason },
    }),
  );
export const decideRecheck = (
  api: ApiClient,
  recheckId: string,
  body: {
    outcome: "changed" | "unchanged";
    reason: string;
    marks?: {
      componentId: string;
      valueHundredths: number | null;
      absent: boolean;
    }[];
  },
) =>
  send(() =>
    api.POST("/api/results/rechecks/{recheckId}/decide", {
      params: { path: { recheckId } },
      body: { ...body, marks: body.marks ?? [] },
    }),
  );
export const setPicks = (api: ApiClient, enrollmentId: string, groupId: string, offeringIds: string[]) =>
  send(() =>
    api.PUT("/api/results/enrollments/{enrollmentId}/electives/{groupId}", {
      params: { path: { enrollmentId, groupId } },
      body: { offeringIds },
    }),
  );
