import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import { closeTerm, createTerm, openTerm, updateTerm } from "@/terms/client";
import { levelSummary, levelsTaken, oddLevels, validateTermForm, emptyTermForm, type Term } from "@/terms/model";

/** Academic terms on the web (D-110): what the Principal's screens send, and how the answers come back. */

interface Seen {
  method: string;
  path: string;
  body: unknown;
}
function fake(answer: (seen: Seen) => Response | "offline") {
  const seen: Seen[] = [];
  const api = createApiClient({
    baseUrl: "http://school.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      const entry: Seen = { method: request.method, path: url.pathname + url.search, body: request.method === "GET" ? undefined : await request.clone().json().catch(() => undefined) };
      seen.push(entry);
      const result = answer(entry);
      if (result === "offline") throw new TypeError("offline");
      return result;
    },
  });
  return { api, seen };
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const id = "a".repeat(32);
const values = { label: "BCA odd 2083", code: "", startBs: "2083-04-01", endBs: "2083-09-29", levelIds: ["l1", "l3"] };
const script = (seen: Seen) => (seen.path.startsWith("/api/dates/to-ad") ? reply(200, { ad: seen.path.includes("2083-04-01") ? "2026-07-17" : "2027-01-13" }) : reply(201, { id }));

describe("making a term", () => {
  it("converts both Nepali days on the server, then sends the name, the AD days and the levels (no code when left empty)", async () => {
    const { api, seen } = fake(script);
    expect(await createTerm(api, values)).toEqual({ ok: true, id });
    expect(seen.find((s) => s.method === "POST")).toMatchObject({ path: "/api/academics/years", body: { label: "BCA odd 2083", startDate: "2026-07-17", endDate: "2027-01-13", levelIds: ["l1", "l3"] } });
    expect((seen.find((s) => s.method === "POST")!.body as Record<string, unknown>).code).toBeUndefined();
  });

  it("checks the form first and sends nothing when it is empty or the code is not letters and digits", async () => {
    const { api, seen } = fake(script);
    expect(await createTerm(api, emptyTermForm())).toMatchObject({ ok: false, reason: "fields", errors: { label: "terms.error.name", startBs: "terms.error.start", endBs: "terms.error.end" } });
    expect(validateTermForm({ ...values, code: "20-83" })).toEqual({ code: "terms.error.code" });
    expect(seen).toEqual([]);
  });

  it("a day that does not exist or is not verified comes back on its field; an end before the start too", async () => {
    const unverified = fake((s) => (s.path.includes("2083-09-29") ? reply(422, { error: "unverified_year" }) : script(s)));
    expect(await createTerm(unverified.api, values)).toMatchObject({ ok: false, reason: "fields", errors: { endBs: "terms.error.unverified" } });
    expect(unverified.seen.some((s) => s.method === "POST")).toBe(false);
    const backwards = fake((s) => (s.path.startsWith("/api/dates/to-ad") ? reply(200, { ad: s.path.includes("2083-04-01") ? "2027-01-13" : "2026-07-17" }) : script(s)));
    expect(await createTerm(backwards.api, values)).toMatchObject({ ok: false, reason: "fields", errors: { endBs: "terms.error.endBeforeStart" } });
  });

  it("keeps the server's own words for a broken rule (a level already in another open term); maps the rest", async () => {
    const withPost = (status: number, body: unknown) => fake((s) => (s.method === "POST" ? reply(status, body) : script(s))).api;
    expect(await createTerm(withPost(422, { error: "invalid", message: "A level you chose is already in another open term" }), values)).toEqual({ ok: false, reason: "rule", message: "A level you chose is already in another open term" });
    expect(await createTerm(withPost(409, { error: "conflict" }), values)).toEqual({ ok: false, reason: "conflict" });
    expect(await createTerm(withPost(403, { error: "forbidden" }), values)).toEqual({ ok: false, reason: "forbidden" });
    expect(await createTerm(fake((s) => (s.method === "POST" ? "offline" : script(s))).api, values)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("changing, opening and closing", () => {
  it("an open term's levels alone; open; close, with what is still missing when it is not ready", async () => {
    const { api, seen } = fake((s) => (s.path.endsWith("/close") ? reply(409, { error: "not_ready", check: { ready: false, exams: 1, classes: 1, missing: [{ classId: "c", className: "BCA · Semester 1", examId: "e", examName: "Final" }] } }) : reply(200, { ok: true })));
    expect(await updateTerm(api, id, values, true)).toEqual({ ok: true });
    expect(await openTerm(api, id)).toEqual({ ok: true });
    expect(await closeTerm(api, id)).toMatchObject({ ok: false, reason: "not_ready", check: { missing: [{ examName: "Final" }] } });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PATCH", `/api/academics/years/${id}`, { levelIds: ["l1", "l3"] }],
      ["POST", `/api/academics/years/${id}/activate`, undefined],
      ["POST", `/api/academics/years/${id}/close`, undefined],
    ]);
    expect(await updateTerm(fake(() => reply(409, { error: "not_draft" })).api, id, values, true)).toEqual({ ok: false, reason: "not_draft" });
    expect(await closeTerm(fake(() => reply(409, { error: "year_closed" })).api, id)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("the model", () => {
  const level = (id: string, name: string, programmeName: string) => ({ id, name, ordinal: 1, programmeId: "p", programmeName, sectionKey: "s", usualMonths: 12 });
  const term = (id: string, status: Term["status"], levels: Term["levels"] = [], students = 0): Term => ({ id, bsYear: 2083, label: id, code: "2083", startDate: "2026-04-14", endDate: "2027-04-13", startDateBs: "2083-01-01", endDateBs: "2083-12-30", months: 12, status, levels, classes: 1, students });

  it("names the levels programme by programme, and says when there are none", () => {
    expect(levelSummary([level("1", "Semester 1", "BCA"), level("3", "Semester 3", "BCA"), level("g", "Grade 11", "Science")])).toBe("BCA: Semester 1, Semester 3 · Science: Grade 11");
    expect(levelSummary([])).toBe("No levels yet");
  });

  it("knows which levels another open term runs, but not a closed one's or its own", () => {
    const terms = [term("a", "active", [level("l1", "S1", "BCA")]), term("b", "closed", [level("l2", "S2", "BCA")]), term("c", "draft", [level("l3", "S3", "BCA")])];
    expect([...levelsTaken(terms, "c")]).toEqual([["l1", "a"]]);
  });

  it("the odd levels shortcut picks Semester 1, 3, 5 ... that are switched on", () => {
    expect(oddLevels({ levels: [1, 2, 3, 4, 5].map((i) => ({ id: `l${i}`, ordinal: i, name: `S${i}`, active: i !== 5, usualMonths: 6, students: 0, canDelete: false })) })).toEqual(["l1", "l3"]);
  });

});
