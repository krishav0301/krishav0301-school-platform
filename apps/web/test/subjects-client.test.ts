import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import {
  addOffering,
  createGroup,
  createSubject,
  loadCurriculum,
  loadSubjects,
  setGroupActive,
  setOfferingActive,
  setOfferingGroup,
  setOfferingPaper,
  setSubjectArchived,
} from "@/setup/client";

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/** A client whose "network" answers from a script and remembers every request. */
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
const id = "b".repeat(32);

describe("loading", () => {
  it("the catalogue, and one level's curriculum by query", async () => {
    const { api, seen } = fake(() => reply(200, { subjects: [] }));
    expect(await loadSubjects(api)).toEqual({ ok: true, data: { subjects: [] } });
    await loadCurriculum(api, id);
    expect(seen.map((s) => s.path)).toEqual(["/api/academics/subjects", `/api/academics/curriculum?level=${id}`]);
  });

  it("403 is forbidden; a missing level, any other failure and a dropped connection are failed", async () => {
    expect(await loadSubjects(fake(() => reply(403, { error: "forbidden" })).api)).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadCurriculum(fake(() => reply(404, { error: "not_found" })).api, id)).toEqual({ ok: false, reason: "failed" });
    expect(await loadCurriculum(fake(() => "offline").api, id)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("the writes send what the API expects", () => {
  it("adding: a subject (the code only when there is one), a group, an offering with its paper", async () => {
    const { api, seen } = fake(() => reply(201, { id }));
    expect(await createSubject(api, { name: "Biology", sectionKey: "plus2" })).toEqual({ ok: true, id });
    await createSubject(api, { name: "Physics", code: "PHY", sectionKey: "plus2" });
    await createGroup(api, id, { name: "Science option", pickCount: 1 });
    await addOffering(api, { levelId: id, subjectId: id, creditHundredths: 375, groupId: id, fullMarksHundredths: 10000, practicalHundredths: 2500 });
    await addOffering(api, { levelId: id, subjectId: id, creditHundredths: null, groupId: null, fullMarksHundredths: 10000, practicalHundredths: null });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "/api/academics/subjects", { name: "Biology", sectionKey: "plus2" }],
      ["POST", "/api/academics/subjects", { name: "Physics", sectionKey: "plus2", code: "PHY" }],
      ["POST", `/api/academics/levels/${id}/groups`, { name: "Science option", pickCount: 1 }],
      ["POST", "/api/academics/offerings", { levelId: id, subjectId: id, creditHundredths: 375, groupId: id, fullMarksHundredths: 10000, practicalHundredths: 2500 }],
      ["POST", "/api/academics/offerings", { levelId: id, subjectId: id, creditHundredths: null, groupId: null, fullMarksHundredths: 10000, practicalHundredths: null }],
    ]);
  });

  it("switching: archive and restore, groups, offerings (their group and their paper)", async () => {
    const { api, seen } = fake(() => reply(200, { ok: true }));
    expect(await setSubjectArchived(api, id, true)).toEqual({ ok: true });
    await setGroupActive(api, id, false);
    await setOfferingActive(api, id, true);
    await setOfferingGroup(api, id, id);
    await setOfferingGroup(api, id, null);
    await setOfferingPaper(api, id, { fullMarksHundredths: 10000, practicalHundredths: 3000 });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PATCH", `/api/academics/subjects/${id}`, { archived: true }],
      ["PATCH", `/api/academics/groups/${id}`, { active: false }],
      ["PATCH", `/api/academics/offerings/${id}`, { active: true }],
      ["PATCH", `/api/academics/offerings/${id}`, { groupId: id }],
      ["PATCH", `/api/academics/offerings/${id}`, { groupId: null }],
      ["PATCH", `/api/academics/offerings/${id}`, { fullMarksHundredths: 10000, practicalHundredths: 3000 }],
    ]);
  });

  it("maps the server's answers: 403 forbidden, 404 not_found, 409 conflict, 422 rejected, a dropped connection failed", async () => {
    const once = (status: number, body: unknown) => fake(() => reply(status, body)).api;
    expect(await createSubject(once(403, { error: "forbidden" }), { name: "x", sectionKey: "plus2" })).toEqual({ ok: false, reason: "forbidden" });
    expect(await setOfferingPaper(once(404, { error: "not_found" }), id, { fullMarksHundredths: 10000, practicalHundredths: null })).toEqual({ ok: false, reason: "not_found" });
    expect(await createSubject(once(409, { error: "conflict" }), { name: "x", sectionKey: "plus2" })).toEqual({ ok: false, reason: "conflict" });
    expect(await addOffering(once(422, { error: "invalid", message: "x" }), { levelId: id, subjectId: id, creditHundredths: null, groupId: null, fullMarksHundredths: 10000, practicalHundredths: null })).toEqual({ ok: false, reason: "rejected" });
    expect(await setGroupActive(fake(() => "offline").api, id, true)).toEqual({ ok: false, reason: "failed" });
  });
});
