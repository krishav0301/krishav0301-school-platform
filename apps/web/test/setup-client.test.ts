import { describe, expect, it } from "vitest";

import { createApiClient } from "@/api/client";
import {
  addLevel,
  createClass,
  createProgramme,
  createTerminal,
  loadClasses,
  loadProgrammes,
  loadTerminals,
  loadYears,
  setClassActive,
  setLevelActive,
  setLevelLength,
  setProgrammeActive,
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
const id = "a".repeat(32);

describe("loading", () => {
  it("returns the data on 200", async () => {
    const { api, seen } = fake(() => reply(200, { years: [] }));
    expect(await loadYears(api)).toEqual({ ok: true, data: { years: [] } });
    expect(seen[0]).toMatchObject({ method: "GET", path: "/api/academics/years" });
  });

  it("asks for one year's classes and terminals by query", async () => {
    const { api, seen } = fake(() => reply(200, { classes: [], terminals: [] }));
    await loadClasses(api, id);
    await loadTerminals(api, id);
    expect(seen.map((s) => s.path)).toEqual([`/api/academics/classes?year=${id}`, `/api/academics/terminals?year=${id}`]);
  });

  it("403 is forbidden, any other failure and a dropped connection are failed", async () => {
    expect(await loadProgrammes(fake(() => reply(403, { error: "forbidden" })).api)).toEqual({ ok: false, reason: "forbidden" });
    expect(await loadProgrammes(fake(() => reply(500, {})).api)).toEqual({ ok: false, reason: "failed" });
    expect(await loadProgrammes(fake(() => "offline").api)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("the other writes", () => {
  it("send what the API expects", async () => {
    const { api, seen } = fake(() => reply(201, { id }));
    await createProgramme(api, { name: "BBS", sectionKey: "bachelors", affiliation: "TU" });
    await addLevel(api, id, "Year 1");
    await createClass(api, { yearId: id, levelId: id, label: "Morning" });
    await createTerminal(api, { yearId: id, name: "First" });
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "/api/academics/programmes", { name: "BBS", sectionKey: "bachelors", affiliation: "TU" }],
      ["POST", `/api/academics/programmes/${id}/levels`, { name: "Year 1" }],
      ["POST", "/api/academics/classes", { yearId: id, levelId: id, label: "Morning" }],
      ["POST", "/api/academics/terminals", { yearId: id, name: "First" }],
    ]);
  });

  it("Add a Programme sends no grading choice, which the API's strict body would refuse (FUT F-02)", async () => {
    const { api, seen } = fake(() => reply(201, { id }));
    // What the Add a Programme form hands over: its values include the (hidden) grading choice.
    const fromForm = { name: "+2 Science", affiliation: "NEB", gradingPolicy: null, sectionKey: "plus2" };
    await createProgramme(api, fromForm);
    expect(seen[0]!.body).toEqual({ name: "+2 Science", sectionKey: "plus2", affiliation: "NEB" });
  });

  it("switch things off and on, and set a level's usual length (D-110)", async () => {
    const { api, seen } = fake(() => reply(200, { ok: true }));
    expect(await setProgrammeActive(api, id, false)).toEqual({ ok: true });
    await setLevelActive(api, id, true);
    await setClassActive(api, id, false);
    await setLevelLength(api, id, 6);
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PATCH", `/api/academics/programmes/${id}`, { active: false }],
      ["PATCH", `/api/academics/levels/${id}`, { active: true }],
      ["PATCH", `/api/academics/classes/${id}`, { active: false }],
      ["PATCH", `/api/academics/levels/${id}`, { usualMonths: 6 }],
    ]);
  });

  it("409 keeps its word: a closed term is told apart from a repeat", async () => {
    const closed = fake(() => reply(409, { error: "year_closed" })).api;
    expect(await createClass(closed, { yearId: id, levelId: id, label: "" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await createTerminal(closed, { yearId: id, name: "x" })).toEqual({ ok: false, reason: "year_closed" });
    expect(await createClass(fake(() => reply(409, { error: "conflict" })).api, { yearId: id, levelId: id, label: "" })).toEqual({ ok: false, reason: "conflict" });
  });

  it("404 is not_found, and a dropped connection is failed, for every write", async () => {
    const gone = fake(() => reply(404, { error: "not_found" })).api;
    expect(await addLevel(gone, id, "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await setClassActive(gone, id, true)).toEqual({ ok: false, reason: "not_found" });
    const offline = fake(() => "offline").api;
    expect(await createProgramme(offline, { name: "x", sectionKey: "plus2", affiliation: "y" })).toEqual({ ok: false, reason: "failed" });
    expect(await setLevelLength(offline, id, null)).toEqual({ ok: false, reason: "failed" });
  });
});
