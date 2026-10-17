import { expect } from "vitest";

import { call, db } from "./academics-helpers";

/** Anyone who can be signed in as: a `Person` of the helpers, or just a cookie. */
export interface Who {
  cookie?: string;
}

/** The dates of the one active year the school-day fixtures use (`activeYear` in schoolday-helpers). */
export const YEAR = { startDate: "2026-04-14", endDate: "2027-04-13" };

const post = (path: string, body: unknown, who: Who) => call(path, { method: "POST", body, cookie: who.cookie });
export const idOf = async (response: Response): Promise<string> => ((await response.json()) as { id: string }).id;

export interface Line {
  name: string;
  amountPaisa: number;
}

let n = 0;
/** A name no other structure of the test run has, so each test makes its own. */
export const uniqueName = (word = "Fees"): string => `${word} ${++n}${Math.random().toString(36).slice(2, 6)}`;

/** A draft with lines, in a wing, for the dates of the active year unless others are given. */
export async function draftStructure(who: Who, input: { sectionKey: string; name?: string; startDate?: string; endDate?: string; items?: Line[] }): Promise<string> {
  const response = await post("/api/fees/structures", { name: input.name ?? uniqueName(), sectionKey: input.sectionKey, startDate: input.startDate ?? YEAR.startDate, endDate: input.endDate ?? YEAR.endDate }, who);
  expect(response.status, `drafting: ${await response.clone().text()}`).toBe(201);
  const id = await idOf(response);
  for (const item of input.items ?? [{ name: "Annual fee", amountPaisa: 400_000 }]) {
    const added = await post(`/api/fees/structures/${id}/items`, item, who);
    expect(added.status, `adding ${item.name}: ${await added.clone().text()}`).toBe(201);
  }
  return id;
}

/** The pending approval request of a structure. */
export const approvalOf = async (structureId: string): Promise<string | undefined> =>
  (await db.prepare("SELECT public_id FROM approval_requests WHERE subject_public_id = ?1 AND status = 'pending'").bind(structureId).first<{ public_id: string }>())?.public_id;

/** Sends a draft and has the Principal approve it: the structure is live. */
export async function approveStructure(accountant: Who, admin: Who, structureId: string): Promise<void> {
  const sent = await post(`/api/fees/structures/${structureId}/send`, {}, accountant);
  expect(sent.status, `sending: ${await sent.clone().text()}`).toBe(201);
  const approved = await post(`/api/approvals/${(await approvalOf(structureId))!}/approve`, undefined, admin);
  expect(approved.status, `approving: ${await approved.clone().text()}`).toBe(200);
}

export interface Linked {
  levels: { levelId: string; ok: boolean; reason?: string }[];
  charged: number;
  pending: boolean;
}
export const link = async (who: Who, structureId: string, levelIds: string[]): Promise<{ status: number; body: Linked }> => {
  const response = await post(`/api/fees/structures/${structureId}/levels`, { levelIds }, who);
  return { status: response.status, body: (await response.json()) as Linked };
};

/**
 * A live structure linked to levels, the way the school does it: drafted by the Accountant, approved by the Principal,
 * linked with no approval, and so every student of the levels is charged. Returns the structure's id.
 */
export async function liveFees(opts: { accountant: Who; admin: Who; sectionKey: string; levelIds: string[]; items?: Line[]; name?: string; startDate?: string; endDate?: string }): Promise<string> {
  const id = await draftStructure(opts.accountant, opts);
  await approveStructure(opts.accountant, opts.admin, id);
  const linked = await link(opts.accountant, id, opts.levelIds);
  expect(linked.status).toBe(200);
  expect(linked.body.levels.every((l) => l.ok), `linking: ${JSON.stringify(linked.body)}`).toBe(true);
  return id;
}
